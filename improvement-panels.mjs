import {display, unknown, numeric, numberText, filterHeroTags, sortedTornado, validateHeroTags, validateCalibrationExample} from './improvement-data.mjs';

const PARAMETER_NAMES = {
  'style_mix.farm':'发育占比','style_mix.macro':'运营占比','style_mix.fight':'打架占比',
  'style_mix.roam_gank':'游走抓人占比','style_mix.group':'抱团占比','style_mix.split':'分带占比',
  adc_dawn_ready_multiplier:'破晓已成型倍率',adc_dawn_not_ready_multiplier:'破晓未成型倍率',
  storm_high_ground_scale:'风暴高地系数',storm_backdoor_scale:'风暴偷家系数',
  'p_contest.a':'资源争夺系数 a','p_contest.b':'资源争夺系数 b',volatility:'过程波动',
};
const abortError = () => Object.assign(new Error('读取已取消'), {name:'AbortError'});
async function readJSON(fetcher, path, signal, timeoutMs) {
  const controller = new AbortController(); let timer, cancel;
  const stopped = new Promise((_,reject) => {
    cancel = () => {controller.abort(); reject(abortError());};
    if (signal.aborted) cancel(); else signal.addEventListener('abort',cancel,{once:true});
    timer = setTimeout(()=>{controller.abort(); reject(Object.assign(new Error('请求超时'),{retryable:true}));},timeoutMs);
  });
  const read = async () => {
    let response;
    try {response = await fetcher(path,{signal:controller.signal,cache:'no-cache'});}
    catch {throw Object.assign(new Error('网络读取失败'),{retryable:true});}
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`),{retryable:[408,429].includes(response.status) || response.status >= 500});
    try {return await response.json();}
    catch (error) {if (error instanceof TypeError) throw Object.assign(new Error('数据传输中断'),{retryable:true}); throw error;}
  };
  try {return await Promise.race([stopped,read()]);}
  finally {clearTimeout(timer);signal.removeEventListener('abort',cancel);}
}

export function initImprovementPanels({document:doc=globalThis.document,fetch:fetcher=globalThis.fetch,timeoutMs=8000,retryDelayMs=400}={}) {
  if (!doc?.getElementById('heroTagsPanel') || !doc.getElementById('calibrationPanel')) return null;
  const $ = id=>doc.getElementById(id), listeners=[];
  const node=(tag,text='',className='')=>{const el=doc.createElement(tag);el.textContent=text;if(className)el.className=className;return el;};
  const on=(el,type,fn)=>{el.addEventListener(type,fn);listeners.push(()=>el.removeEventListener(type,fn));};
  const details=(label,child)=>{const el=node('details');el.append(node('summary',label),child);return el;};
  const state={
    heroTags:{path:'./data/hero-tags.json',validate:validateHeroTags,label:'英雄标签',controls:[$('heroTagsSearch'),$('heroTagsLane')]},
    calibration:{path:'./data/calibration-example.json',validate:validateCalibrationExample,label:'合成示例',controls:[]},
  };
  let destroyed=false,page=0;
  for(const s of Object.values(state)) Object.assign(s,{data:null,generation:0,controller:null});

  function heroCard(row) {
    const card=node('article','','hero-tag-card');card.dataset.hero=row.hero;
    const head=node('header');head.append(node('h3',row.hero),node('span','candidate · 待核','tag warning'));
    card.append(head,node('p',`分路：${display(row.lane)} · confidence：${display(row.confidence)}（非概率）`));
    const fields=node('dl');
    function field(label,values) {
      const dd=node('dd');
      if(Array.isArray(values) && values.length) {dd.className='tag-list';for(const v of values)dd.append(node('span',display(v),'hero-tag-chip'));}
      else dd.append(node('span',Array.isArray(values)?'unknown（缺少证据）':display(values),unknown(values)||Array.isArray(values)?'unknown':''));
      fields.append(node('dt',label),dd);
    }
    field('机制标签',row.mechanics_tags);field('强势期',row.power_spike);
    field('克制 / 受制',row.counter_tags);field('协同',row.synergy_tags);
    card.append(fields);
    if(!unknown(row.power_spike)) card.append(node('p',`强势期语境：${display(row.power_spike_scope)}；不代表全局峰值。`,'quant-note'));
    const dimensions=row.numeric_sensitivity || [];
    if(!dimensions.length)card.append(node('p','数值敏感：unknown（未提供可归属维度）','unknown'));
    else {
      const list=node('ul');
      for(const dimension of dimensions) {
        const li=node('li',display(dimension.parameter));
        li.append(node('small',`弹性：${display(dimension.elasticity)}；系数：${display(dimension.coefficient)}；当前适用性：${display(dimension.current_applicability)}`));list.append(li);
      }
      card.append(details(`数值敏感 · ${dimensions.length} 个候选维度（展开）`,list));
    }
    card.append(node('small',`补丁：${display(row.patch)} · 当前适用性：${display(row.current_applicability)}`));
    const evidence=node('div');
    evidence.append(node('p',`证据 ID：${row.evidence_refs?.join('、') || 'unknown'}`),node('p','原文定位见完整 JSON 的 evidence_catalog；同源不重复计票，版本与身份仍需核验。'));
    evidence.append(node('pre',JSON.stringify({identity_status:row.identity_status,tag_evidence:row.tag_evidence,lane_basis:row.lane_basis,gaps:row.gaps},null,2)));
    card.append(details('证据与适用边界',evidence));
    return card;
  }
  function renderHeroes() {
    const data=state.heroTags.data;
    $('heroTagsResults').replaceChildren();$('heroTagsCount').textContent='';$('heroTagsPager').hidden=true;
    if(!data)return;
    const rows=filterHeroTags(data.profiles,{query:$('heroTagsSearch').value,lane:$('heroTagsLane').value});
    const pages=Math.ceil(rows.length/6);page=Math.max(0,Math.min(page,pages-1));
    $('heroTagsCount').textContent=`匹配 ${rows.length} / ${data.profiles.length} 个原文名称条目 · ${data.profiles.filter(p=>unknown(p.power_spike)).length} 项强势期 unknown`;
    if(rows.length)$('heroTagsResults').append(...rows.slice(page*6,page*6+6).map(heroCard));
    else $('heroTagsResults').append(node('p','没有匹配项。请调整分路或搜索。','quant-note'));
    $('heroTagsPager').hidden=pages<=1;$('heroTagsPage').textContent=pages?`第 ${page+1} / ${pages} 页`:'';
    $('heroTagsPrev').disabled=page===0;$('heroTagsNext').disabled=page>=pages-1;
  }
  function reliabilityChart(bins) {
    const svg=(tag,attrs={},text='')=>{const el=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);el.textContent=text;return el;};
    const chart=svg('svg',{viewBox:'0 0 430 340',role:'img','aria-label':'合成 reliability 图：横轴平均预测，纵轴合成正例比例；虚线为相等参考线，点旁为箱人数',class:'reliability-chart'});
    chart.append(svg('title',{},'Reliability · 合成示例，不是真实精度'));
    const x=v=>58+v*340,y=v=>284-v*240;
    for(const tick of [0,.25,.5,.75,1]) {
      chart.append(svg('line',{x1:58,x2:398,y1:y(tick),y2:y(tick),stroke:'#2c3848'}),svg('text',{x:46,y:y(tick)+4,'text-anchor':'end'},String(tick)),svg('text',{x:x(tick),y:306,'text-anchor':'middle'},String(tick)));
    }
    chart.append(svg('line',{x1:x(0),x2:x(1),y1:y(0),y2:y(1),stroke:'#99a7ba','stroke-dasharray':'5 5'}),svg('text',{x:64,y:25},'合成正例比例'),svg('text',{x:225,y:329,'text-anchor':'middle'},'平均预测（合成）'));
    for(const bin of bins) if(bin.count>0&&numeric(bin.mean_probability)&&numeric(bin.outcome_rate)) {
      const point=svg('circle',{cx:x(bin.mean_probability),cy:y(bin.outcome_rate),r:5,fill:'#e9c17c','data-bin':bin.index});
      point.append(svg('title',{},`箱 ${bin.index+1}；n=${bin.count}；预测 ${numberText(bin.mean_probability)}；正例 ${numberText(bin.outcome_rate)}`));
      chart.append(point,svg('text',{x:x(bin.mean_probability)+7,y:y(bin.outcome_rate)-8},`n=${bin.count}`));
    }
    return chart;
  }
  function renderCalibration() {
    const result=$('calibrationResults');result.replaceChildren();result.hidden=true;
    const data=state.calibration.data;if(!data)return;
    const c=data.calibration,s=data.sensitivity;
    const metrics=node('div','','quant-metrics');
    for(const [key,label]of [['brier','Brier · 合成'],['ece','ECE · 合成'],['log_loss','Log loss · 合成']]) {
      const card=node('div',label,'quant-metric');const value=node('strong',numberText(c.metrics[key]));value.dataset.metric=key;card.append(value);metrics.append(card);
    }
    result.append(metrics,node('p',`合成标签：${display(c.coverage.evaluated)} / ${display(c.coverage.total)} 条可评估；缺预测 ${display(c.coverage.missing_probability)}，缺标签 ${display(c.coverage.missing_outcome)}。真实赛果样本：0。`,'quant-note'),node('p','Brier 为均方误差；ECE 为按人数加权的分箱偏差，依赖分箱和样本量；Log loss 使用自然对数。数值小不等于已验证的真实精度，空指标保留 unknown。','quant-note'));
    const reliability=node('section','','quant-section');reliability.append(node('h3','Reliability 分箱 · 合成标签'),node('p','横轴为箱内平均预测，纵轴为合成正例比例。虚线仅为相等参考线；空箱不绘点，保留 unknown。','quant-note'),reliabilityChart(c.reliability_bins));
    const wrap=node('div','','quant-table-wrap');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','合成分箱明细，可横向滚动');
    const table=node('table','','quant-table'),thead=node('thead'),header=node('tr'),body=node('tbody');
    table.append(node('caption','等宽分箱：左闭右开，末箱含 1；小数为阅读格式，原值见 JSON。'));
    for(const title of ['预测区间','合成人数','平均预测','合成正例比例','绝对偏差']) {const th=node('th',title);th.scope='col';header.append(th);}thead.append(header);
    for(const bin of c.reliability_bins) {
      const tr=node('tr');tr.dataset.bin=bin.index;
      for(const v of [`[${numberText(bin.lower)}, ${numberText(bin.upper)}${bin.upper_inclusive?']':')'}`,String(bin.count),numberText(bin.mean_probability),numberText(bin.outcome_rate),numberText(bin.absolute_gap)])tr.append(node('td',v));body.append(tr);
    }
    table.append(thead,body);wrap.append(table);reliability.append(wrap);result.append(reliability);
    const sensitivity=node('section','','quant-section');
    sensitivity.append(node('h3','敏感性龙卷风排序 · 合成扫描'),node('p',`${display(s.server).toUpperCase()} / ${s.mode==='competitive'?'比赛模式':display(s.mode)} / ${display(s.horizon_s)} 秒；${s.seeds.length} 个过程 seed。基准模型内概率均值 ${numberText(s.baseline.mean)}。`,'quant-note'),node('p','每次改变一项参数；演示范围为基准 ±20% 的设计假设。改一项蓝方打法占比时，其余占比按比例重分配，红方先验固定。排序按扫描输出最大均值 − 最小均值；不是 Sobol 指数、真实收益或因果效应。','quant-note'));
    const ordered=sortedTornado(s.tornado),deltas=ordered.flatMap(row=>Array.isArray(row.output_range)&&numeric(s.baseline.mean)?row.output_range.filter(numeric).map(v=>Math.abs(v-s.baseline.mean)):[]),extent=deltas.length?Math.max(...deltas):null;
    sensitivity.append(node('p',`共同横轴：相对基准的模型内概率差（0–1 尺度），−${numberText(extent)} 至 +${numberText(extent)}；中线为 0，蓝条为全部扫描点的均值范围，右列为排序幅度。`,'quant-note'));
    const list=node('ol','','tornado-list');
    ordered.forEach((row,i)=>{
      const li=node('li','','tornado-row');li.dataset.parameter=row.parameter;
      const label=node('div',`${numeric(row.tornado_impact)?i+1:'unknown'}. ${PARAMETER_NAMES[row.parameter] || row.parameter}`,'tornado-label');label.append(node('small',row.parameter));
      const track=node('div','','tornado-track');track.setAttribute('aria-hidden','true');
      if(numeric(s.baseline.mean)&&Array.isArray(row.output_range)&&row.output_range.every(numeric)) {
        const [lo,hi]=row.output_range.map(v=>v-s.baseline.mean),bar=node('span','','tornado-bar');
        bar.style.left=`${extent?50+lo/extent*50:50}%`;bar.style.width=`${extent?(hi-lo)/extent*50:0}%`;track.append(bar);
      }
      li.append(label,track,node('strong',numberText(row.tornado_impact),'tornado-value'));
      const detail=node('div'),range=values=>Array.isArray(values)?values.map(numberText).join(' — '):'unknown';
      detail.append(node('p',`参数范围：${range(row.range)}；扫描输出均值范围：${range(row.output_range)}。`),node('p',`参数低端差：${numberText(row.low_delta)}；高端差：${numberText(row.high_delta)}。端点不一定覆盖内部极值。`));
      li.append(details('范围与端点差（合成）',detail));list.append(li);
    });
    sensitivity.append(list,node('p','90% seed 分位带仅表示合成波动；95% bootstrap 均值区间仅估计模拟采样误差（详见 JSON）。未估计参数交互、测量误差与结构误差；同 seed 不保证分支后的事件随机流对齐。','quant-note'));
    result.append(sensitivity);result.hidden=false;
  }
  async function load(kind) {
    if(destroyed)return;
    const s=state[kind],generation=++s.generation;s.controller?.abort();s.controller=new AbortController();
    const signal=s.controller.signal,root=$(kind+'Panel');s.data=null;
    if(kind==='heroTags'){page=0;renderHeroes();}else renderCalibration();
    root.dataset.loading='true';root.setAttribute('aria-busy','true');s.controls.forEach(el=>el.disabled=true);
    $(kind+'Retry').disabled=true;$(kind+'Error').hidden=true;$(kind+'Status').textContent=`正在读取${s.label}…`;
    try {
      let data;
      for(let attempt=0;attempt<3;attempt++) {
        try{data=await readJSON(fetcher,s.path,signal,timeoutMs);break;}
        catch(error){
          if(signal.aborted||destroyed||!error.retryable||attempt===2)throw error;
          $(kind+'Status').textContent=`读取中断，重试 ${attempt+1}/2…`;
          await new Promise(resolve=>{const timer=setTimeout(done,retryDelayMs*(attempt+1));function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});});
          if(signal.aborted)throw abortError();
        }
      }
      s.validate(data);
      if(destroyed||generation!==s.generation)return;
      s.data=data;
      if(kind==='heroTags') {
        const previous=$('heroTagsLane').value,lanes=[...new Set(data.profiles.map(p=>unknown(p.lane)?'unknown':p.lane))];
        $('heroTagsLane').replaceChildren(...['',...lanes].map(lane=>{const option=node('option',lane==='unknown'?'unknown / 分路未知':lane||'全部分路');option.value=lane;return option;}));
        $('heroTagsLane').value=lanes.includes(previous)?previous:'';renderHeroes();
      }else renderCalibration();
      s.controls.forEach(el=>el.disabled=false);$(kind+'Status').textContent=`${s.label}已加载 · 2026-11-11 · ${kind==='heroTags'?'candidate / 待核':'synthetic / 不是真实精度'}`;
    }catch(error){
      if(destroyed||generation!==s.generation||signal.aborted)return;
      s.data=null;kind==='heroTags'?renderHeroes():renderCalibration();
      $(kind+'Status').textContent=`${s.label}不可用`;
      $(kind+'Error').textContent=`读取失败或资料边界不一致（${error.message}）。可重新加载；没有可展示的数据时保持 unknown。`;
      $(kind+'Error').hidden=false;
    }finally{if(!destroyed&&generation===s.generation){root.dataset.loading='false';root.setAttribute('aria-busy','false');$(kind+'Retry').disabled=false;}}
  }
  on($('heroTagsSearch'),'input',()=>{page=0;renderHeroes();});on($('heroTagsLane'),'change',()=>{page=0;renderHeroes();});
  on($('heroTagsPrev'),'click',()=>{page--;renderHeroes();});on($('heroTagsNext'),'click',()=>{page++;renderHeroes();});
  for(const kind of Object.keys(state))on($(kind+'Retry'),'click',()=>load(kind));
  return {ready:Promise.all(Object.keys(state).map(load)),reload:kind=>kind?load(kind):Promise.all(Object.keys(state).map(load)),destroy(){destroyed=true;for(const s of Object.values(state))s.controller?.abort();listeners.forEach(remove=>remove());}};
}
if(typeof document!=='undefined')initImprovementPanels();
