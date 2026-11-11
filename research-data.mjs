const requireValue = (condition, message) => {if (!condition) throw new Error(message);};
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export const CHANNELS = {yueai:'月爱 OCR', susu:'苏苏统计', danmaku:'弹幕摘录', adjustment:'调整主张'};

export function videoURL(bv, seconds) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(bv)) return null;
  if (seconds != null && (!Number.isInteger(seconds) || seconds < 0)) return null;
  return `https://www.bilibili.com/video/${bv}${seconds == null ? '' : `?t=${seconds}`}`;
}

export function validateTactics(data) {
  requireValue(data?.schema === 'research.tactics.web.v1' && Array.isArray(data.records) && data.records.length > 0, '战术资料格式不一致');
  requireValue(data.meta?.status === 'candidate' && data.meta.audiovisual_verified === false && data.meta.active_by_default === false, '战术候选边界缺失');
  const ids = new Set();
  for (const row of data.records) {
    requireValue(['id','topic','rule','trigger','counterexample','source_bv','source_file','source_scope','version_risk','hok_applicability'].every(key => nonempty(row[key])), '战术字段缺失');
    requireValue(!ids.has(row.id), '战术 ID 重复'); ids.add(row.id);
    requireValue(Number.isInteger(row.source_s) && row.source_s >= 0 && videoURL(row.source_bv, row.source_s) === row.source_url, '战术视频来源无效');
    requireValue(row.status === 'candidate' && row.audiovisual_verified === false && row.active_by_default === false && row.game_s === null && row.game_patch === null && Array.isArray(row.conflict_ids), '战术核验/时间/版本边界不一致');
  }
  return data;
}

export function validateHeroPrior(data) {
  requireValue(data?.schema === 'research.hero_prior.synthetic.v2' && Array.isArray(data.records) && data.records.length > 0, '英雄先验格式不一致');
  const meta = data.meta, params = meta?.formula?.parameters;
  requireValue(meta?.server === 'cn' && meta.patch === 'unknown' && meta.status === 'candidate' && meta.active_by_default === false && meta.production_model_ready === false && meta.numeric_model_ingestion_allowed === false && meta.formula.not_fitted === true, '英雄先验研究边界缺失');
  requireValue(params?.source_weights?.danmaku === 0 && params.source_weights.adjustment === 0 && params.status === 'synthetic_assumption_unvalidated', '英雄先验合成权重边界缺失');
  const names = new Set();
  for (const row of data.records) {
    requireValue(nonempty(row.hero) && !names.has(row.hero) && row.lane === 'unknown', '英雄身份/未知分路格式不一致'); names.add(row.hero);
    requireValue(row.status === 'candidate' && row.production_model_ready === false && row.numeric_model_ingestion_allowed === false && row.formula_version === 'synthetic-v2', '英雄候选状态不一致');
    requireValue(row.combined_prior_score === null || (Number.isFinite(row.combined_prior_score) && row.combined_prior_score >= 0 && row.combined_prior_score <= 100), '英雄先验分无效');
    requireValue(Number.isFinite(row.available_effective_weight) && row.score_components && Object.keys(CHANNELS).every(key => typeof row.signals?.[key]?.available === 'boolean'), '英雄信号缺失');
    requireValue(Array.isArray(row.sources) && row.sources.length > 0 && row.sources.every(ref => nonempty(ref.path) && nonempty(ref.pointer)), '英雄来源缺失');
    requireValue(Array.isArray(row.conflicts) && row.conflicts.every(conflict => conflict.resolution === 'unresolved' && Array.isArray(conflict.sides)), '英雄冲突边界不一致');
  }
  return data;
}

export function filterTactics(rows, {topic = '', query = ''} = {}) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => (!topic || row.topic === topic) && words.every(word =>
    [row.id, row.topic, row.rule, row.trigger, row.counterexample, row.source_bv, row.source_s, ...row.conflict_ids].join(' ').toLocaleLowerCase().includes(word)));
}

export function filterHeroes(rows, {query = '', filter = ''} = {}) {
  const term = query.trim().toLocaleLowerCase();
  return rows.filter(row => row.hero.toLocaleLowerCase().includes(term) &&
    (filter !== 'conflict' || row.conflicts.length > 0) &&
    (filter !== 'missing' || row.combined_prior_score === null));
}
