const ROLES = {clash:'对抗路', jungle:'打野', mid:'中路', farm:'发育路', roam:'游走'};
const ROLE_ALIASES = {'Clash Lane':'clash', Jungle:'jungle', Mid:'mid', Farm:'farm', 'Farm Lane':'farm', Roam:'roam'};
const roleKey = role => ROLE_ALIASES[role] || Object.keys(ROLES).find(key => key === role || ROLES[key] === role || (key === 'roam' && role === '辅助'));
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const valueOf = value => numeric(value) ? value : numeric(value?.value) ? value.value : null;
const fmt = value => numeric(value) ? new Intl.NumberFormat('zh-CN', {maximumFractionDigits:3}).format(value) : '待标定';
// Source narrative stays plain text. Unsupported performance claims are never displayed.
const text = value => typeof value === 'string' && !/胜率|真实比赛|真实数据|win[ _-]?rate|real[ _-]?data/i.test(value) ? value : '待标定';
const bankData = (bank, server) => {
  const data = bank?.data;
  if (bank?.availability !== 'available' || data?.server !== server) return null;
  const sameScope = record => {
    if (!record || typeof record !== 'object') return true;
    for (const key of ['server','patch','data_version']) if (Object.hasOwn(record, key) && record[key] !== data[key]) return false;
    // Citation metadata may describe a different period/server. It is never a
    // calculation input; validate bank records separately from their sources.
    return Object.entries(record).filter(([key]) => key !== 'source').every(([, child]) => sameScope(child));
  };
  return sameScope(data) ? data : null;
};

export function normalizeScoring(bank, server) {
  const data = bankData(bank, server);
  const native = data?.kind === 'scoring' && data.schema_version === 1 && typeof data.version === 'string';
  const historical = native && server === 'cn';
  // C3 contract: heroes keyed by hero_id, with tiers_by_role and tier_scores.
  const entries = Array.isArray(data?.heroes) ? data.heroes : Object.entries(data?.heroes || {}).flatMap(([id, hero]) => {
    if (native && hero?.by_lane) return Object.entries(hero.by_lane).filter(([, row]) => !(server === 'hok' && row?.source?.some(ref => ref.numeric_transfer === false))).map(([lane, row]) => ({
      name:id, role:lane, score:row?.server === server && row?.version === data.version ? row.tier : null,
      notes:row?.notes, source:row?.source, status:row?.status,
    }));
    const tiers = hero?.tiers_by_role || (hero?.role ? {[hero.role]:hero.tier} : {});
    return Object.entries(tiers).map(([role, tier]) => ({...hero, name:hero.name || id, role, score:data?.tier_scores?.[tier]}));
  });
  const heroes = entries.flatMap((hero, index) => {
    const role = roleKey(hero?.role), score = valueOf(hero?.score);
    if (!role || typeof hero?.name !== 'string') return [];
    return [{id:`${role}-${index}`, name:text(hero.name), role, score:[1,2,3].includes(score) ? score : null, notes:hero.notes, source:hero.source, status:hero.status}];
  });
  return {data, heroes, native, historical, patch:data?.patch || data?.game_patch, version:data?.data_version || data?.version};
}

export function normalizeEconomy(bank, server) {
  const data = bankData(bank, server);
  if (data?.kind === 'economy' && data.schema_version === 1 && data.values) {
    const nativeValues = data.values;
    const metric = key => {
      const row = nativeValues[key];
      return row?.server === server && row?.version === data.version ? valueOf(row) : null;
    };
    const definitions = [
      ['pheasant','野怪','烈雉','jungle.pheasant'], ['armadillo','野怪','赤甲','jungle.armadillo'], ['river','野怪','河灵本体','jungle.river'],
      ['bird','野怪','红隼本体（不含团队奖励）','jungle.bird','jungle.bird.local.gold'], ['shanhao','野怪','山豪（单只 / 整组待核）','jungle.shanhao'],
      ['front','兵线','前排（是否含补刀待核）','wave','wave.front.gold'], ['back','兵线','每个后排（是否含补刀待核）','wave','wave.back_each.gold'],
    ];
    return {data, native:true, nativeValues, metric,
      resources:definitions.map(([id, category, name, prefix, goldKey = `${prefix}.gold`]) => ({id, category, name, gold:metric(goldKey), first:metric(`${prefix}.first_spawn_s`), respawn:metric(`${prefix}.respawn_interval_s`), status:text(nativeValues[goldKey]?.status === 'unknown' ? '待标定' : nativeValues[goldKey]?.status)})),
      sharing:{per_person_ratio:{1:metric('sharing.solo_each'), 2:metric('sharing.duo_each')}, last_hit_bonus_ratio:metric('sharing.last_hit_bonus')},
      // No universal support ratio: the source distinguishes bird/local and a representative time.
      support:{extra_ratio:null, extra_gold:null, condition:'按资源与局内时点分别核对；2+辅助独立额外仍待标定'},
    };
  }
  const resources = (Array.isArray(data?.resources) ? data.resources : []).map((r, i) => ({
    id:String(i), name:text(r.name), category:text(r.category), gold:valueOf(r.gold), first:valueOf(r.first_spawn_s), respawn:valueOf(r.respawn_s), status:text(r.status || '待标定'),
  }));
  return {data, resources, sharing:data?.sharing || null, support:data?.support || null};
}

// Percentages are explicit inputs: each non-support share, last-hit extra, support extra.
// No flooring is invented; results are shown to three decimal places.
export function calculateDistribution({base, people, lastHit, share, lastHitBonus, supportBonus = 0, supportFixed = 0}) {
  if (!Number.isInteger(people) || people < 1 || people > 5 || !numeric(base) || base < 0 || base > 1e9) return {error:'人数须为 1–5 的整数，基础金币须在 0–1,000,000,000 之间。'};
  if ([share, lastHitBonus, supportBonus].some(v => !numeric(v) || v < 0 || v > 10)) return {error:'待标定：分配比例、补刀额外比例或辅助额外比例缺失／无效。'};
  if (!numeric(supportFixed) || supportFixed < 0 || supportFixed > 1e9 || (supportFixed > 0 && supportBonus > 0)) return {error:'待标定：固定额外 A 缺失／无效，且不能与比例额外叠加。'};
  const recipients = Array.from({length:people}, (_, i) => base * (share + (lastHit && i === 0 ? lastHitBonus : 0)));
  const support = base * supportBonus + supportFixed;
  return {recipients, support, total:recipients.reduce((sum, gold) => sum + gold, 0) + support};
}

export function initInfoPanels({document:doc = globalThis.document, fetch:fetcher = globalThis.fetch} = {}) {
  const root = doc.getElementById('knowledge-panels'), serverControl = doc.getElementById('server');
  if (!root || !serverControl) return null;
  const node = (tag, content = '', className = '') => {const el = doc.createElement(tag); el.textContent = content; if (className) el.className = className; return el;};
  const get = id => doc.getElementById(id);
  const option = (value, label) => {const el = node('option', label); el.value = value; return el;};
  const table = (caption, headers, rows) => {
    const wrap = node('div', '', 'info-table-wrap'), el = node('table'), head = node('thead'), header = node('tr'), body = node('tbody');
    el.append(node('caption', caption));
    for (const label of headers) {const th = node('th', label); th.scope = 'col'; header.append(th);}
    head.append(header);
    for (const cells of rows) {const row = node('tr'); cells.forEach((cell, i) => {const td = node(i === 0 ? 'th' : 'td', String(cell)); if (i === 0) td.scope = 'row'; row.append(td);}); body.append(row);}
    el.append(head, body); wrap.append(el); return wrap;
  };
  const control = (container, id, label, choices) => {
    const field = node('label', label); field.htmlFor = id;
    const select = node('select'); select.id = id;
    for (const [value, title] of choices) select.append(option(value, title));
    field.append(select); container.append(field); return select;
  };
  const input = (container, id, label, initial, min, max, step = 'any') => {
    const field = node('label', label); field.htmlFor = id;
    const el = node('input'); Object.assign(el, {id, type:'number', value:String(initial), min:String(min), max:String(max), step:String(step)});
    field.append(el); container.append(field); return el;
  };
  const state = {generation:0, bundle:null, server:serverControl.value, scoring:null, economy:null};
  const header = node('div', '', 'info-heading');
  const title = node('h2', '战术资料台'); title.id = 'knowledgeTitle';
  const scope = node('span', '', 'tag warning'); scope.id = 'infoScope';
  const retry = node('button', '重新读取资料'); retry.type = 'button'; retry.id = 'infoRetry';
  header.append(title, scope, retry);
  const intro = node('p', '静态资料 / 合成演示。评分与经济按服务器分库；视频时间 ≠ 局内时间。模板为归纳改写，数值和适用版本仍需标定。', 'info-intro');
  const status = node('p', '', 'info-status'); status.id = 'infoStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const nav = node('nav', '', 'info-nav'); nav.setAttribute('aria-label', '战术资料面板');
  const panels = {};
  for (const [id, label] of [['scoring','英雄评分'], ['economy','经济规则'], ['command','指挥手册'], ['dragon','龙团规则']]) {
    const link = node('a', label); link.href = `#info-${id}`; nav.append(link);
    const section = node('section', '', 'panel info-panel'); section.id = `info-${id}`; section.setAttribute('aria-labelledby', `info-${id}-title`);
    const heading = node('h2', label); heading.id = `info-${id}-title`;
    const content = node('div'); content.id = `info-${id}-content`; section.append(heading, content); panels[id] = content;
  }
  root.replaceChildren(header, intro, nav, status, ...Object.values(panels).map(content => content.parentElement));
  root.setAttribute('aria-labelledby', 'knowledgeTitle');
  const sourceNote = (container, bank) => {
    container.append(node('p', `来源：${text(bank?.source)}${bank?.sha256 ? ` · 快照 ${bank.sha256.slice(0, 12)}` : ''}`, 'info-source'));
  };
  const bankStatus = bank => !bank || bank.availability === 'missing' ? '待生成 · 参数待标定' : bank.availability !== 'available' ? '参数文件无效 · 待标定' : !bankData(bank, state.server) ? '服务器或版本不匹配 · 已拒绝 · 待标定' : '来源参数快照 · 适用补丁与实测校准状态请核对';

  function renderScoring() {
    const box = panels.scoring, bank = state.bundle?.scoring;
    box.replaceChildren(node('p', bankStatus(bank), 'info-status'));
    const model = state.scoring = normalizeScoring(bank, state.server);
    sourceNote(box, bank);
    box.append(node('p', `参数服：${state.server.toUpperCase()} · 补丁：${text(model.patch)} · 评分版本：${text(model.version)}`, 'info-source'));
    if (model.historical) box.append(node('p', '2025-11/12 历史评分 · 待更新。1 分：单出较弱 / 突破口；2 分：对阵容基本无副作用；3 分：单出较强 / 节奏点。以下仅做同一历史资料版本内的算术演示，游戏补丁待标定，不进入上方合成模型。', 'info-intro'));
    if (model.native && state.server === 'hok') box.append(node('p', 'HOK 英雄映射、分路与评分全部待单独标定。结构占位不转入 CN 名称或数值。', 'info-intro'));
    box.append(table('五路分档；空档不推断英雄评分', ['分路', '1 分', '2 分', '3 分', '未定分'], Object.entries(ROLES).map(([role, name]) => [name, ...[1,2,3,null].map(score => model.heroes.filter(h => h.role === role && h.score === score).map(h => h.name).join('、') || (bank?.availability === 'missing' ? '待生成' : '待标定'))])));
    const picks = node('div', '', 'info-controls'); picks.id = 'infoHeroPicks';
    const chosen = new Set();
    for (const [role, name] of Object.entries(ROLES)) {
      const choices = model.heroes.filter(h => h.role === role).map(h => [h.id, `${h.name} · ${fmt(h.score)}${h.score === null ? '' : ' 分'}`]);
      const select = control(picks, `info-hero-${role}`, `${name}英雄`, choices.length ? choices : [['', '待生成 / 待标定']]);
      const initial = model.heroes.find(h => h.role === role && h.score !== null && !chosen.has(h.name));
      if (initial) {select.value = initial.id; chosen.add(initial.name);}
      select.disabled = !choices.length; select.addEventListener('change', renderPairs);
    }
    const pairs = node('div'); pairs.id = 'infoPairs'; pairs.setAttribute('aria-live', 'polite');
    box.append(node('h3', model.historical ? '历史两两组合总分' : '两两组合总分'), node('p', '选择五路英雄，列出十组两两相加。只在同一资料版本内求和；未知英雄保持空值，重复选同一英雄不计组合。配合效果及当前补丁适用性待标定。', 'info-intro'), picks, pairs);
    renderPairs();
  }
  function renderPairs() {
    const model = state.scoring, roles = Object.keys(ROLES), rows = [];
    for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) {
      const a = model.heroes.find(h => h.id === get(`info-hero-${roles[i]}`).value), b = model.heroes.find(h => h.id === get(`info-hero-${roles[j]}`).value);
      const valid = a?.score != null && b?.score != null && a.name !== b.name && (model.patch || model.historical) && model.version;
      rows.push([`${ROLES[roles[i]]} + ${ROLES[roles[j]]}`, a && b ? `${a.name} + ${b.name}` : '待生成', valid ? `${a.score} + ${b.score} = ${a.score + b.score} 分${model.historical ? '（历史）' : ''}` : a && b && a.name === b.name ? '重复英雄，不计分' : '待标定']);
    }
    const selected = roles.map(role => model.heroes.find(h => h.id === get(`info-hero-${role}`).value));
    const complete = selected.every(h => h?.score != null) && new Set(selected.map(h => h?.name)).size === 5 && (model.patch || model.historical) && model.version;
    const total = node('p', `独立五人总分：${complete ? `${selected.reduce((sum, h) => sum + h.score, 0)} 分${model.historical ? '（历史算术）' : ''}` : '待标定'}；仅加五名英雄，不叠加重叠组合。`, 'info-status'); total.id = 'infoTeamTotal';
    const evidence = node('details'); evidence.append(node('summary', '所选英雄的来源与缺项'));
    for (const hero of selected.filter(Boolean)) {
      const refs = (Array.isArray(hero.source) ? hero.source : []).map(ref => `${text(ref.file || ref.bv)} · 视频 ${fmt(ref.seconds)} 秒`).join('；');
      evidence.append(node('p', `${ROLES[hero.role]} / ${hero.name}：${text(hero.status || '待标定')}；${text(hero.notes || '按资料记录，未画面核验')}；${refs || '来源待标定'}`, 'info-source'));
    }
    get('infoPairs').replaceChildren(total, table('五路所选英雄的十组组合', ['组合', '英雄', '总分'], rows), evidence);
  }
  function renderEconomy() {
    const box = panels.economy, bank = state.bundle?.economy;
    box.replaceChildren(node('p', bankStatus(bank), 'info-status'));
    sourceNote(box, bank);
    const model = state.economy = normalizeEconomy(bank, state.server);
    box.append(node('p', `资料版本：${text(model.data?.version || model.data?.data_version)} · 游戏补丁：${text(model.data?.game_patch || model.data?.patch)} · ${text(model.data?.status || '待标定')}`, 'info-source'));
    if (model.native) box.append(node('p', text(model.data.source_scope), 'info-intro'));
    box.append(table('野怪 / 兵线 / 刷新；来源未提供的单项保持待标定', ['类别', '资源', '基础金币', '首次刷新（秒）', '刷新间隔（秒）', '来源状态'], model.resources.length ? model.resources.map(r => [r.category, r.name, fmt(r.gold), fmt(r.first), fmt(r.respawn), r.status]) : ['野怪', '兵线'].map(category => [category, '待生成', '待标定', '待标定', '待标定', '待标定'])));
    const sharingRows = [1,2,3,4,5].map(n => [n, fmt(valueOf(model.sharing?.per_person_ratio?.[n])), fmt(valueOf(model.sharing?.last_hit_bonus_ratio))]);
    box.append(table('并线分钱；比例相对基础金币，补刀额外只给补刀者', ['分钱人数（不含额外辅助）', '每人基础比例', '补刀者额外比例'], sharingRows));
    box.append(table('辅助额外；固定金币与比例分开核对、计算，不叠加', ['项目', '数值与单位', '适用条件'], [
      ['比例额外', `${fmt(valueOf(model.support?.extra_ratio))} × 基础金币`, text(model.support?.condition)],
      [model.native ? '2+辅助独立额外 A' : '固定额外 A', model.native ? '待标定（源字段单位：比例）' : `${fmt(valueOf(model.support?.extra_gold))} 金币`, '2 名分钱成员 + 辅助；Jason 口径待 Word 核对'],
    ]));
    box.append(node('p', '资源本体、团队奖励、聚合期望分别记账；未明确范围的数值不导入基础金币。并线固定额外 A 与辅助装比例属于不同口径，A 缺失时保持待标定。', 'info-source'));
    if (model.native) {
      const rows = [
        ['河灵 0–4 分钟期望数量', 'jungle.river.expected_count_0_4'], ['河灵 0–4 分钟聚合期望', 'jungle.river.expected_pool_0_4.gold'],
        ['红隼每人团队奖励', 'jungle.bird.team_bonus_each.gold'], ['红隼团队奖励人数', 'jungle.bird.team_bonus_count'], ['红隼全队合计', 'jungle.bird.total.gold'],
        ['前期兵线合计（含补刀与否待核）', 'wave.early_total.gold'], ['兵线暂记时点（非已确认首刷 / 周期）', 'wave.refresh_time_assumption_s'],
        ['辅助最低比例', 'support.minimum_rate'], ['辅助上限比例', 'support.maximum_rate'], ['辅助达到上限的局内时点', 'support.cap_time_s'],
        ['辅助逐秒曲线', 'support.interior_rate_curve'], ['红隼辅助代表比例（仅本体）', 'support.bird_rate'],
        ['其他资源辅助代表比例', 'support.other_rate'], ['其他比例代表局内时点', 'support.other_representative_time_s'],
        ['2+辅助独立固定比例（不套其他比例）', 'sharing.duo_support_fixed_rate'],
      ].map(([label, key]) => {
        const row = model.nativeValues[key], value = model.metric(key);
        const unit = {gold:'金币',ratio:'比例',s:'秒',game_s:'局内秒',count:'人 / 个',expected_count:'期望个数',ratio_function:'比例函数'}[row?.unit] || text(row?.unit);
        return [label, fmt(value), unit, text(row?.status === 'unknown' ? '待标定' : row?.status), text(row?.notes || '来源假设，待核实')];
      });
      box.append(table('补充口径：假设 / 用户自测 / 推导，均保留源文件状态', ['项目', '值', '单位', '来源状态', '边界'], rows));
      box.append(node('p', `Word 核对：${text(model.data.word_check?.result)}。并线仍为用户口径待核实。`, 'info-source'));
    }
    box.append(node('h3', '经济分配计算器'));
    const controls = node('div', '', 'info-controls');
    control(controls, 'infoCalcMode', '计算来源', [['bank', '当前服务器参数库'], ['demo', '手动合成演示']]);
    control(controls, 'infoCalcResource', '基础资源', model.native ? [['', '兵线基础 g（口径待标定）']] : model.resources.length ? model.resources.map(r => [r.id, r.name]) : [['', '待生成 / 待标定']]);
    input(controls, 'infoCalcPeople', '分钱人数（不含额外辅助）', 2, 1, 5, 1);
    control(controls, 'infoCalcLastHit', '补刀归属', [['yes', '成员 1 补刀'], ['no', '无人补刀']]);
    control(controls, 'infoCalcSupport', '辅助额外收益（互斥）', [['no', '不计辅助额外'], ['yes', '按比例另计 1 名辅助'], ['fixed', '2 人 + 辅助独立额外 A']]);
    const manual = node('div', '', 'info-controls'); manual.id = 'infoManual'; manual.hidden = true;
    input(manual, 'infoCalcBase', '合成基础金币', 100, 0, 1e9);
    input(manual, 'infoCalcShare', '每人基础比例（合成）', 0.5, 0, 10);
    input(manual, 'infoCalcBonus', '补刀额外比例（合成）', 0.2, 0, 10);
    input(manual, 'infoCalcSupportRatio', '辅助额外比例（合成）', 0.1, 0, 10);
    input(manual, 'infoCalcSupportFixed', '辅助固定额外 A（合成金币）', 10, 0, 1e9);
    const output = node('output', '', 'info-output'); output.id = 'infoCalcOutput'; output.setAttribute('aria-live', 'polite');
    const note = node('p', '手动演示默认用任意示例：100 金币、每人 0.5、补刀额外 0.2、辅助额外 0.1。不是实测规则。人数改变不会自动猜测比例；结果保留三位小数，游戏取整规则待标定。', 'info-source');
    box.append(controls, manual, output, note);
    for (const el of box.querySelectorAll('input,select')) {el.addEventListener('input', renderCalculation); el.addEventListener('change', renderCalculation);}
    renderCalculation();
  }
  function renderCalculation() {
    const demo = get('infoCalcMode').value === 'demo', people = Number(get('infoCalcPeople').value), lastHit = get('infoCalcLastHit').value === 'yes', supportMode = get('infoCalcSupport').value, withSupport = supportMode !== 'no';
    get('infoManual').hidden = !demo; get('infoCalcResource').disabled = demo || state.economy.native || !state.economy.resources.length;
    const field = id => get(id).value.trim() === '' ? null : Number(get(id).value);
    const resource = state.economy.resources.find(r => r.id === get('infoCalcResource').value);
    const base = demo ? field('infoCalcBase') : resource?.gold;
    const share = demo ? field('infoCalcShare') : valueOf(state.economy.sharing?.per_person_ratio?.[people]);
    const lastHitBonus = !lastHit ? 0 : demo ? field('infoCalcBonus') : valueOf(state.economy.sharing?.last_hit_bonus_ratio);
    const supportBonus = supportMode !== 'yes' ? 0 : demo ? field('infoCalcSupportRatio') : valueOf(state.economy.support?.extra_ratio);
    const supportFixed = supportMode !== 'fixed' ? 0 : demo ? field('infoCalcSupportFixed') : valueOf(state.economy.support?.extra_gold);
    const output = get('infoCalcOutput');
    if (withSupport && people >= 5) {output.textContent = '分钱成员与额外辅助合计不能超过 5 人。'; return;}
    if (supportMode === 'fixed' && people !== 2) {output.textContent = '固定额外 A 仅列出 2 名分钱成员 + 1 名辅助的口径；其他人数待标定。'; return;}
    if (!demo && state.economy.native) {
      // K explicitly leaves the base-gold last-hit basis unknown. Show symbolic
      // source arithmetic only; do not multiply 71/57/185 or apply lane sharing to camps.
      const result = calculateDistribution({base:1, people, lastHit, share, lastHitBonus});
      if (result.error) {output.textContent = result.error; return;}
      output.textContent = `来源口径系数演示 · 用户补充待核实 · 游戏补丁待标定\n${result.recipients.map((ratio, i) => `成员 ${i + 1}${i === 0 && lastHit ? '（补刀）' : ''}：${fmt(ratio)} × g`).join('\n')}\n${withSupport ? '辅助独立额外：待标定；分配合计：待标定（不套 26% / 27.5%）。' : `分配合计：${fmt(result.total)} × g`}\ng 为不含补刀的基础收益，仍待标定；不自动乘 71 / 57 / 185，不输出实际金币。`;
      return;
    }
    if (!demo && (!state.economy.data?.patch || !(state.economy.data?.data_version || state.economy.data?.version) || [base, share, lastHitBonus, supportBonus, supportFixed].some(v => !numeric(v)))) {output.textContent = `${state.server.toUpperCase()} 参数待生成 / 待标定：当前条件缺少分配参数或版本，暂不输出金币。可选择手动合成演示。`; return;}
    const result = calculateDistribution({base, people, lastHit, share, lastHitBonus, supportBonus, supportFixed});
    if (result.error) {output.textContent = result.error; return;}
    output.textContent = `${demo ? '合成演示 · 手动输入' : `${state.server.toUpperCase()} 来源规则计算 · 版本待核`}\n${result.recipients.map((gold, i) => `成员 ${i + 1}${i === 0 && lastHit ? '（补刀）' : ''}：${fmt(gold)} 金币`).join('\n')}${withSupport ? `\n辅助额外${supportMode === 'fixed' ? '（固定 A）' : ''}：${fmt(result.support)} 金币` : ''}\n分配合计：${fmt(result.total)} 金币\n每人 = 基础金币 × 每人比例；补刀额外 = 基础金币 × 补刀比例；${supportMode === 'fixed' ? '辅助单独加固定 A，不加比例额外。' : '辅助额外 = 基础金币 × 辅助比例，不加固定 A。'}`;
  }
  function renderCommand() {
    const box = panels.command, data = state.bundle?.command;
    box.replaceChildren(node('p', `${state.server.toUpperCase()} · ${state.server === 'hok' ? 'CN 来源模板参考，HOK 适用条件待标定' : 'CN 转写提炼，非原音画核验'}。先报信息，再确认与执行；口头回执不等于已到场。`, 'info-intro'));
    sourceNote(box, data);
    const cards = node('div', '', 'info-cards');
    for (const card of Array.isArray(data?.cards) ? data.cards : []) {
      const el = node('article', '', 'info-card'); el.dataset.category = card.category;
      el.append(node('h3', text(card.category)), node('p', text(card.condition)), node('blockquote', text(card.template)), node('p', '归纳模板 · 视频时间，仅供行为参考', 'info-source')); cards.append(el);
    }
    if (!cards.children.length) cards.append(node('p', '指挥模板待生成；触发条件待标定。', 'info-pending'));
    box.append(cards);
  }
  function renderDragon() {
    const box = panels.dragon, data = state.bundle?.dragon;
    box.replaceChildren(node('p', `${state.server.toUpperCase()} · 规则摘要 / 合成演示；${state.server === 'hok' ? 'CN/KPL 资料仅作框架参考，HOK 数值独立待标定。' : '依据转写归纳，尚未作画面复核。'}本场没有已核实风暴龙事件。`, 'info-intro'));
    sourceNote(box, data);
    box.append(table('普通龙与风暴龙：先检查可行性，再比较候选', ['类型', '条件与决策边界', '数值状态'], [['普通龙', text(data?.ordinary), '刷新、收益、到达与收龙耗时待标定'], ['风暴龙', text(data?.storm), '终结风险与代价权重待标定，不填倍率']]));
    box.append(node('p', '决策卡不读取实时局面，不判定当前行动已满足条件。信息缺失为未知；视野、人数、技能或基地压力变化后重评。', 'info-intro'));
    const cards = node('div', '', 'info-cards');
    for (const card of Array.isArray(data?.cards) ? data.cards : []) {
      const el = node('article', '', 'info-card'); el.dataset.action = card.id;
      const detail = node('details'); detail.append(node('summary', '查看摘要依据'), node('p', text(card.evidence)));
      el.append(node('h3', text(card.title)), node('p', text(card.description)), node('p', '当前条件：待标定', 'info-status'), detail); cards.append(el);
    }
    if (!cards.children.length) cards.append(node('p', '龙团摘要待生成；当前条件待标定。', 'info-pending'));
    box.append(cards);
  }
  function render() {renderScoring(); renderEconomy(); renderCommand(); renderDragon();}
  async function load() {
    const generation = ++state.generation, server = serverControl.value;
    state.server = server; state.bundle = null; scope.textContent = `${server.toUpperCase()} · 静态资料 / 合成演示`;
    root.dataset.server = server; root.dataset.loading = 'true'; root.setAttribute('aria-busy', 'true');
    status.textContent = '正在读取本服资料…'; render();
    try {
      const response = await fetcher(`./data/info-${server}.json`, {cache:'no-cache'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bundle = await response.json();
      if (generation !== state.generation) return;
      if (bundle?.protocol !== 'hok-info-panels-v1' || bundle.server !== server) throw new Error('资料服或格式不一致');
      state.bundle = bundle; render(); status.textContent = '资料已加载。缺失项保留待生成 / 待标定；参数更新后需重新同步静态快照。';
    } catch (error) {
      if (generation !== state.generation) return;
      state.bundle = null; render(); status.textContent = '资料读取失败或格式不一致，所有缺项保持待标定。可重新读取资料。';
    } finally {
      if (generation === state.generation) {root.dataset.loading = 'false'; root.setAttribute('aria-busy', 'false');}
    }
  }
  serverControl.addEventListener('change', load); retry.addEventListener('click', load);
  const ready = load();
  return {ready, reload:load, destroy() {state.generation++; serverControl.removeEventListener('change', load); retry.removeEventListener('click', load);}};
}

if (typeof document !== 'undefined' && document.getElementById('knowledge-panels')) initInfoPanels();
