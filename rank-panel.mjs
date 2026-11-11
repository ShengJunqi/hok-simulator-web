import {rankPanelTemplate} from './rank-panel-template.mjs';
import {initCombatInputs} from './rank-combat-ui.mjs';
import {createCombat} from './rank-combat.mjs';
import {validateRankBundle,validateRoster,validateStyleMix} from './rank-core.mjs';
import {quantile,sum,summarizeDistribution,winProbability} from './rank-winprob.mjs';
import {renderEconomyChart,renderProbabilityHistogram} from './rank-charts.mjs';

const roleNames={clash:'对抗路',mid:'中路',farm:'发育路',jungle:'打野',roam:'游走'};
const kindNames={farm:'基础发育',wave:'兵线机会',kill:'击杀奖励机会',tower:'推塔机会',dragon:'控龙机会'};
const teamNames={blue:'蓝方',red:'红方'};
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const number=v=>finite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:1}):'待标定';
const percent=v=>finite(v)?`${(v*100).toFixed(1)}%`:'待标定';
const safeText=v=>/真实.*胜率|实际胜率/.test(String(v))?'说明待标定':String(v);
const clock=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;

export function validateRankResult(batch,request,bundle){
  const fail=()=>{throw new Error('过程结果版本、范围或事件引用不完整，待标定');};
  const equal=(a,b)=>a===null||b===null?a===b:finite(a)&&finite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(b));
  const checkCounts=(counts,expected)=>{for(const team of ['blue','red'])for(const kind of ['kill','tower','dragon'])if(!Number.isInteger(counts?.[team]?.[kind])||counts[team][kind]<0||counts[team][kind]!==expected[team][kind])fail();};
  const checkDistribution=(actual,samples)=>{const expected=summarizeDistribution(samples);for(const key of Object.keys(expected))if(!equal(actual[key],expected[key]))fail();};
  const compare=(actual,expected)=>{if(typeof expected==='number'){if(!equal(actual,expected))fail();}else if(expected&&typeof expected==='object'){if(!actual||JSON.stringify(Object.keys(actual).sort())!==JSON.stringify(Object.keys(expected).sort()))fail();for(const key of Object.keys(expected))compare(actual[key],expected[key]);}else if(actual!==expected)fail();};
  const parameters=request.parameters??bundle.parameters;
  const values=Object.fromEntries(Object.keys(bundle.parameter_units).map(k=>[k,parameters.values[k]?.metric?.value??null]));
  const expectedCombat=createCombat(bundle,request,validateRoster(bundle,request.heroes),request.opponent_heroes==null?null:validateRoster(bundle,request.opponent_heroes),values);
  if(batch.server!==request.server||batch.patch!==bundle.patch||batch.mode!==request.mode||batch.seed!==request.seed||batch.runs!==request.runs||batch.calibrated!==false||batch.results?.length!==request.runs)fail();
  for(let i=0;i<batch.results.length;i++){
    const run=batch.results[i];
    if(run.schema_version!==bundle.schema_version||run.server!==batch.server||run.patch!==batch.patch||run.mode!==batch.mode||run.seed!==request.seed+i||run.calibrated!==false||run.label!==bundle.label)fail();
    const events=new Map(run.events?.map(e=>[e.event_id,e])),entries=new Map(run.ledger?.entries?.map(e=>[e.event_id,e]));
    if(events.size!==run.events.length||entries.size!==run.ledger.entries.length||run.ledger.server!==batch.server||run.ledger.patch!==batch.patch)fail();
    const runningCounts={blue:{kill:0,tower:0,dragon:0},red:{kill:0,tower:0,dragon:0}},accountAmounts=new Map([['blue',[]],['red',[]]]),signed=[];
    let known=run.initial_economy_diff!==null,lastAt=-1;
    if(known&&!finite(run.initial_economy_diff))fail();
    const economy=()=>known?run.initial_economy_diff+sum(signed):null;
    const eventAfter=new Map(),resourceIds=new Set(),usedEntries=new Set();
    for(const event of events.values()){
      if(event.server!==batch.server||event.patch!==batch.patch||!finite(event.at)||!['sampled','no_event','unknown'].includes(event.status))fail();
      if(event.at<lastAt||event.at>run.horizon_s||!equal(event.economy_diff_before,economy()))fail();lastAt=event.at;
      if(event.ledger_event_ids.some(id=>!entries.has(id)))fail();
      if(event.status==='sampled'&&!event.ledger_event_ids.length)fail();
      if(event.status!=='sampled'&&event.ledger_event_ids.length)fail();
      if(event.status==='unknown')known=false;
      for(const id of event.ledger_event_ids){
        const entry=entries.get(id);
        if(id!==event.event_id||usedEntries.has(id)||entry.resource_id!==event.resource_id||resourceIds.has(entry.resource_id)||entry.at!==event.at||!finite(event.reward)||event.reward<0||entry.metric.value!==event.reward||!['blue','red'].includes(event.team))fail();
        usedEntries.add(id);resourceIds.add(entry.resource_id);
        if(entry.metric.server!==batch.server||entry.metric.patch!==batch.patch||entry.postings.some(p=>!finite(p.amount))||Math.abs(sum(entry.postings.map(p=>p.amount)))>1e-8)fail();
        const expectedCategory=({farm:'wave',dragon:'objective'})[event.kind]??event.kind;
        if(entry.category!==expectedCategory||entry.postings.length!==2||entry.postings[0].account!==`environment:${expectedCategory}`||entry.postings[0].amount!==-event.reward||entry.postings[1].account!==event.team||entry.postings[1].amount!==event.reward)fail();
        for(const posting of entry.postings){if(!accountAmounts.has(posting.account))accountAmounts.set(posting.account,[]);accountAmounts.get(posting.account).push(posting.amount);if(['blue','red'].includes(posting.account))signed.push(posting.amount*(posting.account==='blue'?1:-1));}
        if(Object.hasOwn(runningCounts[event.team],event.kind))runningCounts[event.team][event.kind]++;
      }
      if(!equal(event.economy_diff_after,economy()))fail();
      eventAfter.set(event.event_id,{economy:economy(),net:sum(signed),counts:structuredClone(runningCounts)});
    }
    if(usedEntries.size!==entries.size||!equal(run.economy_diff,economy())||!equal(run.ledger.net_diff,sum(signed)))fail();
    if(Object.keys(run.ledger.balances).length!==accountAmounts.size)fail();
    for(const [account,amounts] of accountAmounts)if(!equal(run.ledger.balances[account],sum(amounts)))fail();
    checkCounts(run.counts,runningCounts);
    let previous=-1;
    for(const row of run.timeline){
      if(!finite(row.at)||row.at<previous||(row.economy_diff!==null&&!finite(row.economy_diff))||row.event_ids.some(id=>!events.has(id)))fail();previous=row.at;
      const expected=row.at===0?{economy:run.initial_economy_diff,net:0,counts:{blue:{kill:0,tower:0,dragon:0},red:{kill:0,tower:0,dragon:0}}}:eventAfter.get(row.event_ids.at(-1));
      if(!expected||!equal(row.economy_diff,expected.economy)||!equal(row.known_ledger_diff,expected.net)||row.event_ids.some(id=>events.get(id).at!==row.at))fail();
      checkCounts(row.counts,expected.counts);
      compare(row.combat,expectedCombat(row.at));
    }
    if(run.timeline[0]?.at!==0||run.timeline.at(-1)?.at!==run.horizon_s)fail();
    compare(run.combat,run.timeline.at(-1).combat);
    for(const point of run.turning_points)if(!events.has(point.event_id)||point.ledger_event_ids.some(id=>!entries.has(id)))fail();
    const win=run.win_probability;
    if(win.server!==batch.server||win.patch!==batch.patch||win.calibrated!==false||win.samples.some(p=>!finite(p)||p<0||p>1))fail();
    if(win.probability!==null&&(!finite(win.probability)||win.probability<0||win.probability>1))fail();
    if(win.status==='unknown'&&(win.probability!==null||win.samples.length)||win.status==='synthetic'&&(win.probability===null||win.samples.length!==128))fail();
    checkDistribution(win.distribution,win.samples);
    const storm=run.combat.storm;
    compare(win,winProbability(run.economy_diff,run.horizon_s,request.mode,{server:bundle.server,patch:bundle.patch,seed:run.seed,profile:request.profile??bundle.profiles[request.mode],coefficients:request.winprob_coefficients??bundle.coefficients,fight_power_delta:run.combat.fight_power_delta,high_ground_advantage:storm===null?0:storm.high_ground_advantage,backdoor_pressure_delta:storm===null?0:storm.backdoor_pressure_delta}));
    if(run.hero_effect_status!==run.combat.status||run.status!==(!known||win.status==='unknown'||run.combat.status==='unknown'?'unknown':'synthetic'))fail();
  }
  const known=batch.results.filter(r=>r.win_probability.status==='synthetic').length;
  if(batch.known_runs!==known||batch.unknown_runs!==batch.runs-known)fail();
  if(known!==batch.runs&&batch.distribution.mean!==null)fail();
  const draws=batch.results.filter(r=>r.win_probability.status==='synthetic').flatMap(r=>r.win_probability.samples);
  checkDistribution(batch.distribution,known===batch.runs?draws:[]);checkDistribution(batch.known_subset_distribution,draws);
  for(const key of ['mean','p05','p50','p95']){const v=batch.distribution[key];if(v!==null&&(!finite(v)||v<0||v>1))fail();}
  return batch;
}

export function initRankPanel({document:doc=globalThis.document,fetcher=(...args)=>globalThis.fetch(...args),createWorker=url=>new Worker(url,{type:'module'})}={}){
  const root=doc.getElementById('rankPanel');if(!root)return null;
  root.innerHTML=rankPanelTemplate;root.setAttribute('aria-labelledby','rankTitle');
  const $=id=>root.querySelector(`#${id}`);
  const element=(tag,text,className)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=safeText(text);if(className)el.className=className;return el;};
  let bundle=null,combatInputs=null,worker=null,loadVersion=0,job=0,busy=false,destroyed=false,chartPoints=null;
  const chartObserver=typeof doc.defaultView?.ResizeObserver==='function'?new doc.defaultView.ResizeObserver(()=>{
    if(chartPoints&&!destroyed)renderEconomyChart($('rankChart'),chartPoints);
  }):null;
  chartObserver?.observe($('rankChart'));
  function clearResults(){
    chartPoints=null;
    $('rankResults').hidden=true;$('rankEmpty').hidden=false;
    for(const id of ['rankMeta','rankInterpretation','rankChart','rankPhases','rankCombatSummary','rankCombatTimeline','rankCombatEvidence','rankProbability','rankProbabilityRange','rankHistogram','rankTimeline','rankEvidence','rankFullEvidence','rankComebacks','rankSource','rankPending'])$(id).replaceChildren();
  }
  function stop(message){
    job++;worker?.terminate();worker=null;busy=false;$('rankProgress').hidden=true;$('rankCancel').disabled=true;
    if(message)$('rankStatus').textContent=message;
  }
  function readRequest(){
    if(!bundle)throw new Error('模式参数尚未加载，待标定');
    const heroes=bundle.roles.map(lane=>({hero_id:$(`rankHero-${lane}`).value.trim(),lane,server:bundle.server,patch:bundle.patch,tags:null}));
    if(heroes.some(h=>!h.hero_id))throw new Error('请填写五路英雄姓名或 ID；未知特性保持待标定');
    if(new Set(heroes.map(h=>h.hero_id)).size!==5)throw new Error('五路英雄不能重复');
    validateRoster(bundle,heroes);
    const style_mix=Object.fromEntries(bundle.styles.map(style=>[style,Number($(`rankStyle-${style}`).value)/100]));
    try{validateStyleMix(bundle,style_mix);}catch{throw new Error('六类打法占比必须合计 100%，不会自动归一化');}
    const runs=$('rankRuns').valueAsNumber,seed=$('rankSeed').valueAsNumber;
    if(!Number.isInteger(runs)||runs<1||runs>1000)throw new Error('运行次数须为 1–1000 的整数');
    if(!Number.isInteger(seed)||seed<0||seed>2147483647||seed+runs-1>2147483647)throw new Error('seed 及末次 seed 须在 0–2147483647 内');
    return {server:bundle.server,patch:bundle.patch,mode:$('rankMode').value,...combatInputs.read(heroes),style_mix,runs,seed};
  }
  function validateForm(){
    if(bundle){
      const total=sum(bundle.styles.map(style=>Number($(`rankStyle-${style}`).value)));
      $('rankTotal').textContent=`合计 ${number(total)}%`;$('rankTotal').dataset.valid=String(Math.abs(total-100)<1e-7);
      for(const style of bundle.styles)$(`rankShare-${style}`).textContent=`${number(Number($(`rankStyle-${style}`).value))}%`;
    }
    try{readRequest();$('rankValidation').textContent='合计 100% · 合成输入有效；缺参将在结果中显示待标定';$('rankRun').disabled=busy;return true;}
    catch(error){$('rankValidation').textContent=error.message;$('rankRun').disabled=true;return false;}
  }
  function resetStyles(){
    if(!bundle)return;
    const profile=bundle.profiles[$('rankMode').value];
    for(const style of bundle.styles)$(`rankStyle-${style}`).value=String(profile.style_mix[style]*100);
    stop();clearResults();validateForm();$('rankStatus').textContent=`已加载 ${profile.mode_label} 的合成先验 · 待标定`;
  }
  function buildForm(){
    const previous=$('rankMode').value;
    $('rankMode').replaceChildren(...bundle.modes.map(mode=>{const option=element('option',bundle.profiles[mode].mode_label);option.value=mode;return option;}));
    $('rankMode').value=bundle.modes.includes(previous)?previous:'ranked';
    $('rankHeroes').replaceChildren(...bundle.roles.map(lane=>{
      const label=element('label',undefined,'rank-hero');label.htmlFor=`rankHero-${lane}`;label.append(element('span',roleNames[lane]));
      const input=element('input');input.id=`rankHero-${lane}`;input.type='text';input.maxLength=80;input.required=true;input.autocomplete='off';input.placeholder='英雄姓名 / ID';label.append(input);return label;
    }));
    const profile=bundle.profiles[$('rankMode').value];
    $('rankStyles').replaceChildren(...bundle.styles.map(style=>{
      const row=element('label',undefined,'rank-style');row.htmlFor=`rankStyle-${style}`;row.append(element('span',profile.style_labels[style]));
      const input=element('input');input.id=`rankStyle-${style}`;input.type='range';input.min='0';input.max='100';input.step='1';input.setAttribute('aria-describedby','rankTotal rankValidation');
      const output=element('output');output.id=`rankShare-${style}`;output.htmlFor=input.id;row.append(input,output);return row;
    }));
    combatInputs=initCombatInputs(root,bundle,()=>{stop();clearResults();$('rankError').hidden=true;validateForm();$('rankStatus').textContent='场景输入已更改 · 合成 / 待标定；等待重新运行';});
    $('rankMode').disabled=false;$('rankReset').disabled=false;resetStyles();
  }
  async function load(){
    const version=++loadVersion,server=$('rankServer').value;
    stop();bundle=null;combatInputs=null;clearResults();$('rankCombatFields').replaceChildren();$('rankScenarioButtons').replaceChildren();$('rankMode').disabled=true;$('rankReset').disabled=true;$('rankRun').disabled=true;$('rankError').hidden=true;
    $('rankHeroes').replaceChildren();$('rankStyles').replaceChildren();$('rankTotal').textContent='合计待标定';$('rankValidation').textContent='';
    $('rankStatus').textContent=`正在读取 ${server.toUpperCase()} 独立合成参数…`;
    try{
      const response=await fetcher(`./data/rank-${server}.json`);
      if(!response.ok)throw new Error(`HTTP ${response.status}；可重新加载参数`);
      const data=await response.json();if(version!==loadVersion||destroyed)return;
      bundle=validateRankBundle(data,server);buildForm();
    }catch(error){
      if(version!==loadVersion||destroyed)return;
      bundle=null;$('rankError').textContent=`模式参数加载失败：${safeText(error.message)}`;$('rankError').hidden=false;$('rankStatus').textContent='参数待标定；未使用其他服务器数据';
    }
  }
  function showEvidence(run,event){
    $('rankEvidence').replaceChildren();
    for(const button of $('rankTimeline').children)button.setAttribute('aria-pressed',String(button.dataset.eventId===event.event_id));
    const point=run.turning_points.find(p=>p.event_id===event.event_id);
    $('rankEvidence').append(element('h4',`${clock(event.at)} · ${kindNames[event.kind]??event.kind}`));
    const reason=event.status==='sampled'?`${teamNames[event.team]}获得合成资源收益 ${number(event.reward)} gold。`:event.status==='no_event'?'本次机会未发生，未产生资源入账。':`参数待标定：${event.missing.join('、')}。`;
    $('rankEvidence').append(element('p',reason),element('p',`经济差 ${number(event.economy_diff_before)} → ${number(event.economy_diff_after)}；模型内 / 未校准。`));
    if(point)$('rankEvidence').append(element('p',`关键转折：${point.reasons.map(r=>r==='lead_reversal'?'阶段步领先反转':'阶段步经济变化较大').join('、')}。对比同一分钟全部结算后的快照。`));
    const details=element('details'),summary=element('summary','事件 / 账本 / 参数依据'),pre=element('pre');
    const ledger=run.ledger.entries.filter(e=>event.ledger_event_ids.includes(e.event_id));
    pre.textContent=safeText(JSON.stringify({event,ledger,turning_point:point??null},null,2));details.append(summary,pre);$('rankEvidence').append(details);
  }
  function render(batch){
    const first=batch.results[0],runs=batch.results,profile=first.profile;
    $('rankEmpty').hidden=true;$('rankResults').hidden=false;
    $('rankMeta').textContent=`${batch.server.toUpperCase()} · ${profile.mode_label} · ${batch.runs} 次 · seed ${batch.seed}–${batch.seed+batch.runs-1} · ${batch.patch} · 合成 / 未校准。游戏版本待标定；战力按显式阶段评分与场景输入计算。`;
    const points=first.timeline.map((row,i)=>{
      const values=runs.map(run=>run.timeline[i].economy_diff),complete=values.every(finite);
      const label=row.at===0?'0':first.phases.find(p=>(p.end_s??first.horizon_s)===row.at)?.label??'';
      return {minutes:row.at/60,label,mean:complete?sum(values)/values.length:null,low:complete?quantile(values,.1):null,high:complete?quantile(values,.9):null};
    });
    chartPoints=points;renderEconomyChart($('rankChart'),points);
    const finalPoint=points.at(-1),distribution=batch.distribution;
    const economyText=finite(finalPoint?.mean)?`${number(finalPoint.mean)} 金币`:'待标定';
    const probabilityText=finite(distribution.mean)?`${percent(distribution.mean)}（P5–P95：${percent(distribution.p05)}–${percent(distribution.p95)}）`:'待标定（存在缺参过程）';
    $('rankInterpretation').textContent=`结果解读：经济过程在 ${number(first.horizon_s/60)} 分钟末的蓝方 − 红方经济差均值为${economyText}，蓝方模型内胜率均值为${probabilityText}；结合首 seed 塔龙事件账本与经济 / 战力 / 高地 / 偷家压力映射依据解读，全部为合成 / 未校准。`;
    $('rankPhases').replaceChildren(...first.phases.map(phase=>{
      const end=Math.min(phase.end_s??first.horizon_s,first.horizon_s),i=first.timeline.findIndex(row=>row.at===end),point=points[i],row=first.timeline[i],tr=element('tr');
      const counts=row?.counts;
      const cells=[`${phase.label} 分钟`,number(point?.mean),`${number(point?.low)} / ${number(point?.high)}`,counts?`${counts.blue.tower-counts.red.tower} / ${counts.blue.dragon-counts.red.dragon}（已知事件）`:'待标定'];
      cells.forEach(value=>tr.append(element('td',value)));return tr;
    }));
    renderCombat(first);
    $('rankProbability').textContent=percent(batch.distribution.mean);
    $('rankProbabilityRange').textContent=`P5 / P50 / P95：${percent(batch.distribution.p05)} / ${percent(batch.distribution.p50)} / ${percent(batch.distribution.p95)} · ${batch.unknown_runs} 次过程待标定`;
    renderProbabilityHistogram($('rankHistogram'),batch.unknown_runs?[]:runs.flatMap(run=>run.win_probability.samples));
    const turning=new Set(first.turning_points.map(p=>p.event_id));
    const events=first.events.filter(e=>e.kind!=='farm'||turning.has(e.event_id));
    $('rankTimeline').replaceChildren(...events.map(event=>{
      const button=element('button',undefined,'rank-event');button.type='button';button.dataset.eventId=event.event_id;button.setAttribute('aria-pressed','false');
      button.append(element('time',clock(event.at)),element('span',`${kindNames[event.kind]??event.kind}${turning.has(event.event_id)?' · 关键转折':''}`));
      button.append(element('small',event.status==='sampled'?`${teamNames[event.team]} · 合成收益 ${number(event.reward)}`:event.status==='unknown'?'待标定 · 未结算':'机会未发生 · 无入账'));
      button.onclick=()=>showEvidence(first,event);return button;
    }));
    if(events.length)showEvidence(first,events[0]);
    const {seed,server,patch,mode,heroes,opponent,combat,initial_economy_diff,economy_diff,timeline,ledger,turning_points,missing}=first;
    $('rankFullEvidence').textContent=JSON.stringify({label:'合成 / 模型内 / 未校准',seed,server,patch,mode,heroes,opponent,combat,initial_economy_diff,economy_diff,timeline,events:first.events,ledger,turning_points,missing},(key,value)=>typeof value==='string'?safeText(value):value,2);
    $('rankComebacks').replaceChildren();
    const candidates=first.comeback_candidates.length?first.comeback_candidates:[{path:'英雄特性路径候选',hero_id:'五路英雄标签 unknown',conditions:null},{path:'局势逆转路径候选',hero_id:'条件 / 证据 / 效果待标定',conditions:null}];
    for(const candidate of candidates){const card=element('article',undefined,'rank-comeback');card.append(element('h4',candidate.path),element('p',candidate.hero_id),element('p','占位 / 待标定 · 暂无已验证条件与效果，不估算成功概率。'));$('rankComebacks').append(card);}
    $('rankSource').textContent=`${safeText(profile.source)}。模型参数 ${bundle.data_version}；未按英雄姓名推断能力或按团队经济猜测装备，所有合成数值仍待标定。`;
    const pending=new Set(runs.flatMap(run=>[...run.pending_calibration,...run.missing]));
    $('rankPending').replaceChildren(...[...pending].sort().map(key=>element('li',`${key} · 待标定`)));
  }
  function renderCombat(run){
    const combat=run.combat,storm=combat.storm;
    const state=v=>v===null||v===undefined?'待标定':v?'已成型':'未成型';
    const pair=(values)=>`${number(values?.blue)} / ${number(values?.red)}`;
    const owner=storm?.high_ground_lane_owner===null?'待标定':({blue:'蓝方',red:'红方',none:'双方无优势'})[storm?.high_ground_lane_owner]??'未到风暴阶段';
    const action=({contest:'真开 / 争夺',counter_engage_window:'假开 / 反开窗口（不结算龙）',hold_fire:'停手（不结算龙）'})[storm?.dragon_action]??'待标定';
    const text=[`末段有效战力：蓝 / 红 ${pair(combat.effective_power)}；战力差 ${number(combat.fight_power_delta)}。`,
      `破晓：蓝方 ${state(combat.teams.blue?.adc_dawn.ready_at_time)} / 红方 ${state(combat.teams.red?.adc_dawn.ready_at_time)}。价格与出装阈值待标定。`,
      `高地优势方：${owner}；有效偷家压力 ${number(storm?.effective_backdoor_pressure)}；蓝 / 红带线补偿 ${pair(storm?.split_compensation)}。`,
      `正面人数：蓝 / 红 ${pair(storm?.frontline_counts)}；强制回防 ${pair(storm?.forced_defenders)}；${action}。`];
    $('rankCombatSummary').replaceChildren(...text.map(line=>element('p',line)));
    const rows=run.timeline.filter(row=>[600,660,1200,run.horizon_s].includes(row.at));
    $('rankCombatTimeline').replaceChildren(...rows.map(row=>{const c=row.combat,tr=element('tr');const cells=[clock(row.at),`${number(c.teams.blue?.power)} / ${number(c.teams.red?.power)}`,pair(c.effective_power),number(c.fight_power_delta),`${state(c.teams.blue?.adc_dawn.ready_at_time)} / ${state(c.teams.red?.adc_dawn.ready_at_time)}`,c.storm?pair(c.storm.frontline_counts):'风暴扣人未启用'];cells.forEach(value=>tr.append(element('td',value)));return tr;}));
    $('rankCombatEvidence').textContent=JSON.stringify({combat,logit_terms:run.win_probability.logit_terms,inputs:run.win_probability.inputs,missing:run.win_probability.missing},(key,value)=>typeof value==='string'?safeText(value):value,2);
  }
  function start(event){
    event.preventDefault();if(!validateForm())return;
    const request=readRequest();stop();clearResults();busy=true;const current=job;
    $('rankError').hidden=true;$('rankCancel').disabled=false;$('rankProgress').hidden=false;$('rankProgress').value=0;$('rankStatus').textContent='正在本地生成合成过程…';validateForm();
    const fail=message=>{if(current!==job)return;stop();clearResults();$('rankError').textContent=safeText(message);$('rankError').hidden=false;$('rankStatus').textContent='运行未完成；结果待标定';validateForm();};
    try{
      worker=createWorker(new URL('./rank-worker.mjs',import.meta.url));
      worker.onmessage=({data})=>{
        if(current!==job||data.job!==current||destroyed)return;
        if(data.type==='progress'){$('rankProgress').value=data.done/data.total*100;$('rankStatus').textContent=`合成采样 ${data.done} / ${data.total}`;}
        else if(data.type==='error')fail(data.message);
        else if(data.type==='complete'){
          try{validateRankResult(data.batch,request,bundle);render(data.batch);stop();$('rankStatus').textContent=`完成 ${request.runs} 次 · 模型内 / 未校准 · ${data.batch.unknown_runs} 次待标定`;validateForm();}catch(error){fail(error.message);}
        }
      };
      worker.onerror=error=>fail(error.message||'本地模拟线程失败');worker.postMessage({bundle,request,job:current});
    }catch(error){fail(error.message||'浏览器未提供本地 Worker');}
  }
  $('rankForm').addEventListener('submit',start);
  $('rankForm').addEventListener('input',event=>{if(event.target.id==='rankServer')return;stop();clearResults();$('rankError').hidden=true;validateForm();$('rankStatus').textContent='输入已更改，等待重新运行';});
  $('rankMode').addEventListener('change',()=>{stop();clearResults();validateForm();$('rankStatus').textContent='已切换模式；当前占比保留，可点击恢复模式先验';});
  $('rankServer').addEventListener('change',load);
  $('rankReset').onclick=resetStyles;$('rankReload').onclick=load;
  $('rankCancel').onclick=()=>{stop('已取消；未完成样本不计入结果');clearResults();validateForm();};
  const ready=load();
  return {ready,destroy(){destroyed=true;loadVersion++;chartObserver?.disconnect();stop();},reload:load};
}
