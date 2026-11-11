// Read-only research contracts. Never supply defaults for unknown measurements.
export const unknown = value => value == null || value === '' || value === 'unknown' || value === '未知';
export const display = value => unknown(value) ? 'unknown（缺少证据）' : String(value);
export const numeric = value => typeof value === 'number' && Number.isFinite(value);
export const numberText = value => numeric(value) ? value.toFixed(4) : 'unknown';
const require = (condition, message) => {if (!condition) throw new Error(message);};
const optionalNumber = (value, min = -Infinity, max = Infinity) => unknown(value) || numeric(value) && value >= min && value <= max;
function candidate(row) {
  require(row?.status === 'candidate' && row.active_by_default === false && row.production_model_ready === false && row.numeric_model_ingestion_allowed === false, '英雄标签 candidate / 默认关闭边界不一致');
  require(row.server === 'cn', '英雄标签仅限 CN 研究语料');
}
export function validateHeroTags(data) {
  require(data?.schema === 'research.hero_tags.candidate.v1' && Array.isArray(data.profiles), '英雄标签格式不一致');
  candidate(data.meta);
  const names = new Set();
  for (const row of data.profiles) {
    candidate(row);
    require(typeof row.hero === 'string' && row.hero.trim() && !names.has(row.hero), '英雄原称缺失或重复'); names.add(row.hero);
    for (const key of ['lane','power_spike','power_spike_scope','confidence']) require(row[key] == null || typeof row[key] === 'string', `${key} 格式不一致`);
    for (const key of ['mechanics_tags','counter_tags','synergy_tags','evidence_refs']) require(row[key] == null || Array.isArray(row[key]) && row[key].every(v=>typeof v === 'string'), `${key} 格式不一致`);
    require(row.numeric_sensitivity == null || Array.isArray(row.numeric_sensitivity) && row.numeric_sensitivity.every(v=>v && typeof v === 'object' && !Array.isArray(v)), 'numeric_sensitivity 格式不一致');
  }
  return data;
}
export function filterHeroTags(rows, {query = '', lane = ''} = {}) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => (!lane || (lane === 'unknown' ? unknown(row.lane) : row.lane === lane)) &&
    words.every(word => [row.hero,row.lane,...(row.mechanics_tags || []),...(row.counter_tags || []),...(row.synergy_tags || [])].join(' ').toLocaleLowerCase().includes(word)));
}
function synthetic(row) {
  require(row?.synthetic === true && row.calibrated === false && row.active_by_default === false && row.real_accuracy_claim === null, 'synthetic / 未校准 / 无真实精度声明边界不一致');
}
export function validateCalibrationExample(data) {
  require(data?.schema_version === 'synthetic-quantitative-tools-v1' && data.status === 'candidate', '校准示例格式不一致');
  synthetic(data); synthetic(data.calibration); synthetic(data.sensitivity); synthetic(data.backtest);
  require(data.dataset?.synthetic === true && data.calibration.empirical_sample_size === 0, '示例不能包含真实赛果或真实样本声明');
  const c = data.calibration, s = data.sensitivity;
  require(c.status === 'candidate' && c.coverage && c.metrics && Array.isArray(c.reliability_bins), '校准字段缺失');
  for (const key of ['brier','ece']) require(optionalNumber(c.metrics[key],0,1), `${key} 必须为 [0,1] 或 unknown`);
  require(optionalNumber(c.metrics.log_loss,0), 'log loss 无效');
  for (const key of ['total','evaluated','excluded','missing_probability','missing_outcome']) require(unknown(c.coverage[key]) || Number.isInteger(c.coverage[key]) && c.coverage[key] >= 0, '覆盖计数无效');
  require(optionalNumber(c.coverage.fraction,0,1), '覆盖率无效');
  for (const bin of c.reliability_bins) {
    require(numeric(bin.lower) && numeric(bin.upper) && bin.lower >= 0 && bin.lower < bin.upper && bin.upper <= 1 && Number.isInteger(bin.count) && bin.count >= 0, 'reliability 分箱无效');
    for (const key of ['mean_probability','outcome_rate','absolute_gap']) require(optionalNumber(bin[key],0,1), 'reliability 数值无效');
    if (bin.count === 0) require(unknown(bin.mean_probability) && unknown(bin.outcome_rate), '空箱必须保留 unknown');
  }
  require(Array.isArray(s.tornado) && s.baseline && optionalNumber(s.baseline.mean,0,1) && Array.isArray(s.seeds), '敏感性字段缺失');
  const parameters = new Set();
  for (const row of s.tornado) {
    require(typeof row.parameter === 'string' && row.parameter && !parameters.has(row.parameter), '扫描参数缺失或重复'); parameters.add(row.parameter);
    require(optionalNumber(row.tornado_impact,0,1), '扫描幅度无效');
    for (const key of ['low_delta','high_delta']) require(optionalNumber(row[key],-1,1), '端点差无效');
    for (const key of ['range','output_range']) require(unknown(row[key]) || Array.isArray(row[key]) && row[key].length === 2 && row[key].every(v=>optionalNumber(v)) && (!row[key].every(numeric) || row[key][0] <= row[key][1]), '扫描范围无效');
  }
  return data;
}
export function sortedTornado(rows) {
  return [...rows].sort((a,b) => (numeric(b.tornado_impact) ? b.tornado_impact : -1) - (numeric(a.tornado_impact) ? a.tornado_impact : -1));
}
