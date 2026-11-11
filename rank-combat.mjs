// N4 process.py combat nodes. Values/rosters are validated by rank-core;
// no hero power, equipment or opponent inputs are supplied implicitly.
import {finiteNumber,sum} from './rank-winprob.mjs';
const teams=['blue','red'];
const mapping=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const unique=values=>[...new Set(values)].sort();
export function scopedInput(bundle,value){
  if(value!=null&&(!mapping(value)||value.server!==bundle.server||value.patch!==bundle.patch))throw new Error('禁止跨服/跨补丁；需要有范围的输入');
}
export function validateCombatEconomy(bundle,economy){
  scopedInput(bundle,economy);if(economy==null)return;
  const records=economy.by_hero===undefined?{}:economy.by_hero;
  if(!mapping(records))throw new Error('economy.by_hero must be a mapping');
  for(const record of Object.values(records)){
    if(!mapping(record)||Object.keys(record).some(k=>!['gold_delta','level_delta'].includes(k)))throw new Error('hero economy requires gold_delta/level_delta');
    for(const [k,v] of Object.entries(record))if(v!==null)finiteNumber(v,k);
  }
  const ready=economy.adc_dawn_ready??null,timing=economy.adc_dawn_timing??null;
  if(ready!==null&&typeof ready!=='boolean')throw new Error('adc_dawn_ready must be bool|null');
  if(timing!==null){finiteNumber(timing,'adc_dawn_timing',0);if(ready!==null&&ready!==(timing<=600))throw new Error('adc_dawn_ready conflicts with adc_dawn_timing at 600s');}
}
export function adcDawnState(bundle,time_s,economy,values){
  finiteNumber(time_s,'time_s',0);validateCombatEconomy(bundle,economy);
  const timing=economy?.adc_dawn_timing??null;
  let ready=economy?.adc_dawn_ready??null;if(timing!==null)ready=timing<=600;
  const active=time_s>=600,current_ready=timing!==null?time_s>=timing:ready,missing=[];
  let multiplier=1;
  if(active){
    if(current_ready===null){missing.push('adc_dawn_ready_or_timing');multiplier=null;}
    else{const key=current_ready?'adc_dawn_ready_multiplier':'adc_dawn_not_ready_multiplier';multiplier=values[key];if(multiplier===null)missing.push(key);}
  }
  return {server:bundle.server,patch:bundle.patch,label:bundle.label,calibrated:false,status:missing.length?'unknown':active?'synthetic':'inactive',adc_dawn_ready:ready,adc_dawn_timing:timing,ready_at_time:current_ready,at:time_s,multiplier,missing,adc_dawn_price:values.adc_dawn_price,adc_dawn_build_threshold:values.adc_dawn_build_threshold,pending_calibration:[...bundle.calibration_only].sort(),item_mapping_status:'待核对'};
}
export function teamFightPower(bundle,phase,roster,economy,values,{scoring_bank=null,scoring_version=null,at=null}={}){
  const definition=bundle.phases.find(p=>p.phase===phase);if(!definition)throw new Error('invalid phase');
  at??=definition.start_s;finiteNumber(at,'phase time',0);
  if(bundle.phases.filter(p=>at>=p.start_s).at(-1).phase!==phase)throw new Error('phase/time mismatch');
  if(scoring_bank!==null){
    const data=scoring_bank.data;
    if(!mapping(data)||data.kind!=='scoring'||data.schema_version!==1)throw new Error('scoring_bank must be a serialized ScoringBank of kind scoring');
    if(!scoring_version||data.server!==bundle.server||data.version!==scoring_version)throw new Error('禁止跨服/跨评分版本');
    for(const [hero,item] of Object.entries(data.heroes??{}))for(const [lane,record] of Object.entries(item.by_lane??{})){
      if(!['Clash Lane','Mid','Farm','Jungle','Roam'].includes(lane)||record.lane!==lane||record.hero!==hero||record.server!==data.server||record.version!==data.version||!record.source||!record.status)throw new Error('invalid historical scoring record');
      if(record.tier!=null&&(!Number.isInteger(record.tier)||![1,2,3].includes(record.tier)||record.evidence_status==='unknown'))throw new Error('historical tier must be 1|2|3|null with evidence');
    }
  }else if(scoring_version!==null)throw new Error('scoring_version requires an explicit scoring_bank');
  const dawn=adcDawnState(bundle,at,economy,values),weight_key=`fight_phase_weight_${phase}`;
  const coeffs=Object.fromEntries([weight_key,'fight_economy_scale','fight_level_scale'].map(k=>[k,values[k]]));
  const missing=[...Object.keys(coeffs).filter(k=>coeffs[k]===null),...dawn.missing],byHero=economy?.by_hero??{},parts=[];
  const lanes={clash:'Clash Lane',mid:'Mid',farm:'Farm',jungle:'Jungle',roam:'Roam'};
  for(const hero of roster){
    let source='caller_phase_tier',tier=hero.phase_tiers?.[phase]??null;
    if(hero.phase_tiers===null&&scoring_bank!==null){tier=scoring_bank.data.heroes?.[hero.hero_id]?.by_lane?.[lanes[hero.lane]]?.tier??null;source='historical_scoring_phase_neutral_prior';}
    const record=byHero[hero.hero_id]??{},inputs={tier,gold_delta:record.gold_delta??null,level_delta:record.level_delta??null};
    const absent=Object.keys(inputs).filter(k=>inputs[k]===null).map(k=>`heroes.${hero.hero_id}.${k}`);missing.push(...absent);
    const multiplier=hero.lane==='farm'?dawn.multiplier:1;
    let power=null,correction=null;
    if(!absent.length&&Object.values(coeffs).every(v=>v!==null)&&multiplier!==null){
      correction=1+coeffs.fight_economy_scale*Math.tanh(inputs.gold_delta/1000)+coeffs.fight_level_scale*Math.tanh(inputs.level_delta);
      power=tier*coeffs[weight_key]*correction*multiplier;finiteNumber(power,'hero fight power',0);
    }
    parts.push({hero_id:hero.hero_id,lane:hero.lane,...inputs,source,economy_level_multiplier:correction,dawn_multiplier:multiplier,power});
  }
  return {server:bundle.server,patch:bundle.patch,phase,at,status:missing.length?'unknown':'synthetic',power:missing.length?null:sum(parts.map(p=>p.power)),heroes:parts,adc_dawn:dawn,missing:unique(missing),label:bundle.label,calibrated:false,scoring_version,coefficients:coeffs,assumption:'历史评分仅作阶段中性先验；阶段强弱需显式 phase_tiers；逐英雄经济/等级差不由团队账本猜分'};
}
export function stormFightState(bundle,state,values){
  scopedInput(bundle,state);const data=state??{},owner=data.high_ground_lane_owner??null,pressure=data.backdoor_pressure??null;
  let bait=data.bait_state??null;bait=({'真开':'real','假开':'fake','停手':'stop'})[bait]??bait;
  if(![null,'blue','red','none'].includes(owner)||![null,'real','fake','stop'].includes(bait))throw new Error('invalid high_ground_lane_owner or bait_state');
  const inputs={high_ground_lane_owner:owner,backdoor_pressure:pressure,bait_state:bait,storm_max_defenders:values.storm_max_defenders};
  if(pressure!==null&&(finiteNumber(pressure,'backdoor_pressure')<0||pressure>1))throw new Error('backdoor_pressure must be in [0,1]');
  if(owner==='none'&&pressure!==null&&pressure!==0)throw new Error('no high-ground owner requires explicit zero backdoor pressure');
  for(const key of ['split_mobility','split_wave_clear','split_players','frontline_available']){
    const declared=data[key]===undefined?{}:data[key];
    if(!mapping(declared)||Object.keys(declared).some(t=>!teams.includes(t)))throw new Error(`${key} requires blue/red mapping`);
    for(const team of teams){
      const value=declared[team]??null;inputs[`${key}.${team}`]=value;
      if(value!==null){finiteNumber(value,key,0);const discrete=['split_players','frontline_available'].includes(key),limit=!discrete?1:key==='split_players'?2:5;if(value>limit||(discrete&&!Number.isInteger(value)))throw new Error(`${key} out of range or noninteger count`);}
    }
  }
  const missing=Object.keys(inputs).filter(k=>inputs[k]===null).sort(),compensation={},frontline={},defenders={};
  let effective=null,signed_pressure=null,high_ground=null;
  for(const team of teams){const split=inputs[`split_players.${team}`],available=inputs[`frontline_available.${team}`];if(split!==null&&available!==null&&split>available)throw new Error('split_players cannot exceed frontline_available');}
  if(!missing.length){
    for(const team of teams)compensation[team]=inputs[`split_players.${team}`]?Math.min(inputs[`split_mobility.${team}`],inputs[`split_wave_clear.${team}`]):0;
    const defender=owner==='blue'?'red':owner==='red'?'blue':null;
    effective=defender?pressure*(1-compensation[defender]):0;
    for(const team of teams){const forced=team===defender?Math.ceil(effective*inputs.storm_max_defenders):0;defenders[team]=Math.min(inputs[`frontline_available.${team}`],forced);frontline[team]=inputs[`frontline_available.${team}`]-Math.max(inputs[`split_players.${team}`],defenders[team]);}
    const sign=owner==='blue'?1:owner==='red'?-1:0;
    high_ground=defender?sign*(1-compensation[defender]):0;signed_pressure=sign*effective;
  }
  return {server:bundle.server,patch:bundle.patch,status:missing.length?'unknown':'synthetic',label:bundle.label,calibrated:false,high_ground_lane_owner:owner,backdoor_pressure:pressure,effective_backdoor_pressure:effective,split_compensation:missing.length?{blue:null,red:null}:compensation,frontline_counts:missing.length?{blue:null,red:null}:frontline,forced_defenders:missing.length?{blue:null,red:null}:defenders,high_ground_advantage:high_ground,backdoor_pressure_delta:signed_pressure,bait_state:bait,dragon_action:({real:'contest',fake:'counter_engage_window',stop:'hold_fire'})[bait]??null,missing,inputs,assumption:'单边边路高地；带线者可兼回防不重复扣人；正面战力按到场人数/5缩放，非逐英雄参团引擎'};
}
export function createCombat(bundle,request,roster,opponent,values){
  const economy=request.combat_economy??{};
  if(!mapping(economy)||Object.keys(economy).some(k=>!teams.includes(k)))throw new Error('combat_economy requires blue/red scoped mappings');
  for(const team of teams)validateCombatEconomy(bundle,economy[team]);
  const storm=stormFightState(bundle,request.storm,values);
  return at=>{
    const phase=bundle.phases.filter(p=>at>=p.start_s).at(-1).phase;
    const powers={blue:teamFightPower(bundle,phase,roster,economy.blue,values,{...request,at}),red:opponent===null?null:teamFightPower(bundle,phase,opponent,economy.red,values,{...request,at})};
    const absent=teams.flatMap(team=>powers[team]?.missing.map(k=>`${team}.${k}`)??[]);
    if(opponent===null)absent.push('opponent_heroes');
    const active=phase==='storm';if(active)absent.push(...storm.missing.map(k=>`storm.${k}`));
    const effective={};
    for(const team of teams){const count=active?storm.frontline_counts[team]:5,power=powers[team]?.power??null;effective[team]=power===null||count===null?null:power*count/5;}
    const delta=teams.some(t=>effective[t]===null)?null:effective.blue-effective.red;
    return {at,phase,teams:powers,effective_power:effective,fight_power_delta:delta,storm:active?storm:null,status:absent.length?'unknown':'synthetic',missing:unique(absent),label:bundle.label};
  };
}
