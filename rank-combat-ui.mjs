import {validateRoster} from './rank-core.mjs';
import {validateCombatEconomy,stormFightState} from './rank-combat.mjs';
const roles={clash:'对抗路',mid:'中路',farm:'发育路',jungle:'打野',roam:'游走'};
const phases={early:'0–4',mid:'4–10',late:'10–20',storm:'20+'};
const names={blue:'蓝方',red:'红方'};
export function initCombatInputs(root,bundle,onChange){
  const doc=root.ownerDocument,$=id=>root.querySelector(`#${id}`),fields=$('rankCombatFields');fields.replaceChildren();
  const el=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  function select(id,title,options){const node=el('select');node.id=id;node.setAttribute('aria-label',title);for(const [value,text] of [['','待标定'],...options]){const option=el('option',text);option.value=value;node.append(option);}return node;}
  function input(id,title,{min,step='any',max,type='number'}={}){const node=el('input');node.id=id;node.type=type;node.setAttribute('aria-label',title);node.placeholder='待标定';if(type==='number'){node.step=step;if(min!==undefined)node.min=min;if(max!==undefined)node.max=max;}return node;}
  function field(title,control){const label=el('label',title);label.append(control);return label;}
  for(const team of ['blue','red']){
    const heading=el('h4',`${names[team]}阶段评分与基准差`);fields.append(heading);
    const wrap=el('div');wrap.className='rank-table-wrap';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',`${names[team]}阶段评分与基准差，可横向滚动`);const table=el('table');table.className='rank-table rank-combat-table';
    const caption=el('caption','左右滑动填写各阶段与基准差；空白保持待标定。');table.append(caption);
    const head=el('thead'),tr=el('tr');for(const label of ['分路 / 英雄',...Object.values(phases),'经济差','等级差'])tr.append(el('th',label));head.append(tr);table.append(head);
    const body=el('tbody');
    for(const lane of bundle.roles){const row=el('tr'),identity=el('td',roles[lane]);if(team==='red')identity.append(input(`rankEnemy-${lane}`,`红方${roles[lane]}英雄`,{type:'text'}));row.append(identity);
      for(const phase of Object.keys(phases)){const td=el('td');td.append(select(`rankCombat-${team}-${lane}-${phase}`,`${names[team]}${roles[lane]}${phases[phase]}分钟评分`,[['1','1'],['2','2'],['3','3']]));row.append(td);}
      for(const key of ['gold_delta','level_delta']){const td=el('td');td.append(input(`rankCombat-${team}-${lane}-${key}`,`${names[team]}${roles[lane]}${key==='gold_delta'?'经济':'等级'}基准差`));row.append(td);}body.append(row);
    }table.append(body);wrap.append(table);fields.append(wrap);
    const dawn=el('div');dawn.className='field-pair';dawn.append(field(`${names[team]}10分钟破晓`,select(`rankDawnReady-${team}`,`${names[team]}10分钟破晓`,[['true','已成型'],['false','未成型']])),field(`${names[team]}成型时间（秒）`,input(`rankDawnTime-${team}`,`${names[team]}破晓成型秒`,{min:0})));fields.append(dawn);
  }
  fields.append(el('h4','20分钟后：高地 / 带线 / 诱饵'));
  const general=el('div');general.className='rank-storm-fields';
  general.append(field('单边高地优势方',select('rankHighGround','单边高地优势方',[['none','双方无优势'],['blue','蓝方'],['red','红方']])),field('偷家压力（0–1）',input('rankBackdoor','偷家压力',{min:0,max:1,step:.1})),field('龙团行动',select('rankBait','龙团行动',[['real','真开'],['fake','假开 / 诱饵'],['stop','停手']])));fields.append(general);
  const stormLabels={frontline_available:'扣人前可用人数',split_players:'带线人数',split_mobility:'带线移速能力',split_wave_clear:'带线清线能力'};
  for(const team of ['blue','red']){fields.append(el('h4',`${names[team]}风暴输入`));const group=el('div');group.className='rank-storm-fields';for(const [key,label] of Object.entries(stormLabels)){const count=key==='frontline_available'||key==='split_players';group.append(field(label,input(`rankStorm-${team}-${key}`,`${names[team]}${label}`,{min:0,max:key==='frontline_available'?5:key==='split_players'?2:1,step:count?1:.1})));}fields.append(group);}
  const presets=[['neutral','破晓延迟示例'],['high_ground','单边高地示例'],['strong_split','带线补偿示例'],['fake','假开示例'],['stop','停手示例']];
  $('rankScenarioButtons').replaceChildren(...presets.map(([id,label])=>{const button=el('button',label);button.type='button';button.dataset.scenario=id;button.onclick=()=>preset(id);return button;}));
  fields.append(el('p','示例会显式填写双方全部阶段2档、经济/等级差0、蓝方600秒破晓、红方660秒破晓；所有数值均为合成假设。'));
  function preset(id){
    for(const team of ['blue','red'])for(const lane of bundle.roles){
      const identity=$(team==='blue'?`rankHero-${lane}`:`rankEnemy-${lane}`);if(!identity.value)identity.value=`示例${names[team]}.${roles[lane]}`;
      for(const phase of Object.keys(phases))$(`rankCombat-${team}-${lane}-${phase}`).value='2';
      for(const key of ['gold_delta','level_delta'])$(`rankCombat-${team}-${lane}-${key}`).value='0';
    }
    for(const team of ['blue','red']){$(`rankDawnReady-${team}`).value=team==='blue'?'true':'false';$(`rankDawnTime-${team}`).value=team==='blue'?'600':'660';
      for(const key of Object.keys(stormLabels))$(`rankStorm-${team}-${key}`).value=key==='frontline_available'?'5':id==='strong_split'&&team==='red'?'1':'0';}
    $('rankHighGround').value=id==='neutral'?'none':'blue';$('rankBackdoor').value=id==='neutral'?'0':'1';$('rankBait').value=['fake','stop'].includes(id)?id:'real';$('rankCombatInputs').open=true;onChange();
  }
  const numeric=id=>{const node=$(id);if(node.validity?.badInput)throw new Error(`${node.getAttribute('aria-label')}需要有效数值`);return node.value===''?null:node.valueAsNumber;};
  function read(heroes){
    const scope={server:bundle.server,patch:bundle.patch},byTeam={blue:heroes,red:bundle.roles.map(lane=>({hero_id:$(`rankEnemy-${lane}`).value.trim(),lane,...scope,tags:null}))};
    if(byTeam.red.every(h=>!h.hero_id))byTeam.red=null;
    else if(byTeam.red.some(h=>!h.hero_id))throw new Error('对手阵容需填写完整五路；全部留空表示未知');
    const combat_economy={};
    for(const team of ['blue','red']){
      if(byTeam[team]){byTeam[team]=byTeam[team].map(hero=>({...hero,phase_tiers:Object.fromEntries(Object.keys(phases).map(phase=>[phase,$(`rankCombat-${team}-${hero.lane}-${phase}`).value===''?null:Number($(`rankCombat-${team}-${hero.lane}-${phase}`).value)]))}));validateRoster(bundle,byTeam[team]);}
      const ready=$(`rankDawnReady-${team}`).value;
      combat_economy[team]={...scope,by_hero:Object.fromEntries((byTeam[team]??[]).map(h=>[h.hero_id,{gold_delta:numeric(`rankCombat-${team}-${h.lane}-gold_delta`),level_delta:numeric(`rankCombat-${team}-${h.lane}-level_delta`)}])),adc_dawn_ready:ready===''?null:ready==='true',adc_dawn_timing:numeric(`rankDawnTime-${team}`)};
      validateCombatEconomy(bundle,combat_economy[team]);
    }
    const storm={...scope,high_ground_lane_owner:$('rankHighGround').value||null,backdoor_pressure:numeric('rankBackdoor'),bait_state:$('rankBait').value||null};
    for(const key of Object.keys(stormLabels))storm[key]=Object.fromEntries(['blue','red'].map(team=>[team,numeric(`rankStorm-${team}-${key}`)]));
    stormFightState(bundle,storm,Object.fromEntries(Object.keys(bundle.parameter_units).map(k=>[k,bundle.parameters.values[k]?.metric?.value??null])));
    return {heroes:byTeam.blue,opponent_heroes:byTeam.red,combat_economy,storm};
  }
  $('rankClearCombat').onclick=()=>{for(const input of fields.querySelectorAll('input,select'))input.value='';onChange();};
  return {read,preset};
}
