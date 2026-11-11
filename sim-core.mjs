// Browser executor of hok-macro-v2. No network, hidden world access, or real win rates.
export const ROLES = ['clash', 'mid', 'farm', 'jungle', 'roam'];
export const STYLES = ['conservative', 'aggressive', 'roam', 'yield', 'split'];
const clone = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw new Error(message); };
const finite = (value, name, min = null) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || (min !== null && value < min)) fail(`${name}: invalid number`);
  return value;
};
const sameScope = (a, b) => {
  if (!['cn', 'hok'].includes(a.server) || !a.patch || a.server !== b.server || a.patch !== b.patch) fail('禁止跨服/跨补丁');
};
const cents = value => {
  finite(value, 'gold', 0);
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result) || Math.abs(value * 100 - result) > 1e-6) fail('gold must have <= 2 decimal places');
  return result;
};
const round6 = value => Math.round(value * 1e6) / 1e6;

// Read-only commentary, matching simulator/commentary.py. Never infer numeric
// evidence from program parameters or the final world state.
const PENDING = '待标定';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const numberText = value => isNumber(value) ? String(value) : PENDING;
const teamNames = {blue:'蓝方', red:'红方'};
const labelFor = (labels, key) => Object.hasOwn(labels, key) ? labels[key] : null;
const kindNames = {
  action_started:'开始行动', action_finished:'结束行动', resource_unavailable:'资源不可再结算',
  pending:'行动缺参', dependency_blocked:'前置依赖阻断', action_blocked:'行动受阻',
  support_failed:'支援未兑现', preparation:'准备行动', arrival:'到达目标位置',
  teammate_arrival:'队友到场', spawn:'资源刷新', wave_arrival:'兵线到达', completed:'行动完成',
  push_recheck:'复核推塔条件', interrupted:'行动中断', cast:'施放技能', hit:'命中判定',
  followup:'跟进判定', hp_changed:'血量变化', death:'阵亡', respawn:'复活', action_rejected:'行动被拒绝',
};
const inputLabels = {
  travel_s:'转场耗时', clear_s:'清线耗时', push_s:'推塔耗时', enemy_return_s:'敌方回防耗时',
  danger_seen_s:'发现危险耗时', escape_s:'撤离耗时', hold_s:'正面可守耗时', wave_arrived:'兵线已到',
  source_value:'原资源收益', target_value:'目标收益', source_weight:'原资源权重', target_weight:'目标权重',
  source_time:'原资源耗时', target_time:'目标耗时', enemy_cd_s:'敌方冷却窗口', combo_s:'连招耗时',
  followup_s:'跟进耗时', remaining_control_s:'剩余控制窗口', hidden_alive:'未现身敌人数',
  shortest_respawn_s:'最短复活窗口', target_visible:'目标可见', signal_received:'信号已收到',
  known_opponents:'已知对手数', x:'争夺参数', value:'参数值', spawn_at:'刷新时点',
};

// Also used by the explanation panel for free-text provenance and raw details.
export function commentaryText(value) {
  if (typeof value !== 'string' || !value.trim() || /胜率|真实|实测|现实|win[ _-]?(?:rate|prob)|real[ -]?(?:world|match|data)/i.test(value)) return null;
  return value.trim().replace(/[。！？!?\r\n]+|\.(?=\s|$)/g, '；').replace(/^[； ]+|[； ]+$/g, '') || null;
}

export function explainEvent(event, program = null, context = null) {
  if (!isRecord(event)) throw new TypeError('event must be an object');
  const d = isRecord(event.details) ? event.details : {}, missing = new Set(), reasons = [];
  const text = (...values) => values.map(commentaryText).find(value => value !== null);
  const amount = (label, ...values) => {
    const value = values.find(isNumber);
    if (value === undefined) missing.add(label);
    return numberText(value);
  };
  const scalar = (value, label) => {
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (isNumber(value)) return numberText(value);
    const result = commentaryText(value);
    if (result === null) missing.add(label);
    return result ?? PENDING;
  };
  const fields = value => {
    if (!isRecord(value)) return [];
    return Object.entries(value).flatMap(([key, val]) => {
      if (['scope','source','key'].includes(key) || Array.isArray(val)) return [];
      const label = labelFor(inputLabels, key) || commentaryText(key);
      if (!label) return [];
      if (isRecord(val)) return fields(val);
      const unit = !isNumber(val) ? '' : key.endsWith('_s') || ['source_time','target_time','spawn_at','ult_ready_at'].includes(key) ? '秒' : ['source_value','target_value'].includes(key) ? '金币' : '';
      return [`${label}为${scalar(val, label)}${unit}`];
    });
  };
  const calibration = (value, inInputs = false) => {
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (['observation','metric','reward','parameter','probability_source'].includes(key)) continue;
      if (key === 'missing' && Array.isArray(child)) child.forEach(name => { if (commentaryText(name)) missing.add(commentaryText(name)); });
      else if (key === 'status' && ['unknown', PENDING].includes(child)) missing.add('规则参数');
      else if (child === null && (inInputs || ['finish_s','deadline_s','busy_until','duration_s','travel_s','gold','earned_gold','spent','clear_multiplier','objective_multiplier','seconds'].includes(key))) missing.add(labelFor(inputLabels, key) || commentaryText(key) || '参数');
      else calibration(child, inInputs || key === 'inputs');
    }
  };
  const ruleParts = rule => [commentaryText(rule?.reason), ...fields(rule?.inputs)].filter(Boolean);
  const checksParts = checks => {
    let candidates = Object.values(isRecord(checks) ? checks : {}).filter(isRecord);
    candidates.forEach(rule => calibration(rule));
    const blocked = candidates.filter(rule => ['reject','unknown'].includes(rule.status));
    if (blocked.length) candidates = blocked;
    candidates.sort((a,b) => Number(a.status !== 'reject') - Number(b.status !== 'reject') || Number(!Object.keys(a.inputs || {}).length) - Number(!Object.keys(b.inputs || {}).length));
    return candidates.slice(0,2).flatMap(ruleParts);
  };
  const kind = commentaryText(event.kind), actionId = event.action_id ?? d.action_id;
  const action = Array.isArray(program?.events) ? program.events.find(a => isRecord(a) && a.id === actionId) : null;
  const fallback = context?.actions?.[actionId];
  const settled = ['settled','resource_settled'].includes(kind);
  const team = settled ? text(d.winner) : text(event.team, d.team, d.observation?.team, action?.team, fallback?.team);
  const target = text(d.target, d.resource_id, d.rules?.action?.target, action?.target, fallback?.target);
  if (!kind) missing.add('事件类型');
  if (!isNumber(event.at)) missing.add('时间');
  if (!team) missing.add('队伍');
  const when = isNumber(event.at) ? `${numberText(event.at)}秒` : '时间待标定';
  const who = labelFor(teamNames, team) || team || '队伍待标定';
  const resource = () => { if (!target) missing.add('资源'); return target || '资源待标定'; };
  let fact;
  if (settled) {
    fact = `${when}，${who}结算${resource()}，收益${amount('收益', d.gold, d.reward?.value, d.metric?.value)}金币`;
    if (isRecord(d.allocation) && Object.keys(d.allocation).length) {
      reasons.push('按事件中的收益分配，' + Object.entries(d.allocation).map(([id,value]) => `${commentaryText(id) || '接收者待标定'}获得${amount('收益分配', value)}金币`).join('，'));
    } else {
      const value = [d.reward?.value, d.metric?.value].find(isNumber);
      if (value !== undefined) reasons.push(`结算依据中的资源价值为${numberText(value)}金币`);
    }
    if (commentaryText(d.reason)) reasons.push(commentaryText(d.reason));
  } else if (['resource_contest','contest_sample'].includes(kind)) {
    fact = `${when}，${who}触发${resource()}的资源争夺采样`;
    reasons.push(`资源争夺先验为${amount('资源争夺先验', d.probability)}，采样值为${amount('采样值', d.draw)}`, ...fields(d.observed));
  } else if (kind === 'decision') {
    if (isRecord(d.report)) {
      const status = commentaryText(d.report.status), outcome = text(d.report.outcome, d.report.choice);
      if (!status) missing.add('决策状态');
      if (!outcome) missing.add('决策结果');
      fact = `${when}，${who}决策结果为${outcome || PENDING}（${labelFor({allow:'规则放行', reject:'规则拒绝'}, status) || PENDING}）`;
      reasons.push(...ruleParts(d.report));
      if (isNumber(d.report.finish_s)) reasons.push(`行动总耗时为${numberText(d.report.finish_s)}秒`);
    } else {
      const selected = commentaryText(d.selected);
      fact = `${when}，${who}决策结果为${selected || (d.selected === null ? '未选出可执行行动' : PENDING)}`;
      for (const evaluation of Array.isArray(d.evaluations) ? d.evaluations : []) {
        if (isRecord(evaluation) && (!selected || evaluation.action?.action_id === selected)) reasons.push(...checksParts(evaluation.checks));
      }
    }
  } else if (kind === 'opportunity_cost') {
    fact = `${when}，${who}错过${resource()}，机会成本为${amount('机会成本', d.value)}金币（未作实际扣款）`;
    if (commentaryText(d.reason)) reasons.push(commentaryText(d.reason));
  } else if (kind === 'item_formed') {
    const player = text(d.player_id, event.actor);
    if (!player) missing.add('装备接收者');
    fact = `${when}，${who}的${player || PENDING}触发装备成型记录，累计收入${amount('累计收入', d.earned_gold)}金币`;
    reasons.push(`装备记录的支出为${amount('装备支出', d.equipment?.spent)}金币，清线耗时倍率为${amount('清线耗时倍率', d.equipment?.clear_multiplier)}，资源行动耗时倍率为${amount('资源行动耗时倍率', d.equipment?.objective_multiplier)}`);
  } else {
    const id = text(event.action_id, d.action_id);
    fact = `${when}，${who}${labelFor(kindNames, kind) || '记录事件'}${id ? `（${id}）` : ''}${target ? `，目标为${target}` : ''}`;
    if (!Object.hasOwn(kindNames, kind)) missing.add('事件解释模板');
    if (commentaryText(d.reason)) reasons.push(commentaryText(d.reason));
    for (const [key,label] of Object.entries({finish_s:'完成时点', deadline_s:'窗口关闭时点', busy_until:'占用截止时点', duration_s:'行动耗时', travel_s:'转场耗时'})) {
      if (isNumber(d[key])) reasons.push(`${label}为${numberText(d[key])}秒`);
    }
    reasons.push(...checksParts(d.rules?.checks), ...ruleParts(d.rule));
    if (Object.hasOwn(d, 'success')) reasons.push('执行成功为' + scalar(d.success, '执行结果'));
  }
  calibration(d);
  if (!reasons.length) missing.add('解释依据');
  return `${fact}。${reasons.length ? '依据：' + [...new Set(reasons)].join('；') + '。' : ''}${missing.size ? [...missing].join('、') + '待标定。' : ''}`;
}

export function summarizeRun(result) {
  if (!isRecord(result)) throw new TypeError('result must be an object');
  if ('samples' in result || 'variants' in result) throw new TypeError('summarizeRun requires a single run; pass first_run explicitly');
  const diff = isRecord(result.economy_diff) ? result.economy_diff.value : result.economy_diff;
  const sentences = [`模型内比较截至${numberText(result.time)}秒，蓝方减红方经济差为${numberText(diff)}金币`];
  if (isRecord(result.counts)) {
    sentences.push(`推塔记录：蓝方${numberText(result.counts.blue?.tower)}座，红方${numberText(result.counts.red?.tower)}座，蓝方减红方塔差为${numberText(result.tower_diff)}座`);
  } else if (isRecord(result.snapshot?.towers)) {
    const destroyed = Object.entries(result.snapshot.towers).filter(([,v]) => v?.destroyed === true).map(([key]) => commentaryText(key)).filter(Boolean);
    sentences.push('防御塔记录：' + (destroyed.length ? destroyed.join('、') + '已摧毁' : '未记录已摧毁防御塔'));
  } else sentences.push('防御塔记录待标定');
  const events = Array.isArray(result.events) ? result.events.filter(isRecord) : [];
  const settlements = events.filter(e => ['settled','resource_settled'].includes(e.kind) && isRecord(e.details));
  let owners = result.owners;
  if (!isRecord(owners) && settlements.length) owners = Object.fromEntries(settlements.map(e => [e.details.target ?? e.details.resource_id, e.details.winner]).filter(([key]) => commentaryText(key)));
  if (isRecord(owners)) {
    const priority = settlements.filter(e => ['objective','jungle','tower'].includes(e.details.category)).map(e => e.details.target ?? e.details.resource_id);
    const shown = [...new Set([...priority, ...Object.keys(owners)])].filter(key => Object.hasOwn(owners, key) && commentaryText(key)).slice(0,4).map(key => `${commentaryText(key)}归${labelFor(teamNames, owners[key]) || commentaryText(owners[key]) || PENDING}`);
    sentences.push('资源归属摘录：' + (shown.length ? shown.join('；') : '尚无已结算资源'));
  } else sentences.push('资源归属待标定');
  let window = ['action_rejected','decision','push_recheck'].map(kind => events.find(e => e.kind === kind)).find(Boolean);
  if (!window) {
    const critical = new Set(settlements.filter(e => ['objective','jungle','tower'].includes(e.details.category)).map(e => e.action_id));
    window = events.find(e => e.kind === 'action_finished' && critical.has(e.action_id)) || events.find(e => e.kind === 'item_formed');
  }
  sentences.push(window ? '关键窗口：' + explainEvent(window).replace(/。$/, '').replaceAll('。','；') : '关键窗口依据待标定');
  sentences.push(Array.isArray(result.pending_calibration) && !result.pending_calibration.length ? '参数状态：结果未列出待标定项' : '参数状态：仍有待标定项');
  return sentences.join('。') + '。';
}

export function pairedDraw(seed, key) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) fail('seed must be integer in [0, 2147483647]');
  let value = 2166136261;
  for (const byte of new TextEncoder().encode(`${seed}|${key}`)) value = Math.imul(value ^ byte, 16777619) >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return (value >>> 0) / 4294967296;
}

function parameter(program, key, unit) {
  const p = program.parameters[key];
  if (!p) return null;
  if (unit && p.unit !== unit) fail(`${key}: unit mismatch`);
  return p.metric === null ? null : p.metric.value;
}

function allocate(composition, amount, program) {
  const totalCents = cents(amount);
  const weights = composition.roster.map(p => parameter(program, p.allocation_key, 'weight'));
  if (weights.some(w => w === null)) return null;
  weights.forEach(w => finite(w, 'weight', 0));
  const total = weights.reduce((s, w) => s + w, 0);
  if (!total) fail('positive allocation weight required');
  const exact = weights.map(w => totalCents * w / total);
  const shares = exact.map(Math.floor);
  const order = weights.map((_, i) => i).sort((a, b) => {
    const delta = (exact[b] - shares[b]) - (exact[a] - shares[a]);
    return Math.abs(delta) > 1e-10 ? delta : composition.roster[a].player_id.localeCompare(composition.roster[b].player_id, 'en');
  });
  for (const i of order.slice(0, totalCents - shares.reduce((s, v) => s + v, 0))) shares[i]++;
  return Object.fromEntries(composition.roster.map((p, i) => [p.player_id, shares[i] / 100]));
}

function equipment(build, earned, program) {
  let spent = 0, clear = 1, objective = 1;
  const owned = [], missing = [];
  for (const item of build.items) {
    const cost = parameter(program, item.cost_key, 'gold');
    if (cost === null) { missing.push(item.cost_key); break; }
    finite(cost, 'item cost', 0);
    if (spent + cost > earned) break;
    spent += cost; owned.push(item.item_id);
    for (const [key, type] of [[item.clear_multiplier_key, 'clear'], [item.objective_multiplier_key, 'objective']]) {
      const value = key ? parameter(program, key, 'ratio') : 1;
      if (value === null) missing.push(key);
      else if (finite(value, 'duration multiplier') <= 0) fail('duration multiplier must be positive');
      else if (type === 'clear') clear *= value;
      else objective *= value;
    }
  }
  return {status: missing.length ? 'unknown' : 'allow', owned, spent, wallet_gold: earned - spent,
    formed: owned.length === build.items.length && !missing.length,
    clear_multiplier: missing.length ? null : clear, objective_multiplier: missing.length ? null : objective, missing};
}

function comboReport(composition, program) {
  const checks = composition.combo_chain.map(step => {
    const control = parameter(program, step.control_key, 's'), follow = parameter(program, step.followup_key, 's');
    if (control !== null) finite(control, 'control', 0);
    if (follow !== null) finite(follow, 'followup', 0);
    return {player_id: step.player_id, control_s: control, followup_s: follow,
      status: control === null || follow === null ? 'unknown' : follow < control ? 'allow' : 'reject'};
  });
  return {status: checks.some(c => c.status === 'reject') ? 'reject' : checks.some(c => c.status === 'unknown') ? 'unknown' : 'allow',
    checks, note: '仅连招时序可行性，不是命中/胜率'};
}

function contestProbability(x) {
  finite(x, 'contest x');
  if (x < -0.5 || x > 0.5) fail('p_contest x outside [-0.5,0.5]');
  return Math.round((0.5 + (311 / 420) * x + (5 / 21) * x ** 3) * 1e9) / 1e9;
}


// Recompute derived inputs before execution; parameter edits require recompilation.
function validateDerivations(program) {
  const get = (key, unit) => parameter(program, key, unit);
  const equal = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b,k) && equal(a[k],b[k]));
  };
  const check = (actual, expected, name) => {if (!equal(actual,expected)) fail(`${name} inconsistent with parameters; recompile program`);};
  const travel = path => {
    const graph = program.map;
    if (!path.length || path.some(id => !graph.nodes.some(n => n.node_id === id))) fail('invalid route nodes');
    const speed = get(graph.speed_key,'map_unit/s');
    if (speed !== null && finite(speed,'move speed') <= 0) fail('move speed must be positive');
    let seconds=0, distance=0;
    const missing=new Set(), segments=[];
    for (let i=1;i<path.length;i++) {
      const from=path[i-1],to=path[i],edge=graph.edges.find(e=>e.origin===from&&e.destination===to);
      if(!edge)fail('no directed edge');
      const length=get(edge.distance_key,'map_unit'), direct=edge.travel_key?get(edge.travel_key,'s'):null;
      const offset=edge.dash_offset_key?get(edge.dash_offset_key,'s'):0;
      if(length!==null){finite(length,'distance',0);distance+=length;}
      let duration;
      if(edge.travel_key){duration=direct;if(direct===null)missing.add(edge.travel_key);}
      else {duration=length===null||speed===null?null:length/speed;if(length===null)missing.add(edge.distance_key);if(speed===null)missing.add(graph.speed_key);}
      if(offset===null)missing.add(edge.dash_offset_key);
      if(duration!==null&&offset!==null){duration=finite(duration+offset,'travel with displacement',0);seconds+=duration;}
      segments.push({from,to,distance:length,seconds:duration,dash_offset_s:offset});
    }
    return {status:missing.size?'unknown':'allow',seconds:missing.size?null:seconds,
      distance:segments.some(s=>s.distance===null)?null:distance,segments,missing:[...missing].sort(),
      note:'指定路径耗时；坐标来自map_kit，距离/位移效果不由图片猜测'};
  };
  const route=(a,b)=>travel(a===b?[a]:[a,b].includes('mid')?[a,b]:[a,'mid',b]);
  for(const resource of Object.values(program.resources)) {
    const camp=program.camps[resource.resource_id];if(!camp)continue;
    if(typeof resource.spawn_id!=='string'||!/^\d+$/.test(resource.spawn_id))fail('camp spawn_id must be a nonnegative integer string');
    const index=Number(resource.spawn_id),first=get(camp.spawn_key,'s'),refresh=camp.refresh_key?get(camp.refresh_key,'s'):null;
    if(!Number.isSafeInteger(index))fail('invalid spawn_id');
    if(first!==null)finite(first,'spawn',0);
    if(refresh!==null&&finite(refresh,'refresh')<=0)fail('refresh must be positive');
    check(resource.spawn_at,first===null||(index>0&&refresh===null)?null:first+index*(refresh??0),'spawn_at/refresh');
  }
  for(const event of program.events) {
    if(event.kind==='harvest') {
      const segments=event.travel.segments;
      if(segments.some((s,i)=>i&&segments[i-1].to!==s.from))fail('disconnected travel segments');
      check(event.travel,travel(segments.length?[segments[0].from,...segments.map(s=>s.to)]:[program.map.nodes[0].node_id]),'travel');
    } else if(event.kind==='explain') {
      let expected;
      if(event.id==='split.evaluate') {
        const c=program.options.split_case;
        const v={travel_s:route('mid','tower').seconds,clear_s:get('split_clear_s','s'),push_s:get('split_push_s','s'),
          enemy_return_s:get(c==='swap'?'enemy_return.slow':'enemy_return.fast','s'),
          danger_seen_s:get(c==='empty'?'danger_seen.early':'danger_seen.late','s'),escape_s:get('escape_s','s'),hold_s:get('hold_s','s'),
          wave_arrived:Object.hasOwn(program.options,'wave_arrived')?program.options.wave_arrived:true};
        for(const [k,value] of Object.entries(v))if(k!=='wave_arrived'&&value!==null)finite(value,k,0);
        if(v.wave_arrived!==null&&typeof v.wave_arrived!=='boolean')fail('wave_arrived must be boolean/null');
        if(v.wave_arrived===false)expected={status:'reject',outcome:'无功',reason:'无已到塔兵线',inputs:v};
        else if(Object.values(v).some(x=>x===null))expected={status:'unknown',outcome:null,reason:'带线/回防/退路输入待标定',inputs:v};
        else {
          const finish=v.travel_s+v.clear_s+v.push_s;let outcome,reason;
          if(finish+v.escape_s<v.enemy_return_s&&finish<v.hold_s){outcome='换塔';reason='推塔并撤离早于敌方回防，四人组能守住该窗口';}
          else if(v.danger_seen_s+v.escape_s<v.enemy_return_s){outcome='无功';reason='无法安全推完，观察到回防后及时撤退';}
          else {outcome='被抓';reason='合成回防拦截窗口先于撤离；不是现实被抓概率';}
          expected={status:'allow',outcome,finish_s:finish,reason,inputs:v};
        }
      } else if(event.id==='tempo.choice') {
        const source=program.camps.small,target=program.camps.dragon;
        const total=(camp,key)=>{const t=route('mid',camp.node).seconds,d=get(key,'s');return t===null||d===null?null:t+d;};
        const v={source_value:get(source.reward_key,'gold'),target_value:get(target.reward_key,'gold'),
          source_weight:get(source.contest_weight_key,'weight'),target_weight:get(target.contest_weight_key,'weight'),
          source_time:total(source,'camp_s'),target_time:total(target,'objective_s')};
        for(const [k,value] of Object.entries(v))if(value!==null)finite(value,k,0);
        if(Object.values(v).some(x=>x===null))expected={status:'unknown',choice:null,inputs:v,reason:'节奏收益/权重/耗时待标定'};
        else {
          if(v.source_time<=0||v.target_time<=0)fail('tempo action times must be positive');
          const small=v.source_value*v.source_weight/v.source_time,dragon=v.target_value*v.target_weight/v.target_time;
          expected={status:'allow',choice:dragon>small?'dragon':'small',inputs:v,scores:{small,dragon},reason:'合成优先级=收益×争夺权重/总耗时；权重不改变金币或p_contest'};
        }
      } else fail('unknown derived report');
      check(event.report,expected,'report');
      if(event.id==='split.evaluate') {
        const payouts=program.events.filter(e=>e.id.startsWith('split.tower.')||e.id==='split.caught').map(e=>[e.id,e.team,e.target,e.at]);
        let wanted=[];
        if(expected.outcome==='换塔')wanted=['blue','red'].map(t=>[`split.tower.${t}`,t,`tower.trade.${t}#0`,event.at+expected.finish_s]);
        else if(expected.outcome==='被抓')wanted=[['split.caught','red','kill.splitter#0',event.at+expected.inputs.enemy_return_s]];
        check(payouts,wanted,'report income schedule');
      } else {
        const chosen=expected.choice,camp=program.camps[chosen];
        const first=camp?get(camp.spawn_key,'s'):null;
        const wanted=chosen&&first!==null&&first<=program.config.horizon_s?[`${chosen}#0`]:[];
        check(program.events.filter(e=>e.id==='tempo.execute').map(e=>e.target),wanted,'report action');
      }
    }
  }
}

export function validateProgram(program) {
  if (program.protocol !== 'hok-macro-v2') fail('unknown experiment protocol');
  const cfg = program.config;
  sameScope(cfg, cfg);
  if (cfg.synthetic !== true || !cfg.data_version || !cfg.model_version) fail('合成配置/数据版本缺失');
  if (finite(cfg.horizon_s, 'horizon') <= 0 || cfg.horizon_s > 240) fail('horizon out of range');
  if (['alpha', 'beta', 'gamma'].some(k => cfg[k] !== 0)) fail('实验参数必须关闭');
  for (const p of Object.values(program.parameters)) {
    if (!['待标定', '合成', '实测', '先验'].includes(p.status) || !p.unit) fail('parameter metadata invalid');
    if ((p.metric === null) !== (p.status === '待标定')) fail('null/status mismatch');
    if (p.metric) {
      sameScope(cfg, p.metric); finite(p.metric.value, 'metric value');
      if (p.unit !== p.metric.unit || !p.metric.source || !p.metric.observed_at) fail('metric provenance/unit missing');
      if (!['high', 'medium', 'low', 'unknown'].includes(p.metric.confidence)) fail('confidence invalid');
      if (p.metric.sample_size !== null && (!Number.isInteger(p.metric.sample_size) || p.metric.sample_size < 0)) fail('sample size invalid');
      if (p.status === '实测' && !(p.metric.sample_size > 0)) fail('measured parameter requires samples');
    }
  }
  for (const obj of [program.map, program.split_plan, ...program.lane_plans, ...Object.values(program.camps), ...Object.values(program.builds), ...Object.values(program.compositions)]) sameScope(cfg, obj);
  if (Object.keys(program.compositions).sort().join(',') !== 'blue,red') fail('both teams required');
  for (const c of Object.values(program.compositions)) {
    if (c.roster.length !== 5 || new Set(c.roster.map(p => p.player_id)).size !== 5 || new Set(c.roster.map(p => p.lane)).size !== 5) fail('five distinct roster members/lanes required');
    if (c.roster.some(p => p.late_carry !== null && typeof p.late_carry !== 'boolean')) fail('carry must be boolean/null');
    if (c.roster.filter(p => p.late_carry).length > 4) fail('C_count range 0..4');
    const ids = new Set(c.roster.map(p => p.player_id));
    if (c.combo_chain.some(p => !ids.has(p.player_id)) || c.split_capability.some(p => !ids.has(p))) fail('combo/split roster mismatch');
    for (const p of c.roster) if (!program.builds[p.build_id] || !p.hero_id.startsWith('hero.')) fail('build/hero unknown');
  }
  for (const [key, r] of Object.entries(program.resources)) {
    if (key !== `${r.resource_id}#${r.spawn_id}` || key !== r.instance_id) fail('resource/spawn identity mismatch');
    if (!['wave','jungle','objective','tower','kill'].includes(r.category)) fail('resource category invalid');
    if (r.spawn_at !== null) finite(r.spawn_at, 'spawn', 0);
    parameter(program, r.reward_key, 'gold');
  }
  const events = new Map(program.events.map(e => [e.id, e]));
  if (events.size !== program.events.length) fail('duplicate event ID');
  for (const e of events.values()) {
    if (!program.compositions[e.team] || !['harvest','income','opportunity','explain'].includes(e.kind)) fail('event team/kind unknown');
    const ids = program.compositions[e.team].roster.map(p => p.player_id);
    if (e.actor !== null && !ids.includes(e.actor)) fail('actor unknown');
    if (['harvest','income','opportunity'].includes(e.kind) && !program.resources[e.target]) fail('target unknown');
    if ((e.at === null) === (e.after === null)) fail('exactly one of at/after required');
    if (e.at !== null) finite(e.at, 'event timestamp', 0);
    if (e.kind === 'harvest') {
      if (!e.actor || ![null,'clear','objective'].includes(e.duration_effect)) fail('harvest actor/effect invalid');
      if (e.travel.seconds !== null) finite(e.travel.seconds, 'travel', 0);
    }
    const seen = new Set([e.id]);
    for (let parent = e.after; parent !== null; parent = events.get(parent).after) {
      if (seen.has(parent) || !events.has(parent)) fail('missing/cyclic event dependency');
      seen.add(parent);
    }
  }
  validateDerivations(program);
  return true;
}

export function runProgram(program, seed = 7) {
  pairedDraw(seed, 'validate'); validateProgram(program);
  const cfg = program.config, comps = program.compositions, resources = program.resources;
  const players = {}, profiles = {}, owners = {}, events = [], entries = [], opportunities = new Map(), missing = new Set();
  const balances = {blue: 0, red: 0}; // integer cents
  for (const [team, composition] of Object.entries(comps)) {
    players[team] = {}; profiles[team] = {};
    for (const p of composition.roster) {
      profiles[team][p.player_id] = p;
      players[team][p.player_id] = {gold: 0, formed_at: equipment(program.builds[p.build_id], 0, program).formed ? 0 : null, busy_until: 0};
    }
  }
  let now = 0, sequence = 0;
  const queue = [], children = new Map();
  const record = (kind, event, details = {}) => {
    const row = {event_id: `v2.${String(events.length + 1).padStart(6, '0')}`, at: now, kind,
      action_id: event.id, team: event.team, actor: event.actor, label: program.label, details};
    events.push(row); return row;
  };
  const enqueue = (at, phase, event, context = null) => queue.push({at, sequence: ++sequence, phase, event, context});
  const finish = (event, success) => {
    for (const child of children.get(event.id) || []) {
      if (success) enqueue(now, 'start', child);
      else { record('dependency_blocked', child, {reason: '前置行动未完成'}); finish(child, false); }
    }
  };
  const credit = (event, team, target, payee = null) => {
    if (target in owners) {
      record('resource_unavailable', event, {target, owner: owners[target], reason: '同一resource_id+spawn_id只结算一次'}); return false;
    }
    const resource = resources[target], param = program.parameters[resource.reward_key], metric = param?.metric;
    if (resource.spawn_at === null) {
      const key='spawn:'+target;missing.add(key);
      record('pending',event,{missing:[key],reason:'刷新时点待标定，资源不得入账'});return false;
    }
    if (now < resource.spawn_at) {
      record('resource_unavailable',event,{target,spawn_at:resource.spawn_at,reason:'资源尚未刷新，资源不得入账'});return false;
    }
    if (!metric) {
      missing.add(resource.reward_key); record('pending', event, {missing: [resource.reward_key], reason: '收益待标定'}); return false;
    }
    const allocation = payee !== null ? {[payee]: metric.value} : allocate(comps[team], metric.value, program);
    if (allocation === null) {
      for (const p of comps[team].roster) if (parameter(program, p.allocation_key, 'weight') === null) missing.add(p.allocation_key);
      record('pending', event, {reason: '经济分配权重待标定'}); return false;
    }
    const entryId = `v2.${String(events.length + 1).padStart(6, '0')}`, amount = cents(metric.value), env = `environment:${resource.category}`;
    balances[team] += amount; balances[env] = (balances[env] || 0) - amount;
    entries.push({event_id: entryId, resource_id: target, at: now, category: resource.category, metric: clone(metric),
      postings: [{account: env, amount: -metric.value}, {account: team, amount: metric.value}]});
    owners[target] = team;
    record('settled', event, {target, winner: team, category: resource.category, gold: metric.value, allocation,
      metric: clone(metric), ledger_event_id: entryId});
    for (const [playerId, amount] of Object.entries(allocation)) {
      const state = players[team][playerId];
      state.gold = Math.round((state.gold + amount) * 100) / 100;
      const eq = equipment(program.builds[profiles[team][playerId].build_id], state.gold, program);
      if (state.formed_at === null && eq.formed) {
        state.formed_at = now; record('item_formed', event, {player_id: playerId, team, earned_gold: state.gold, equipment: eq});
      }
    }
    return true;
  };
  for (const event of program.events) {
    if (event.after !== null) {
      if (!children.has(event.after)) children.set(event.after, []);
      children.get(event.after).push(event);
    } else enqueue(event.at, 'start', event);
  }
  while (queue.length) {
    queue.sort((a,b) => a.at - b.at || a.sequence - b.sequence);
    if (queue[0].at > cfg.horizon_s) break;
    const {at, phase, event, context} = queue.shift(); now = at;
    const {team, actor} = event;
    if (phase === 'complete') {
      if (event.target in owners) { credit(event, team, event.target); finish(event, false); continue; }
      let winner = team;
      if (event.contest_key) {
        const probability = contestProbability(parameter(program, event.contest_key, 'ratio')), draw = pairedDraw(seed, event.target);
        winner = draw < probability ? 'blue' : 'red';
        record('resource_contest', event, {probability, draw, probability_source: 'p_contest：仅资源争夺先验', observed: event.observation});
      }
      const success = credit(event, winner, event.target, winner === team ? event.payee : null);
      record('action_finished', event, {finish_s: now, duration_s: context.duration, travel_s: context.travel,
        equipment: context.equipment, success});
      finish(event, success); continue;
    }
    if (event.kind === 'income') finish(event, credit(event, team, event.target, event.payee));
    else if (event.kind === 'explain') {
      record('decision', event, {report: event.report, reason: event.note}); finish(event, event.report.status === 'allow');
    } else if (event.kind === 'opportunity') {
      const r = resources[event.target], metric = program.parameters[r.reward_key]?.metric || null;
      const key = `${team}|${event.target}`;
      if (!opportunities.has(key)) opportunities.set(key, {team, resource_id: event.target, at: now, reason: event.note,
        value: metric?.value ?? null, status: metric === null ? '待标定' : '机会成本，未作实际扣款', metric});
      record('opportunity_cost', event, {target: event.target, value: parameter(program, r.reward_key, 'gold'), reason: event.note});
      finish(event, true);
    } else {
      const state = players[team][actor];
      if (event.target in owners) { credit(event, team, event.target); finish(event, false); continue; }
      if (state.busy_until > now) {
        record('action_rejected', event, {reason: '行动者仍在执行另一任务', busy_until: state.busy_until}); finish(event, false); continue;
      }
      const eq = equipment(program.builds[profiles[team][actor].build_id], state.gold, program);
      const base = parameter(program, event.duration_key, 's'), travel = event.travel.seconds;
      const factor = event.duration_effect === null ? 1 : eq[event.duration_effect + '_multiplier'];
      const needed = [], spawn = resources[event.target].spawn_at;
      if (spawn === null) needed.push('spawn:' + event.target);
      if (base === null) needed.push(event.duration_key);
      if (factor === null) needed.push(...eq.missing);
      if (travel === null) needed.push(...event.travel.missing);
      for (const [key, unit] of [[event.deadline_key, 's'], [event.contest_key, 'ratio']]) if (key && parameter(program, key, unit) === null) needed.push(key);
      if (needed.length) {
        needed.forEach(k => missing.add(k)); record('pending', event, {missing: [...new Set(needed)].sort(), reason: '行动缺参，分支暂停'});
        finish(event, false); continue;
      }
      finite(base, 'duration', 0);
      const duration = base * factor, finishAt = Math.max(now + travel, spawn) + duration;
      const deadline = event.deadline_key ? parameter(program, event.deadline_key, 's') : null;
      if (event.contest_key) contestProbability(parameter(program, event.contest_key, 'ratio'));
      if (deadline !== null && finishAt >= deadline) {
        record('action_rejected', event, {reason: '完成时间必须严格早于窗口关闭', finish_s: finishAt,
          deadline_s: deadline, observed: event.observation, equipment: eq}); finish(event, false); continue;
      }
      state.busy_until = finishAt;
      record('action_started', event, {reason: event.note, travel: event.travel, duration_s: duration,
        finish_s: finishAt, observed: event.observation, equipment: eq});
      enqueue(finishAt, 'complete', event, {duration, travel, equipment: eq});
    }
  }
  if (Object.values(balances).reduce((s,v) => s+v, 0) !== 0) fail('ledger not conserved');
  const teams = {}, counts = {};
  for (const [team, c] of Object.entries(comps)) {
    const roster = c.roster.map(p => ({...clone(p), earned_gold: players[team][p.player_id].gold,
      formed_at: players[team][p.player_id].formed_at, equipment: equipment(program.builds[p.build_id], players[team][p.player_id].gold, program)}));
    const caps = c.roster.map(p => parameter(program, p.ceiling_key, 'capacity'));
    const combo = comboReport(c, program), comboFactor = parameter(program, 'combo_factor', 'ratio'), unformed = parameter(program, 'unformed_factor', 'ratio');
    let upper = null, current = null;
    if (caps.every(v => v !== null) && comboFactor !== null && unformed !== null && combo.status !== 'unknown') {
      const multiplier = combo.status === 'allow' && c.combo_chain.length ? comboFactor : 1;
      upper = round6(caps.reduce((s,v) => s+v, 0) * multiplier);
      if (roster.every(r => r.equipment.status !== 'unknown')) current = round6(caps.reduce((s,v,i) => s+v*(roster[i].equipment.formed ? 1 : unformed), 0) * multiplier);
    }
    teams[team] = {C_count: c.roster.some(p => p.late_carry === null) ? null : c.roster.filter(p => p.late_carry).length,
      roster, combo_chain: combo, late_capacity: upper, current_capacity: current,
      capacity_unit: '合成capacity，非胜率/真实伤害', early_compensation: c.early_compensation, split_capability: c.split_capability};
    counts[team] = Object.fromEntries(['wave','jungle','objective','tower','kill'].map(cat => [cat,
      Object.entries(owners).filter(([r, owner]) => owner === team && resources[r].category === cat).length]));
  }
  const pending = new Set([...Object.entries(program.parameters).filter(([,p]) => p.status !== '实测').map(([k]) => k), ...missing]);
  const economy = (balances.blue - balances.red) / 100;
  const ledger = {server: cfg.server, patch: cfg.patch, unit: 'gold', balances: Object.fromEntries(Object.entries(balances).map(([k,v]) => [k,v/100])),
    net_diff: economy, entries, opportunity_costs: [...opportunities.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([,v]) => v)};
  return {protocol: program.protocol, label: program.label, server: cfg.server, patch: cfg.patch,
    model_version: cfg.model_version, data_version: cfg.data_version, experiment: program.experiment,
    seed, options: clone(program.options), time: cfg.horizon_s, economy_diff: economy, ledger, owners, counts,
    tower_diff: counts.blue.tower - counts.red.tower, teams, events, explanations: clone(program.explanations),
    pending_calibration: [...pending].sort(), unfinished_events: queue.length, limits: program.limits};
}

export function summarizeBatch(program, samples, first, seed) {
  const values = samples.map(s => s.economy_diff).sort((a,b) => a-b), n = values.length;
  const mean = values.reduce((s,v) => s+v, 0) / n;
  const distribution = {mean, std: Math.sqrt(values.reduce((s,v) => s+(v-mean)**2, 0) / n)};
  for (const q of [5,10,50,90,95]) distribution['p'+q] = values[Math.floor(q / 100 * (n - 1))];
  return {label: program.label, server: first.server, patch: first.patch, experiment: program.experiment,
    options: program.options, runs: n, seed, samples, first_run: first, distribution,
    pending_calibration: first.pending_calibration, note: '配对seed的模型内分布；参数敏感性另列方案'};
}

export function runBatch(program, runs=100, seed=7) {
  if (!Number.isInteger(runs) || runs < 1 || runs > 10000 || !Number.isInteger(seed) || seed < 0 || seed > 2147483647-runs+1) fail('runs/seed out of range');
  const samples = []; let first;
  for (let i=0; i<runs; i++) {
    const r = runProgram(program, seed+i); if (!first) first=r;
    samples.push({seed: seed+i, economy_diff: r.economy_diff, tower_diff: r.tower_diff});
  }
  return summarizeBatch(program, samples, first, seed);
}

export function assemble(bundle, options = {}) {
  const opts = {experiment: 'lane_plans', composition: '2C', style: 'conservative', camp_scale: 1,
    split_case: 'swap', build: 'carry', ...options};
  const choices = bundle.templates[opts.experiment];
  if (!choices || !bundle.compositions[opts.composition]) fail('unknown experiment/composition');
  let program;
  if (opts.experiment === 'lane_plans') {
    const plans = opts.plans || Object.fromEntries(ROLES.map(r => [r, r === 'mid' ? opts.style : 'conservative']));
    if (Object.keys(plans).sort().join(',') !== [...ROLES].sort().join(',') || Object.values(plans).some(s => !STYLES.includes(s))) fail('five valid LanePlans required');
    program = clone(choices.conservative); program.events = []; program.resources = {};
    for (const role of ROLES) {
      const template = choices[plans[role]];
      const events = template.events.filter(e => e.id.startsWith(role+'.') || e.id.startsWith('red.'+role+'.'));
      program.events.push(...clone(events));
      for (const e of events) if (e.target) program.resources[e.target] = clone(template.resources[e.target]);
    }
    program.options.plans = {...plans};
    program.lane_plans.forEach(p => { p.style = plans[p.player_id]; });
  } else {
    const key = {composition: opts.composition, split_push: opts.split_case,
      jungle_economy: Number(opts.camp_scale).toString(), item_timing: opts.build}[opts.experiment];
    if (!choices[key]) fail('unsupported experiment variant');
    program = clone(choices[key]);
  }
  program.options.composition = opts.composition;
  program.options.build = opts.build;
  program.compositions.blue = clone(bundle.compositions[opts.composition]);
  if (opts.build === 'slow') program.compositions.blue.roster.forEach(p => { if (p.late_carry) p.build_id = 'slow'; });
  sameScope(program.config, bundle);
  validateProgram(program);
  return program;
}

export function comparisonPrograms(bundle, options) {
  const id = options.experiment;
  const basePlans = options.plans || Object.fromEntries(ROLES.map(r => [r, 'conservative']));
  const compareLane = options.compare_lane || 'mid';
  if (!ROLES.includes(compareLane)) fail('unknown comparison lane');
  const variants = {
    lane_plans: STYLES.map(s => ({name:s, style:s, plans:{...basePlans, [compareLane]:s}})),
    composition: ['2C','4C'].map(c => ({name:c, composition:c})),
    split_push: ['swap','caught','empty'].map(c => ({name:c, split_case:c})),
    jungle_economy: [0.5,1,4].map(v => ({name:`收益×${v}`, camp_scale:v})),
    item_timing: ['carry','slow'].map(b => ({name:b, build:b})),
  }[id];
  return variants.map(({name,...variant}) => ({name, program:assemble(bundle, {...options,...variant})}));
}
