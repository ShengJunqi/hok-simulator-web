import {commentaryText} from './sim-core.mjs';

const patches = {lane_duel:'synthetic-micro-v1', support_roam:'synthetic-micro-v1', split_push:'synthetic-v2', jungle_route:'synthetic-micro-v1'};
const metricNames = {clear_at:'首波清完时点', priority_seconds:'蓝方先动窗口', can_move_first:'能否先动', hp_diff:'蓝 − 红血量', economy_diff:'实际经济差', action_finish:'行动完成时点', support_window_met:'支援窗口满足', farm_coverage:'射手同节点覆盖', information_gap:'未现身敌人数', tower_pressure:'塔压', tower_diff:'兑现塔差', push_finish:'计划推塔总耗时', route_finish:'刷野路线完成', gank_window_met:'后续支援窗口满足'};
const units = {s:'秒', hp:'HP', gold:'金币', count:'个', flag:'旗标', capacity:'合成容量'};
const teamNames = {blue:'蓝方', red:'红方'};
const fmt = value => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', {maximumFractionDigits:2}).format(value) : '待标定';
const node = (tag, text='', className='') => {const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;};
// Validate narrative claims with the shared guard, preserving Python's punctuation.
const safeText = value => commentaryText(value) ? value : '待标定';

export function validateMicroBundle(bundle, server) {
  const fail = () => {throw new Error('小模拟数据结构或服/补丁不一致，已拒绝。');};
  if(bundle?.protocol!=='hok-micro-web-v1'||bundle.server!==server||bundle.seed!==7||!Array.isArray(bundle.input_sources))fail();
  for(const [name, patch] of Object.entries(patches)) {
    const scenario=bundle.scenarios?.[name];
    if(!scenario||scenario.patch!==patch||!Array.isArray(scenario.axes)||!scenario.axes.length||!scenario.variants?.length)fail();
    let size=1;
    for(const axis of scenario.axes){if(!axis.values?.length||!Number.isInteger(axis.default)||axis.default<0||axis.default>=axis.values.length)fail();size*=axis.values.length;}
    if(Object.keys(scenario.cases||{}).length!==size)fail();
    for(const preset of scenario.presets||[])if(!scenario.cases[preset.indices?.join('-')])fail();
    for(const [id, c] of Object.entries(scenario.cases)) {
      const indices=id.split('-').map(Number);
      if(c.id!==id||indices.length!==scenario.axes.length)fail();
      for(const [i, axis] of scenario.axes.entries())if(!Number.isInteger(indices[i])||indices[i]<0||indices[i]>=axis.values.length||c.settings?.[axis.key]!==axis.values[indices[i]])fail();
      const scope = obj => {if(obj?.server!==server||obj?.patch!==patch)fail();};
      const scopeTree = obj => {
        if(obj === null || typeof obj !== 'object') return;
        if(Object.hasOwn(obj,'server') || Object.hasOwn(obj,'patch')) scope(obj);
        for(const child of Object.values(obj)) scopeTree(child);
      };
      // Includes ledger entries, parameter banks, event details and display evidence.
      scopeTree(c);
      for(const param of Object.values(c.parameters||{}))if(param.metric)scope(param.metric);
      for(const variant of scenario.variants) {
        const r=c.variants?.[variant.id];scope(r);
        if(r.scenario!==name||r.variant!==variant.id||!Array.isArray(r.metrics)||!Array.isArray(r.pending_calibration)||!Array.isArray(r.result?.events)||!Array.isArray(r.display?.resources)||r.display?.commentary?.length!==r.result.events.length)fail();
        scope(r.result.config||r.result);
        for(const envelope of r.metrics){scope(envelope);if(!Array.isArray(envelope.record?.values))fail();for(const value of envelope.record.values)scope(value);}
        for(const [i, event] of r.result.events.entries()) {
          if(event.server!==undefined)scope(event);
          if(event.event_id!==r.display.commentary[i]?.event_id)fail();
        }
        if(r.stage_signal)scope(r.stage_signal);
      }
      if(name==='support_roam') {
        scope(c.upstream?.signal);
        const prior=bundle.scenarios.lane_duel.cases[c.upstream.case_id]?.variants[c.upstream.variant];
        if(!prior||JSON.stringify(prior.stage_signal)!==JSON.stringify(c.upstream.signal))fail();
      }
    }
  }
  return bundle;
}

export function initMicro() {
  const $ = id => document.getElementById(id);
  const state={bundle:null, generation:0, abort:null, indices:[], variant:null};
  const currentScenario=()=>state.bundle?.scenarios[$('microScenario').value];
  const clear=()=>{
    for(const id of ['microParameters','microComparison','microMetrics','microResources','microEvents','microExplanation','microCalibration'])$(id).replaceChildren();
    for(const id of ['microMeta','microSummary','microSignal','microDescription','microEconomy','microPending'])$(id).textContent='';
    $('microResults').hidden=true;$('microScenario').disabled=true;$('microPreset').disabled=true;
    $('microScenario').replaceChildren();$('microPreset').replaceChildren();
  };
  const option=(value,label)=>{const o=node('option',label);o.value=value;return o;};
  const axisLabel=(axis,index)=>axis.labels?.[index]??(axis.values[index]===null?'待标定':`${axis.values[index]} ${axis.unit}`.trim());

  function selectScenario() {
    const s=currentScenario();if(!s)return;
    state.indices=s.axes.map(a=>a.default);state.variant=s.variants[0].id;
    $('microDescription').textContent=s.description;
    $('microPreset').replaceChildren(option('custom','自定义组合'),...s.presets.map(p=>option(p.id,p.label)));
    $('microPreset').value='baseline';$('microPreset').disabled=false;
    $('microParameters').replaceChildren();
    s.axes.forEach((axis,i)=>{
      const label=node('label','','micro-control');label.htmlFor=`micro-${axis.key}`;
      label.append(node('span',axis.label));
      const control=node(axis.control==='range'?'input':'select');control.id=`micro-${axis.key}`;
      if(axis.control==='range'){control.type='range';control.min=0;control.max=axis.values.length-1;control.step=1;}
      else axis.values.forEach((_,n)=>control.append(option(n,axisLabel(axis,n))));
      const output=node('output');output.id=`micro-value-${axis.key}`;output.htmlFor=control.id;
      control.addEventListener(axis.control==='range'?'input':'change',()=>{
        state.indices[i]=Number(control.value);$('microPreset').value='custom';render();
      });
      label.append(control,output,node('small',axis.help,'muted'));$('microParameters').append(label);
    });
    render();
  }

  function showEvent(result,index) {
    const event=result.result.events[index], explanation=result.display.commentary[index];
    const root=$('microExplanation');root.replaceChildren();
    root.append(node('h3','事件解释'),node('p',safeText(explanation.text),'explain-reason'));
    const target=explanation.target;
    root.append(node('p',`事件 ${event.event_id} · 资源实例 ${target??'待标定'}`,'source'));
    const details=node('details'),pre=node('pre',JSON.stringify({event,evidence:explanation.evidence},null,2));
    details.append(node('summary','事件原文与 commentary 字段依据'),pre);root.append(details);
    for(const button of $('microEvents').querySelectorAll('button')){
      const selected=Number(button.dataset.index)===index;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));
    }
  }

  function render() {
    const s=currentScenario();if(!s)return;
    const c=s.cases[state.indices.join('-')],r=c?.variants[state.variant];
    if(!r){$('microResults').hidden=true;$('microStatus').textContent='该组合未编译，结果待标定。';return;}
    s.axes.forEach((axis,i)=>{
      const control=$(`micro-${axis.key}`);control.value=state.indices[i];
      if(axis.control==='range')control.setAttribute('aria-valuetext',axisLabel(axis,state.indices[i]));
      $(`micro-value-${axis.key}`).textContent=axisLabel(axis,state.indices[i]);
    });
    $('microResults').hidden=false;
    $('microMeta').textContent=`${state.bundle.server.toUpperCase()} · ${s.patch} · ${s.stage} · seed ${state.bundle.seed} · 合成演示`;
    $('microStatus').textContent=`已载入 Python 预编译组合 ${c.id}；切换参数即时选择对应结果。`;
    $('microComparison').replaceChildren();
    for(const v of s.variants){
      const b=node('button','','comparison-card'+(state.variant===v.id?' active':''));b.type='button';b.dataset.variant=v.id;
      b.setAttribute('aria-pressed',String(state.variant===v.id));
      b.append(node('span',v.label),node('strong',fmt(c.variants[v.id].display.economy_diff)),node('small','实际经济差 / gold'));
      b.onclick=()=>{state.variant=v.id;render();};$('microComparison').append(b);
    }
    $('microEconomy').textContent=`实际入账经济差（蓝 − 红）：${fmt(r.display.economy_diff)} 金币。未兑现分支不推算潜在收益。`;
    $('microSummary').textContent=safeText(r.display.summary);
    $('microSignal').textContent=c.upstream?`S1 → S2：${c.upstream.variant} 清线完成 ${fmt(c.upstream.signal.available_at)} 秒。${c.upstream.signal.available_at===null?'出发信号待标定，S2 不默认立即出发。':'S2 以此时点开始；两阶段经济分别记账。'}`:'';
    $('microMetrics').replaceChildren();
    for(const envelope of r.metrics){
      const record=envelope.record,key=record.metric_id.split('.').at(-1),value=record.values[0];
      const card=node('div','','micro-metric');card.dataset.metric=key;
      card.append(node('span',metricNames[key]||key,'muted'),node('strong',value?`${fmt(value.value)} ${units[value.unit]||value.unit}`:'待标定'),node('small',record.metric_definition,'muted'));
      $('microMetrics').append(card);
    }
    $('microResources').replaceChildren();
    if(!r.display.resources.length)$('microResources').append(node('li','本次无资源结算事件；资源收益/归属未由行动自动推定。','muted'));
    for(const row of r.display.resources)$('microResources').append(node('li',`${fmt(row.at)} 秒 · ${row.resource_id??'待标定'} → ${teamNames[row.winner]||'待标定'} · ${fmt(row.gold)} 金币`));
    $('microEvents').replaceChildren();$('microExplanation').replaceChildren();
    r.display.commentary.forEach((explanation,i)=>{
      const b=node('button',safeText(explanation.facts?.join('')),'micro-event');b.type='button';b.dataset.index=i;
      b.onclick=()=>showEvent(r,i);$('microEvents').append(b);
    });
    if(r.result.events.length)showEvent(r,0);
    else $('microExplanation').append(node('p','没有可解释的事件；前置输入或行动依据待标定。','muted'));
    $('microPending').textContent=`${r.pending_calibration.length} 项待标定（包含合成参数）；null 保留未知。`;
    $('microCalibration').replaceChildren();
    for(const [key,p] of Object.entries(c.parameters)){
      const row=node('div','','parameter-row');row.dataset.parameter=key;
      row.append(node('code',key),node('span',`${fmt(p.metric?.value)} ${p.unit}`),node('span',`${p.status} · ${r.server}/${r.patch}`));
      row.title=p.metric?`${p.metric.source}；${p.metric.notes}`:'缺少同服同补丁测量';$('microCalibration').append(row);
    }
    const sources=node('details'),pre=node('pre',JSON.stringify(state.bundle.input_sources,null,2));
    sources.append(node('summary','生成脚本输入文件与 SHA256'),pre);$('microCalibration').append(sources);
  }

  async function load() {
    const generation=++state.generation,server=$('server').value;
    state.abort?.abort();state.abort=new AbortController();const signal=state.abort.signal;
    state.bundle=null;clear();$('microError').hidden=true;$('microStatus').textContent='正在读取小模拟参数组合…';
    try {
      let bundle;
      for(let attempt=0;attempt<3;attempt++){
        let response;
        try{response=await fetch(`./data/micro-${server}.json`,{cache:'no-cache',signal});}
        catch(error){if(signal.aborted||attempt===2)throw error;}
        if(response?.ok){bundle=await response.json();break;}
        if(response&&(response.status<500||attempt===2))throw new Error(`小模拟数据读取失败：HTTP ${response.status}`);
        if(generation!==state.generation)return;
        $('microStatus').textContent=`小模拟读取中断，正在重试 ${attempt+1}/2…`;
        await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));
        if(generation!==state.generation)return;
      }
      if(generation!==state.generation)return;
      state.bundle=validateMicroBundle(bundle,server);
      $('microScenario').append(...Object.entries(bundle.scenarios).map(([id,s])=>option(id,`${s.stage} · ${s.label}`)));
      $('microScenario').disabled=false;selectScenario();
    }catch(error){
      if(generation!==state.generation)return;
      state.bundle=null;clear();$('microError').textContent=`${error.message} 请运行 scripts/build_simulator_micro_web.py 后用本地静态服务打开。`;
      $('microError').hidden=false;$('microStatus').textContent='小模拟未加载，已清空旧结果。';
    }
  }
  $('microScenario').addEventListener('change',selectScenario);
  $('microPreset').addEventListener('change',()=>{
    const preset=currentScenario()?.presets.find(p=>p.id===$('microPreset').value);
    if(preset){state.indices=[...preset.indices];render();}
  });
  $('microRetry').onclick=load;$('server').addEventListener('change',load);load();
}
