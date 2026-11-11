import {ROLES, STYLES, assemble, comparisonPrograms, commentaryText, explainEvent, summarizeRun} from './sim-core.mjs';
import {initMicro} from './micro.mjs';
import {initMinimap, renderMinimap, clearMinimap} from './minimap.mjs';

const $ = id => document.getElementById(id);
const roleNames = {clash:'对抗路', mid:'中路', farm:'发育路', jungle:'打野', roam:'游走'};
const styleNames = {conservative:'抗压 / 稳发育', aggressive:'抢线 / 压制', roam:'清线支援', yield:'让线 / 换节奏', split:'41 带线'};
const experimentNames = {lane_plans:'分路打法对比', composition:'2C / 4C 阵容', split_push:'41 分带窗口', jungle_economy:'野怪经济敏感性', item_timing:'装备成型时点'};
const descriptions = {
  lane_plans:'保持阵容与 seed 不变，观察各分路行动如何改变资源与塔收益。',
  composition:'给定相同团队收入，比较经济分配、装备成型与合成团战容量。',
  split_push:'比较带线推塔、敌方回防与撤离窗口。四人组和带线者分别记账。',
  jungle_economy:'改变河灵、红隼、小野收益，观察刷野与放野换龙的取舍。',
  item_timing:'装备成型影响清线和打目标耗时，进而影响窗口与归属。',
};
const categoryNames = {wave:'兵线', jungle:'野怪', objective:'目标', tower:'防御塔', kill:'击杀'};
const nodeNames = {river:'河灵', bird:'红隼', small:'小野', dragon:'龙目标', tower:'边路塔', mid:'中路', side:'边路', farm:'发育路'};
const caseNames = {swap:'换塔窗口', caught:'被抓窗口', empty:'无功撤退', carry:'较早成型', slow:'较晚成型', current:'当前方案'};
const format = value => value === null || value === undefined ? '待标定' : new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(value);
const clock = value => `${String(Math.floor(value/60)).padStart(2,'0')}:${String(Math.floor(value%60)).padStart(2,'0')}`;
const nameOf = name => styleNames[name] || caseNames[name] || name;
const elem = (tag, text='', className='') => { const e=document.createElement(tag); if(text) e.textContent=text; if(className)e.className=className; return e; };
const svg = (tag, attrs={}, text='') => { const e=document.createElementNS('http://www.w3.org/2000/svg',tag); for(const [key,v] of Object.entries(attrs))e.setAttribute(key,v); if(text)e.textContent=text; return e; };
const state = {bundle:null,worker:null,job:0,loading:0,variants:[],programs:[],active:0,selected:null,time:240,busy:false};

for (const role of ROLES) {
  const row=elem('div','','lane-row'), glyph=elem('div',roleNames[role].slice(0,1),'lane-glyph'); glyph.id=`glyph-${role}`;
  const info=elem('div','','lane-info'), label=elem('label',roleNames[role]); label.htmlFor=`plan-${role}`;
  const hero=elem('span','合成角色','hero-kind'); hero.id=`hero-${role}`; label.append(hero);
  const select=elem('select'); select.id=`plan-${role}`; select.setAttribute('aria-label',`${roleNames[role]}打法`);
  for(const style of STYLES){const option=elem('option',styleNames[style]);option.value=style;select.append(option);}
  info.append(label,select);row.append(glyph,info);$('laneRows').append(row);
}

function options() {
  return {experiment:$('experiment').value, composition:document.querySelector('input[name=composition]:checked').value,
    plans:Object.fromEntries(ROLES.map(r=>[r,$(`plan-${r}`).value])), compare_lane:$('compareLane').value,
    camp_scale:Number($('campScale').value), split_case:$('splitCase').value,
    build:$('experiment').value==='item_timing'?$('build').value:'carry'};
}

function setBusy(busy) {
  state.busy=busy;
  for(const control of $('configForm').querySelectorAll('input,select'))control.disabled=busy;
  $('runButton').disabled=busy||!state.bundle;
  $('compareButton').disabled=busy||!state.bundle;
  $('cancelButton').disabled=!busy;
  if(!busy)updateForm();
}

function updateForm() {
  const opts=options(), isLane=opts.experiment==='lane_plans';
  $('scenarioDescription').textContent=descriptions[opts.experiment];
  $('laneOptions').hidden=!isLane;
  $('splitOptions').hidden=opts.experiment!=='split_push';
  $('jungleOptions').hidden=opts.experiment!=='jungle_economy';
  $('itemOptions').hidden=opts.experiment!=='item_timing';
  for(const role of ROLES)$(`plan-${role}`).disabled=state.busy||!isLane;
  if(state.bundle){
    const c=state.bundle.compositions[opts.composition];
    for(const profile of c.roster){
      const r=profile.player_id;$(`hero-${r}`).textContent=profile.late_carry?'合成 carry':'合成功能位';
      $(`glyph-${r}`).classList.toggle('carry',profile.late_carry);
      $(`glyph-${r}`).title=profile.hero_id;
    }
    $('coreCount').textContent=`${c.roster.filter(p=>p.late_carry).length} 个后期核`;
  }
  if(state.variants.length&&!state.busy)$('status').textContent='配置可调整；下方保留上次运行结果。';
}

async function loadBundle() {
  const generation=++state.loading, server=$('server').value;
  if(state.worker){state.worker.terminate();state.worker=null;state.job++;}
  state.bundle=null; state.variants=[];state.programs=[];state.selected=null;
  $('error').hidden=true;$('status').textContent='正在读取独立参数库…';$('runButton').disabled=true;$('compareButton').disabled=true;
  $('exportJson').disabled=true;$('exportCsv').disabled=true;$('scopeLabel').textContent=`${server.toUpperCase()} · 合成 v2`;
  clearResults();
  try {
    const response=await fetch(`./data/${server}-synthetic-v2.json`,{cache:'no-cache'});
    if(!response.ok)throw new Error(`参数库读取失败：HTTP ${response.status}`);
    const bundle=await response.json();if(generation!==state.loading)return;
    if(bundle.server!==server||bundle.patch!==$('patch').value)throw new Error('参数库服/补丁不一致，已拒绝。');
    state.bundle=bundle;const program=assemble(bundle,options());
    renderMap(program,null);renderCalibration(program);setBusy(false);updateForm();
    $('status').textContent='参数库就绪，可运行合成实验。';
  }catch(error){if(generation===state.loading)showError(error.message+' 请用本地静态服务打开页面。');}
}

function clearResults(){
  clearMinimap();
  state.time=240;state.active=0;
  $('map').replaceChildren();$('calibrationList').replaceChildren();
  $('calibrationCount').textContent='未加载';$('comparisonRows').replaceChildren();
  $('mapTime').textContent='04:00 快照';$('timeSlider').value=240;$('scrubTime').textContent='04:00';
  $('distributionNote').textContent='随机性与参数不确定性分开查看。';
  ['meanValue','rangeValue','towerValue','pendingValue'].forEach(id=>$(id).textContent='—');
  $('resultMeta').textContent='选择一个方案，开始首个实验。';
  $('runSummarySection').hidden=true;$('runSummary').textContent='';$('runSummaryMeta').textContent='';
  $('comparisonSection').hidden=true;$('capacity').hidden=true;$('sampleTag').textContent='等待采样';
  $('histogram').replaceChildren(svg('text',{x:190,y:105,'text-anchor':'middle'},'运行后显示采样分布'));
  $('allocation').replaceChildren(elem('p','完成实验后显示各位置经济与装备成型时间。','empty small'));
  $('timeline').replaceChildren(elem('div','运行后，点击事件查看规则与来源。','empty'));
  $('explanation').replaceChildren(elem('p','这里会展示当时的观察、规则输入、放行或拒绝理由，以及收益去向。','muted'));
}

function showError(message){$('error').textContent=message;$('error').hidden=false;$('status').textContent='本次操作未完成。';}

function startRun(compare=false){
  if(!$('configForm').reportValidity()||!state.bundle)return;
  $('error').hidden=true;
  const runs=Number($('runs').value),seed=Number($('seed').value),opts=options();
  if(!Number.isInteger(runs)||runs<1||runs>10000||!Number.isInteger(seed)||seed<0||seed+runs-1>2147483647){showError('次数须为 1–10000 的整数；seed 序列须在 0–2147483647 内。');return;}
  try {
    const programs=compare?comparisonPrograms(state.bundle,opts):[{name:'current',program:assemble(state.bundle,opts)}];
    if(state.worker)state.worker.terminate();
    const jobId=++state.job;const worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});state.worker=worker;
    setBusy(true);$('progress').hidden=false;$('progress').value=0;$('status').textContent='正在本地采样…';
    worker.onmessage=({data})=>{
      if(data.jobId!==state.job)return;
      if(data.type==='progress'){$('progress').value=100*data.done/data.total;$('status').textContent=`已完成 ${data.done} / ${data.total} 次`;
      }else if(data.type==='error'){worker.terminate();state.worker=null;setBusy(false);$('progress').hidden=true;showError(data.message);
      }else if(data.type==='complete'){
        worker.terminate();state.worker=null;state.programs=programs;state.variants=data.variants;state.active=0;state.selected=null;state.time=240;
        setBusy(false);$('progress').hidden=true;$('status').textContent=`完成 ${programs.length} 个方案 × ${runs} 次；同 seed 可复现。`;
        $('exportJson').disabled=false;$('exportCsv').disabled=false;renderResults();
      }
    };
    worker.onerror=event=>{if(jobId!==state.job)return;worker.terminate();state.worker=null;setBusy(false);$('progress').hidden=true;showError('浏览器执行失败：'+event.message);};
    worker.postMessage({jobId,programs,runs,seed});
  }catch(error){setBusy(false);showError(error.message);}
}

function current(){return {batch:state.variants[state.active],program:state.programs[state.active]?.program};}

function renderResults(){
  const {batch,program}=current();if(!batch)return;
  const result=batch.first_run,d=batch.distribution;
  $('meanValue').textContent=(d.mean>0?'+':'')+format(d.mean);
  $('rangeValue').textContent=`${format(d.p5)} / ${format(d.p95)}`;
  $('towerValue').textContent=(result.tower_diff>0?'+':'')+format(result.tower_diff);
  $('pendingValue').textContent=result.pending_calibration.length;
  $('resultMeta').textContent=`${batch.server==='hok'?'国际服 HOK':'国服 CN'} · ${batch.patch} · ${experimentNames[batch.experiment]} · ${nameOf(batch.name)} · seed ${batch.seed}–${batch.seed+batch.runs-1}`;
  $('sampleTag').textContent=`${batch.runs} 次采样`;
  $('distributionNote').textContent=d.std===0?'此方案在当前参数下为确定性结果，重复 seed 不产生额外波动。':'分布来自模型内资源争夺先验，仅用于合成方案比较。';
  $('runSummarySection').hidden=false;
  $('runSummaryMeta').textContent=`${nameOf(batch.name)} · 首个 seed ${batch.seed} · 单次运行完整事件总结`;
  $('runSummary').textContent=summarizeRun(result);
  renderHistogram(batch.samples);renderAllocation(result);renderComparison();renderTimeline();renderMap(program,result);renderCalibration(program);
  $('timeSlider').value=state.time;$('scrubTime').textContent=clock(state.time);
  const t=result.teams.blue,formed=t.roster.filter(p=>p.late_carry).map(p=>p.formed_at===null?'未成型':clock(p.formed_at));
  $('capacity').hidden=false;$('capacity').replaceChildren();
  $('capacity').append(elem('strong',`${t.C_count}C · `),document.createTextNode(`核心成型 ${formed.join(' / ')}。当前容量 ${format(t.current_capacity)} / 后期容量 ${format(t.late_capacity)}，仅为合成指数。`));
  if(batch.experiment==='split_push'){
    const report=result.events.find(e=>e.kind==='decision')?.details.report;
    if(report)$('capacity').append(elem('p',`分带结果：${report.outcome||'待标定'}。${report.reason}`));
  }
  if(batch.experiment==='jungle_economy'){
    const report=result.events.find(e=>e.kind==='decision')?.details.report;
    if(report)$('capacity').append(elem('p',`节奏选择：${nodeNames[report.choice]||'待标定'}。按显式收益、争夺权重与耗时比较。`));
  }
  if(!state.selected){
    const e=result.events.find(e=>['decision','settled','item_formed','action_rejected','pending'].includes(e.kind))||result.events[0];
    if(e)renderExplanation(e);else $('explanation').replaceChildren(elem('p','本次运行没有事件，解释依据待标定。','muted'));
  }
}

function renderHistogram(samples){
  const root=$('histogram');root.replaceChildren();
  const values=samples.map(s=>s.economy_diff),unique=[...new Set(values)].sort((a,b)=>a-b),bins=[];
  if(unique.length<=8){for(const value of unique)bins.push({label:format(value),value,count:values.filter(v=>v===value).length});}
  else{const min=Math.min(...values),max=Math.max(...values),width=(max-min)/8;for(let i=0;i<8;i++)bins.push({value:min+i*width,label:format(min+i*width),count:values.filter(v=>v>=min+i*width&&(i===7?v<=max:v<min+(i+1)*width)).length});}
  const maxCount=Math.max(1,...bins.map(b=>b.count)),plot={x:35,y:23,w:330,h:140};
  for(let i=0;i<=3;i++){const y=plot.y+plot.h*(1-i/3);root.append(svg('line',{x1:plot.x,y1:y,x2:plot.x+plot.w,y2:y,stroke:'#2b394c','stroke-dasharray':'3 4'}));root.append(svg('text',{x:27,y:y+3,'text-anchor':'end'},String(Math.round(maxCount*i/3))));}
  const step=plot.w/bins.length,bar=Math.min(65,step*.62);
  bins.forEach((bin,i)=>{const x=plot.x+step*(i+.5),h=bin.count/maxCount*plot.h;const rect=svg('rect',{x:x-bar/2,y:plot.y+plot.h-h,width:bar,height:Math.max(2,h),rx:3,fill:bin.value<0?'#ee8f92':'#6bbfdf',opacity:.85});rect.append(svg('title',{},`${bin.label} gold：${bin.count} 次`));root.append(rect,svg('text',{x,y:plot.y+plot.h-h-6,'text-anchor':'middle'},String(bin.count)),svg('text',{x,y:185,'text-anchor':'middle'},bin.label));});
  root.append(svg('text',{x:365,y:205,'text-anchor':'end'},'蓝 − 红 / gold'));
}

function renderAllocation(result){
  const root=$('allocation');root.replaceChildren();const max=Math.max(1,...result.teams.blue.roster.map(p=>p.earned_gold));
  for(const p of result.teams.blue.roster){const row=elem('div','','allocation-row'),label=elem('span',roleNames[p.player_id],'allocation-title');const bar=elem('div','','allocation-bar'),fill=elem('i');fill.style.width=`${p.earned_gold/max*100}%`;bar.append(fill);const value=elem('span',format(p.earned_gold));row.title=`${p.hero_id}；${p.formed_at===null?'未成型':`成型 ${clock(p.formed_at)}`}；钱包 ${format(p.equipment.wallet_gold)}`;row.append(label,bar,value);root.append(row);}
}

function renderComparison(){
  $('comparisonSection').hidden=state.variants.length<2;const root=$('comparisonRows');root.replaceChildren();
  state.variants.forEach((batch,i)=>{const button=elem('button','','comparison-card'+(i===state.active?' active':''));button.type='button';button.setAttribute('aria-pressed',String(i===state.active));button.append(elem('span',nameOf(batch.name)),elem('strong',(batch.distribution.mean>0?'+':'')+format(batch.distribution.mean)),elem('small',`P5 ${format(batch.distribution.p5)} / P95 ${format(batch.distribution.p95)}`));button.onclick=()=>{state.active=i;state.selected=null;state.time=240;renderResults();};root.append(button);});
}

function eventTitle(event){
  const d=event.details||{},role=roleNames[event.actor]||'团队';
  if(event.kind==='settled')return `${d.winner==='blue'?'蓝方':d.winner==='red'?'红方':'队伍待标定'}获得${categoryNames[d.category]||'资源待标定'} +${format(d.gold)}`;
  if(event.kind==='decision')return d.report?.outcome?`41 分带：${d.report.outcome}`:`节奏选择：${nodeNames[d.report?.choice]||'待标定'}`;
  if(event.kind==='item_formed')return `${roleNames[d.player_id]||'接收者待标定'} · 装备成型`;
  if(event.kind==='resource_contest')return '资源争夺 · 先验抽样';
  return `${role} · ${{action_started:'开始行动',action_finished:'行动完成',action_rejected:'行动拒绝',resource_unavailable:'资源已结算',dependency_blocked:'前置行动未完成',pending:'缺参暂停',opportunity_cost:'离线机会成本'}[event.kind]||event.kind}`;
}

function renderTimeline(){
  const {batch}=current();if(!batch)return;const root=$('timeline'),scroll=root.scrollTop;root.replaceChildren();
  const main=new Set(['settled','decision','item_formed','action_rejected','resource_contest','pending','opportunity_cost','dependency_blocked']);
  for(const event of batch.first_run.events){if(!$('allEvents').checked&&!main.has(event.kind))continue;
    const rejected=['action_rejected','pending','dependency_blocked'].includes(event.kind);
    const row=elem('button','','event-row'+(event.team==='red'?' red':'')+(rejected?' rejected':'')+(event.event_id===state.selected?' active':'')+(event.at>state.time?' dimmed':''));row.type='button';row.dataset.eventId=event.event_id;
    const body=elem('span',commentaryText(eventTitle(event))||'待标定');body.append(elem('small',commentaryText(event.details?.reason||event.details?.target||event.action_id)||'待标定'));
    row.append(elem('time',clock(event.at)),elem('i','','event-dot'),body);row.onclick=()=>{state.selected=event.event_id;state.time=event.at;$('timeSlider').value=event.at;$('scrubTime').textContent=clock(event.at);renderExplanation(event);renderTimeline();renderMap(current().program,batch.first_run);};root.append(row);
  }
  if(!root.children.length)root.append(elem('div','当前筛选没有事件。','empty'));
  root.scrollTop=scroll;
}

function renderExplanation(event){
  const {program,batch}=current(),root=$('explanation'),d=event.details||{};root.replaceChildren();
  const action=program.events.find(a=>a.id===(event.action_id??d.action_id));
  const target=d.target??d.resource_id??action?.target;
  const label=elem('span','模型内比较 · 合成演示','tag');
  const commentary=elem('p',explainEvent(event,program),'explain-reason');commentary.id='eventCommentary';
  root.append(label,elem('h3',commentaryText(eventTitle(event))||'待标定'),commentary);
  const grid=elem('div','','explain-grid');
  const add=(name,value)=>{grid.append(elem('span',commentaryText(name)||'待标定'),elem('strong',value==null?'待标定':commentaryText(String(value))||'待标定'));};
  add('事件',event.action_id);if(target)add('资源实例',target);if(d.gold!==undefined)add('实际入账',format(d.gold)+' gold');
  if(d.value!==undefined)add('机会成本',format(d.value)+' gold');
  if(d.probability!==undefined){add('蓝方资源先验',format(d.probability));add('配对随机数',typeof d.draw==='number'&&Number.isFinite(d.draw)?String(d.draw):'待标定');}
  if(d.duration_s!==undefined)add('处理耗时',format(d.duration_s)+' s');
  if(d.finish_s!==undefined)add('完成时间',d.finish_s===null?'待标定':clock(d.finish_s));
  if(d.deadline_s!==undefined)add('窗口关闭',d.deadline_s===null?'待标定':clock(d.deadline_s));
  if(d.report?.inputs)for(const [key,value]of Object.entries(d.report.inputs))add(({travel_s:'赶路',clear_s:'清线',push_s:'推塔',enemy_return_s:'敌方回防',danger_seen_s:'观察到风险',escape_s:'撤离',hold_s:'四人组守线',wave_arrived:'兵线到达',source_value:'小野收益',target_value:'目标收益',source_time:'刷野总耗时',target_time:'换目标总耗时',source_weight:'小野权重',target_weight:'目标权重'})[key]||key,value===null?'待标定':typeof value==='boolean'?(value?'是':'否'):format(value));
  if(d.allocation)for(const [id,value]of Object.entries(d.allocation))add(roleNames[id]||id,format(value)+' gold');
  root.append(grid);
  const observed=d.observed||{},safe=value=>commentaryText(value)||'待标定';
  if(Object.keys(observed).length)root.append(elem('p',`观察范围：${safe(observed.scope)}。目标可见：${typeof observed.target_visible==='boolean'?(observed.target_visible?'是':'否'):'待标定'}；已知争夺者：${format(observed.known_opponents)}。`,'small muted'));
  const metric=d.metric||d.reward;
  if(metric)root.append(elem('p',`来源：${safe(metric.source)} · ${safe(metric.server)}/${safe(metric.patch)} · ${safe(metric.observed_at)} · 置信 ${safe(metric.confidence)}`,'source'));
  if(d.probability_source)root.append(elem('p',safe(d.probability_source),'source'));
  const details=elem('details'),summary=elem('summary','事件规则输入与状态');
  details.append(summary,elem('pre',JSON.stringify(d,(key,value)=>typeof value==='string'?safe(value):value,2)));root.append(details);
  root.append(elem('p',`${safe(batch.label)} · 缺值为待标定`,'tiny muted'));
}

function renderMap(program,result){
  renderMinimap(program,result,state.time,state.selected);
  if(!program)return;const root=$('map');root.replaceChildren();
  const coordinates=Object.fromEntries(program.map.nodes.map(n=>[n.node_id,{x:40+n.x*3.2,y:22+n.y*2.65,name:n.name}]));
  root.append(svg('rect',{x:12,y:8,width:376,height:300,rx:18,fill:'#121e2b',stroke:'#2c3b4f'}));
  for(let i=1;i<8;i++)root.append(svg('line',{x1:14+i*47,y1:12,x2:14+i*47,y2:304,stroke:'#223247','stroke-width':.5}),svg('line',{x1:16,y1:9+i*37,x2:384,y2:9+i*37,stroke:'#223247','stroke-width':.5}));
  root.append(svg('path',{d:'M28 35 Q170 110 174 165 T370 286',fill:'none',stroke:'#254457','stroke-width':15,opacity:.26}));
  const drawn=new Set();for(const edge of program.map.edges){const key=[edge.origin,edge.destination].sort().join('|');if(drawn.has(key))continue;drawn.add(key);const a=coordinates[edge.origin],b=coordinates[edge.destination];root.append(svg('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'#4c6077','stroke-dasharray':'4 5','stroke-width':1.3}));}
  const colors={},nodeCounts={};if(result)for(const entry of result.ledger.entries){if(entry.at>state.time)continue;const r=program.resources[entry.resource_id];if(!r)continue;const winner=entry.postings.find(p=>p.account==='blue'||p.account==='red')?.account;colors[r.node]=winner;nodeCounts[r.node]=(nodeCounts[r.node]||0)+1;}
  const selected=result?.events.find(e=>e.event_id===state.selected),selectedResource=program.resources[selected?.details.target];
  for(const node of program.map.nodes){const p=coordinates[node.node_id],winner=colors[node.node_id],color=winner==='blue'?'#6bbfdf':winner==='red'?'#ee8f92':'#60738b';const g=svg('g',{class:selectedResource?.node===node.node_id?'node-selected':''});
    g.append(svg('circle',{cx:p.x,cy:p.y,r:14,fill:color+'15',stroke:color,opacity:.8}),svg(node.kind==='tower'?'rect':'circle',node.kind==='tower'?{x:p.x-4,y:p.y-5,width:8,height:10,rx:1,fill:color}:{cx:p.x,cy:p.y,r:4,fill:color}));
    const label=(nodeNames[node.node_id]||node.name)+(nodeCounts[node.node_id]?` · ${nodeCounts[node.node_id]}`:'');
    g.append(svg('text',{x:p.x,y:p.y+27,'text-anchor':'middle'},label),svg('title',{},`${node.name}；${node.source}；${winner==='blue'?'蓝方最近入账':winner==='red'?'红方最近入账':'未结算'}`));root.append(g);
  }
  $('mapTime').textContent=`${clock(state.time)} 宏观快照`;
}

function renderCalibration(program){
  const root=$('calibrationList');root.replaceChildren();const entries=Object.entries(program.parameters).sort(([a],[b])=>a.localeCompare(b));
  $('calibrationCount').textContent=`${entries.filter(([,p])=>p.status!=='实测').length} 项待标定`;
  for(const [key,p]of entries){const row=elem('div','','parameter-row');row.append(elem('code',key),elem('span',`${p.metric===null?'待标定':format(p.metric.value)} ${p.unit}`),elem('span',p.metric?`${p.status} · ${p.metric.server}/${p.metric.patch}`:'待标定 · null'));row.title=p.metric?.source||'缺少同服同补丁测量';root.append(row);}
}

function download(formatName){
  if(!state.variants.length)return;
  const first=state.variants[0],result={label:first.label,server:first.server,patch:first.patch,experiment:first.experiment,runs:first.runs,seed:first.seed,variants:state.variants,
    pending_calibration:[...new Set(state.variants.flatMap(v=>v.pending_calibration))].sort()};
  let content,mime;
  if(formatName==='json'){content=JSON.stringify(result,null,2);mime='application/json';}
  else{const quote=value=>'"'+String(value).replaceAll('"','""')+'"';const rows=[['label','server','patch','variant','seed','economy_diff','tower_diff']];for(const v of result.variants)for(const s of v.samples)rows.push([v.label,v.server,v.patch,v.name,s.seed,s.economy_diff,s.tower_diff]);content='\ufeff'+rows.map(r=>r.map(quote).join(',')).join('\r\n');mime='text/csv;charset=utf-8';}
  const url=URL.createObjectURL(new Blob([content],{type:mime})),link=elem('a');link.href=url;link.download=`hok-${result.server}-${result.experiment}-seed${result.seed}.${formatName}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

$('configForm').addEventListener('submit',event=>{event.preventDefault();startRun(false);});
$('configForm').addEventListener('change',event=>{if(event.target.id!=='server')updateForm();});
$('server').addEventListener('change',loadBundle);
$('compareButton').onclick=()=>startRun(true);
$('cancelButton').onclick=()=>{if(state.worker)state.worker.terminate();state.worker=null;state.job++;setBusy(false);$('progress').hidden=true;$('status').textContent='已取消本次运行；未完成的样本不计入结果。';};
$('allEvents').onchange=renderTimeline;
$('timeSlider').oninput=()=>{state.time=Number($('timeSlider').value);$('scrubTime').textContent=clock(state.time);const {program,batch}=current();renderMap(program,batch?.first_run);renderTimeline();};
$('resetTime').onclick=()=>{state.time=240;$('timeSlider').value=240;$('scrubTime').textContent='04:00';const {program,batch}=current();renderMap(program,batch?.first_run);renderTimeline();};
$('exportJson').onclick=()=>download('json');$('exportCsv').onclick=()=>download('csv');
initMinimap();clearResults();updateForm();loadBundle();
initMicro();
