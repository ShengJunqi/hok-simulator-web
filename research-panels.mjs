import {CHANNELS, filterHeroes, filterTactics, validateHeroPrior, validateTactics, videoURL} from './research-data.mjs';

const abortError = () => Object.assign(new Error('已取消读取'), {name:'AbortError'});
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = () => {signal.removeEventListener('abort', cancel); resolve();};
    const timer = setTimeout(finish, ms);
    const cancel = () => {clearTimeout(timer); reject(abortError());};
    if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, {once:true});
  });
}

async function requestJSON(fetcher, path, signal, timeoutMs) {
  const request = new AbortController();
  let timer, cancel;
  const stopped = new Promise((_, reject) => {
    cancel = () => {request.abort(); reject(abortError());};
    if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, {once:true});
    timer = setTimeout(() => {
      request.abort(); reject(Object.assign(new Error('请求超时'), {retryable:true}));
    }, timeoutMs);
  });
  const read = async () => {
    let response;
    try {response = await fetcher(path, {signal:request.signal, cache:'no-cache'});}
    catch (error) {throw Object.assign(new Error('网络读取失败', {cause:error}), {retryable:true});}
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), {
      retryable:response.status === 408 || response.status === 429 || response.status >= 500,
    });
    try {return await response.json();}
    catch (error) {
      // A body download can disconnect after headers arrive; malformed JSON is not retried.
      if (error instanceof TypeError) throw Object.assign(new Error('资料传输中断', {cause:error}), {retryable:true});
      throw error;
    }
  };
  try {return await Promise.race([stopped, read()]);}
  finally {clearTimeout(timer); signal.removeEventListener('abort', cancel);}
}

export function initResearchPanels({document:doc = globalThis.document, fetch:fetcher = globalThis.fetch,
  retryDelayMs = 400, timeoutMs = 8000} = {}) {
  if (!doc?.getElementById('tacticsPanel') || !doc.getElementById('heroPriorPanel')) return null;
  const $ = id => doc.getElementById(id);
  const listeners = [];
  const on = (element, event, handler) => {element.addEventListener(event, handler); listeners.push(() => element.removeEventListener(event, handler));};
  const node = (tag, text = '', className = '') => {const el = doc.createElement(tag); el.textContent = text; if (className) el.className = className; return el;};
  const detail = (title, child) => {const el = node('details'); el.append(node('summary', title), child); return el;};
  const link = (label, url) => {
    const el = node('a', label); el.href = url;
    if (url.startsWith('https:')) {el.target = '_blank'; el.rel = 'noopener noreferrer';}
    return el;
  };
  const fields = {
    tactics:{root:$('tacticsPanel'), path:'./data/tactics.json', validate:validateTactics, pageSize:12,
      controls:[$('tacticsTopic'), $('tacticsSearch')], container:$('tacticsCards'), label:'战术卡'},
    heroPrior:{root:$('heroPriorPanel'), path:'./data/hero-prior-v2.json', validate:validateHeroPrior, pageSize:20,
      controls:[$('heroPriorFilter'), $('heroPriorSearch')], container:$('heroPriorResults'), label:'英雄先验'},
  };
  let destroyed = false;
  for (const state of Object.values(fields)) Object.assign(state, {data:null, page:0, generation:0, controller:null});

  function card(row) {
    const article = node('article', '', 'tactic-card'); article.dataset.ruleId = row.id;
    const heading = node('header'); heading.append(node('strong', `${row.id} · ${row.topic}`), node('span', 'candidate / 未验证', 'tag warning'));
    const source = node('p'); source.append(link(`${row.source_bv} · 视频 ${row.source_s} 秒 ↗`, videoURL(row.source_bv, row.source_s)));
    article.append(heading, node('h3', row.rule), node('p', `触发条件：${row.trigger}`), node('p', `反例 / 失效边界：${row.counterexample}`), source,
      node('p', `无音频核验 · 未做原音画核验 · 文本支持：${row.confidence}（非效果概率）`, 'research-card-scope'),
      node('p', `冲突关联：${row.conflict_ids.join('、') || '本批未列（不表示无冲突）'}`, 'research-card-scope'),
      detail('版本、跨服与原始来源', node('p', `补丁：未知；局内时间：未知。版本风险：${row.version_risk}；HOK：${row.hok_applicability}；材料范围：${row.source_scope}；源文件：${row.source_file}`, 'research-card-scope')));
    return article;
  }

  function heroTable(rows) {
    const wrap = node('div', '', 'prior-table-wrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', '英雄先验表，可横向滚动');
    const table = node('table', '', 'prior-table'), head = node('thead'), header = node('tr'), body = node('tbody');
    table.append(node('caption', '保留源文件顺序；先验分显示两位小数用于阅读，原值见 JSON。'));
    for (const title of ['英雄 / hero', '分路', '先验分 · 合成', '信号来源', '冲突标记']) {const th = node('th', title); th.scope = 'col'; header.append(th);}
    head.append(header);
    for (const row of rows) {
      const tr = node('tr'); tr.dataset.hero = row.hero;
      const name = node('th', row.hero); name.scope = 'row';
      const lane = node('td', '未知'); lane.append(node('small', 'unknown'));
      const score = node('td'), value = node('strong', row.combined_prior_score === null ? '缺失（null）' : row.combined_prior_score.toFixed(2), 'prior-score');
      value.title = row.combined_prior_score === null ? '两个数值通道均缺失，不填 0 或 50' : `原始合成索引：${row.combined_prior_score}`;
      score.append(value, node('small', 'candidate · 合成 / 未校准'), node('small', `可用有效权重：${row.available_effective_weight}`));
      const components = node('div');
      for (const key of ['yueai','susu']) {
        const part = row.score_components[key];
        components.append(node('p', `${CHANNELS[key]}：${part?.available ? `分量 ${part.value}；有效权重 ${part.effective_weight}` : '数值分量缺失，不贡献'}。`));
      }
      score.append(detail('分量与权重', components));
      const signals = node('td'), list = node('ul', '', 'prior-signals');
      for (const [key, label] of Object.entries(CHANNELS)) {
        const signal = row.signals[key];
        const use = key === 'danmaku' || key === 'adjustment' ? '定性，权重 0' : row.score_components[key]?.available ? '有合成分量' : '数值分量缺失';
        list.append(node('li', `${label}：${signal.available ? '有来源' : '未提供可归属信号'} · ${use}`));
      }
      const refs = node('ol', '', 'prior-sources');
      for (const ref of row.sources) {
        const item = node('li', `${ref.path} · ${ref.pointer}`);
        item.append(node('code', `SHA-256 ${ref.sha256}`));
        const url = videoURL(ref.source_bv);
        if (url) item.append(link(`${ref.source_bv} ↗`, url), node('small', '本引用未给视频秒码'));
        refs.append(item);
      }
      signals.append(list, detail(`来源定位（${row.sources.length}）`, refs));
      const conflicts = node('td');
      if (!row.conflicts.length) conflicts.append(node('small', '本批未列冲突（不表示已验证一致）'));
      else {
        conflicts.className = 'prior-conflict';
        conflicts.append(node('strong', `${row.conflicts.length} 项待复核 · unresolved`));
        for (const conflict of row.conflicts) {
          const content = node('div'); content.append(node('p', conflict.explanation), detail('双方来源原文', node('pre', JSON.stringify(conflict.sides, null, 2))));
          conflicts.append(detail(`${conflict.id} · 未决`, content));
        }
      }
      tr.append(name, lane, score, signals, conflicts); body.append(tr);
    }
    table.append(head, body); wrap.append(table); return wrap;
  }

  function render(kind) {
    const state = fields[kind];
    state.container.replaceChildren();
    if (!state.data) {$(kind + 'Count').textContent = ''; $(kind + 'Pager').hidden = true; return;}
    const rows = kind === 'tactics' ? filterTactics(state.data.records, {topic:$('tacticsTopic').value, query:$('tacticsSearch').value})
      : filterHeroes(state.data.records, {filter:$('heroPriorFilter').value, query:$('heroPriorSearch').value});
    const pages = Math.ceil(rows.length / state.pageSize);
    state.page = Math.min(state.page, Math.max(0, pages - 1));
    $(kind + 'Count').textContent = `匹配 ${rows.length} / ${state.data.records.length} ${kind === 'tactics' ? '条候选' : '个原始名称'}${kind === 'heroPrior' ? ` · 总计 ${state.data.records.filter(row => row.combined_prior_score === null).length} 个先验分缺失` : ''}`;
    if (!rows.length) state.container.append(node('p', '没有匹配项。请调整筛选或搜索。', 'muted small'));
    else {
      const page = rows.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);
      if (kind === 'tactics') state.container.append(...page.map(card));
      else state.container.append(heroTable(page));
    }
    $(kind + 'Pager').hidden = pages <= 1;
    $(kind + 'Page').textContent = pages ? `第 ${state.page + 1} / ${pages} 页` : '';
    $(kind + 'Prev').disabled = state.page === 0;
    $(kind + 'Next').disabled = state.page >= pages - 1;
  }

  async function load(kind) {
    if (destroyed) return;
    const state = fields[kind], generation = ++state.generation;
    state.controller?.abort(); state.controller = new AbortController();
    const signal = state.controller.signal;
    state.data = null; state.page = 0; render(kind);
    state.root.dataset.loading = 'true'; state.root.setAttribute('aria-busy', 'true');
    state.controls.forEach(control => {control.disabled = true;});
    $(kind + 'Retry').disabled = true; $(kind + 'Error').hidden = true;
    $(kind + 'Status').textContent = `正在读取本地${state.label}…`;
    try {
      let data;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {data = await requestJSON(fetcher, state.path, signal, timeoutMs); break;}
        catch (error) {
          if (signal.aborted || destroyed || error.name === 'AbortError' || !error.retryable || attempt === 2) throw error;
          $(kind + 'Status').textContent = `网络中断或服务暂不可用，正在重试（${attempt + 1}/2）…`;
          await pause(retryDelayMs * (attempt + 1), signal);
        }
      }
      state.validate(data);
      if (generation !== state.generation || destroyed) return;
      state.data = data;
      if (kind === 'tactics') {
        const selected = $('tacticsTopic').value, topics = [...new Set(data.records.map(row => row.topic))];
        $('tacticsTopic').replaceChildren(...['', ...topics].map(topic => {const option = node('option', topic || '全部主题'); option.value = topic; return option;}));
        $('tacticsTopic').value = topics.includes(selected) ? selected : '';
      } else {
        const p = data.meta.formula.parameters;
        $('heroPriorFormula').textContent = `合成公式：${p.base} + ${p.scale} ×（${p.source_weights.yueai} × ${p.quality_discounts.yueai} × Y + ${p.source_weights.susu} × ${p.quality_discounts.susu} × S）。Y 为可读梯度候选映射，S 为苏苏总胜率中心分位；权重与折扣均未经拟合。弹幕 / 调整权重均 0；缺项不重分权，两项都缺则 null。50 为设计锚点，不是胜率。`;
      }
      state.controls.forEach(control => {control.disabled = false;});
      render(kind);
      $(kind + 'Status').textContent = `${state.label}已加载 · 2026-11-10 快照 · 仅供研究查阅`;
    } catch (error) {
      if (generation !== state.generation || destroyed || signal.aborted) return;
      state.data = null; render(kind);
      $(kind + 'Status').textContent = `${state.label}读取失败`;
      $(kind + 'Error').textContent = `读取失败或资料边界不一致（${error.message}）。请确认本地 HTTP 服务与网络后重新加载。`;
      $(kind + 'Error').hidden = false;
    } finally {
      if (generation === state.generation && !destroyed) {
        state.root.dataset.loading = 'false'; state.root.setAttribute('aria-busy', 'false');
        $(kind + 'Retry').disabled = false;
      }
    }
  }

  for (const [kind, state] of Object.entries(fields)) {
    for (const control of state.controls) on(control, control.tagName === 'INPUT' ? 'input' : 'change', () => {state.page = 0; render(kind);});
    on($(kind + 'Retry'), 'click', () => load(kind));
    for (const [suffix, step] of [['Prev', -1], ['Next', 1]]) on($(kind + suffix), 'click', () => {state.page += step; render(kind);});
  }
  const ready = Promise.all(Object.keys(fields).map(load));
  return {ready, reload:kind => kind ? load(kind) : Promise.all(Object.keys(fields).map(load)),
    destroy() {destroyed = true; Object.values(fields).forEach(state => state.controller?.abort()); listeners.forEach(remove => remove());}};
}

if (typeof document !== 'undefined') initResearchPanels();
