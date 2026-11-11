// Display-only projection. No map coordinates or model outcomes are generated here.
const roles = {clash:'对抗',mid:'中路',farm:'发育',jungle:'打野',roam:'游走'};
const teams = {blue:'蓝方',red:'红方'};
const nodeLabels = {river:'河灵',bird:'红隼',small:'小野',dragon:'龙目标',tower:'边路塔',mid:'中路',side:'边路',farm:'发育路'};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clock = value => `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(Math.floor(value % 60)).padStart(2,'0')}`;
const $ = id => document.getElementById(id);
const svg = (tag,attrs={},text='') => {
  const e = document.createElementNS('http://www.w3.org/2000/svg',tag);
  for (const [key,value] of Object.entries(attrs)) e.setAttribute(key,String(value));
  if (text) e.textContent=text;
  return e;
};

// Preserve the exact 0–100 node position in the asset's -5 -5 110 110 viewBox.
export function mapPoint(node) {
  return node && finite(node.x) && finite(node.y) && node.x>=0 && node.x<=100 && node.y>=0 && node.y<=100
    ? {x:node.x,y:node.y} : null;
}

export function minimapSnapshot(program,result,time,selectedId=null) {
  const nodes = program?.map?.nodes || [];
  const byId = new Map(nodes.map(n=>[n.node_id,n]));
  const actions = new Map((program?.events || []).map(e=>[e.id,e]));
  const resources = Object.entries(program?.resources || {});
  const at = finite(time) ? Math.max(0,time) : 0;
  const events = (result?.events || []).filter(e=>finite(e.at) && e.at<=at).slice().sort((a,b)=>a.at-b.at);
  const entries = (result?.ledger?.entries || []).filter(e=>finite(e.at) && e.at<=at).slice().sort((a,b)=>a.at-b.at);
  const settled = new Map(entries.map(e=>[e.resource_id,e]));
  const selected = events.find(e=>e.event_id===selectedId);
  const selectedTarget = selected?.details?.target ?? actions.get(selected?.action_id)?.target;
  const selectedNode = program?.resources?.[selectedTarget]?.node;
  const points = nodes.filter(mapPoint).map(node=>{
    const items = resources.filter(([,r])=>r.node===node.node_id);
    const counts = {blue:0,red:0,pending:0,upcoming:0,unknown:0};
    for (const [id,r] of items) {
      const entry = settled.get(id);
      const owner = entry?.postings?.find(p=>p.account==='blue'||p.account==='red')?.account;
      if (owner) counts[owner]++;
      else if (!finite(r.spawn_at)) counts.unknown++;
      else if (r.spawn_at>at) counts.upcoming++;
      else counts.pending++;
    }
    const owner = counts.blue && counts.red ? 'mixed' : counts.blue ? 'blue' : counts.red ? 'red' : 'neutral';
    const state = counts.pending ? 'pending' : counts.unknown ? 'unknown' : counts.upcoming ? 'upcoming' : items.length ? 'settled' : 'landmark';
    return {node,point:mapPoint(node),counts,owner,state,selected:node.node_id===selectedNode,synthetic:/合成/.test(node.source || '')};
  });
  const heroes = [];
  for (const [team,composition] of Object.entries(program?.compositions || {})) {
    for (const player of composition.roster || []) {
      const history = events.filter(e=>e.team===team && e.actor===player.player_id && ['action_started','action_finished'].includes(e.kind));
      const last = history.at(-1);
      const hero = {team,player:player.player_id,hero:player.hero_id,state:'unknown',node:null,at:null,reason:'位置待标定：没有已发生的行动位置记录'};
      if (last) {
        const action = actions.get(last.action_id);
        const targetNode = program?.resources?.[action?.target]?.node;
        if (action?.kind==='harvest' && byId.has(targetNode)) {
          if (last.kind==='action_finished') {
            hero.node=targetNode;hero.at=last.at;hero.state='last-known';hero.reason='最近完成的行动节点';
          } else {
            const travel = last.details?.travel;
            const finish = last.details?.finish_s;
            if (finite(travel?.seconds) && travel.seconds>=0) {
              const arrival = last.at + travel.seconds;
              if (at>=arrival) {
                hero.node=targetNode;hero.at=arrival;
                hero.state=finite(finish) && at>finish ? 'last-known' : 'acting';
                hero.reason=hero.state==='acting' ? '模型行动节点（依事件耗时）' : '最近行动节点（后续位置待标定）';
              } else if (at===last.at && byId.has(travel.segments?.[0]?.from)) {
                hero.node=travel.segments[0].from;hero.at=last.at;hero.state='departing';hero.reason='模型路径起点';
              } else {
                hero.state='travelling';hero.reason='赶路中，精确位置待标定；不插值坐标';
              }
            }
          }
        }
      }
      hero.point=mapPoint(byId.get(hero.node));
      if (hero.node && !hero.point) {hero.node=null;hero.state='unknown';hero.reason='节点坐标待标定';}
      heroes.push(hero);
    }
  }
  return {at,points,heroes,invalidNodes:nodes.filter(n=>!mapPoint(n)).length};
}

export function clearMinimap() {
  if (!$('minimap')) return;
  $('minimap').replaceChildren();
  delete $('minimap').dataset.time;
  $('minimapRoster').replaceChildren();
  $('minimapClock').textContent='—';
  $('minimapScope').textContent='等待参数库';
  $('minimapStatus').textContent='参数库加载后显示地标；运行后联动事件时间轴。';
  $('minimapSlider').disabled=true;$('minimapEnd').disabled=true;
}

export function renderMinimap(program,result,time,selectedId=null) {
  if (!$('minimap') || !program) return;
  const root=$('minimap'),snapshot=minimapSnapshot(program,result,time,selectedId);
  root.replaceChildren(svg('image',{href:'./assets/map/map_editable.svg',x:-5,y:-5,width:110,height:110,'aria-hidden':'true'}));
  root.dataset.time=String(snapshot.at);
  const resourceLayer=svg('g',{'data-layer':'resources'});
  for (const {node,point,counts,owner,state,selected,synthetic} of snapshot.points) {
    const label=`${nodeLabels[node.node_id] || node.name}；${node.source || '坐标来源待标定'}；${state==='landmark'?'地标（当前场景无资源实例）；':''}蓝方已结算 ${counts.blue}，红方已结算 ${counts.red}，未结算 ${counts.pending}，未刷新 ${counts.upcoming}，刷新待标定 ${counts.unknown}`;
    const g=svg('g',{class:'minimap-node',transform:`translate(${point.x} ${point.y})`,'data-node-id':node.node_id,'data-state':state,'data-owner':owner,'data-synthetic':synthetic,tabindex:0,role:'img','aria-label':label});
    g.append(svg('title',{},label));
    if(synthetic)g.append(svg('circle',{r:4.2,class:'minimap-synthetic'}));
    g.append(state==='landmark'?svg('circle',{r:1.5,class:'minimap-resource'}):svg('path',{d:'M0 -2.2 2.2 0 0 2.2 -2.2 0Z',class:'minimap-resource'}));
    if(selected)g.append(svg('circle',{r:5.7,class:'minimap-selected'}));
    resourceLayer.append(g);
  }
  root.append(resourceLayer);
  // Same-node heroes share one centered marker; no visual jitter masquerading as coordinates.
  const groups=new Map();
  for(const hero of snapshot.heroes.filter(h=>h.point)) {
    if(!groups.has(hero.node))groups.set(hero.node,[]);
    groups.get(hero.node).push(hero);
  }
  const heroLayer=svg('g',{'data-layer':'heroes'});
  for(const [node,group] of groups) {
    const h=group[0],team=group.every(p=>p.team===h.team)?h.team:'mixed';
    const label=group.map(p=>`${teams[p.team] || p.team}${roles[p.player] || p.player}（${p.hero}）：${p.reason}，${clock(p.at)}`).join('；');
    const g=svg('g',{class:'minimap-hero',transform:`translate(${h.point.x} ${h.point.y})`,'data-node-id':node,'data-team':team,'data-count':group.length,'data-state':group.every(p=>p.state==='last-known')?'last-known':h.state,tabindex:0,role:'img','aria-label':label});
    g.append(svg('title',{},label),svg('circle',{r:3.8,class:'minimap-portrait'}),svg('text',{},group.length>1?String(group.length):(roles[h.player] || h.player).slice(0,1)));
    heroLayer.append(g);
  }
  root.append(heroLayer);
  const roster=$('minimapRoster');roster.replaceChildren();
  for(const h of snapshot.heroes){
    const li=document.createElement('li');li.dataset.team=h.team;li.dataset.player=h.player;li.dataset.state=h.state;
    li.textContent=`${teams[h.team] || h.team}·${roles[h.player] || h.player}：${h.reason}${h.node?` · ${nodeLabels[h.node] || h.node} ${clock(h.at)}`:''}`;
    roster.append(li);
  }
  $('minimapClock').textContent=clock(snapshot.at);
  $('minimapScope').textContent=`${program.config.server.toUpperCase()} · ${program.config.patch} · ${result?'首个 seed '+result.seed:'地标预览'}`;
  const known=snapshot.heroes.filter(h=>h.point).length;
  $('minimapStatus').textContent=result?`行动节点 ${known}/${snapshot.heroes.length} 人；其余位置待标定。虚线英雄圈为最近记录，多人同点显示人数。`:'运行后显示英雄行动节点；未运行不预设英雄站位。';
  if(snapshot.invalidNodes)$('minimapStatus').textContent+=` ${snapshot.invalidNodes} 个无效坐标未绘制。`;
  const slider=$('minimapSlider');slider.max=$('timeSlider').max;slider.step=$('timeSlider').step;slider.value=snapshot.at;slider.disabled=!result;
  slider.setAttribute('aria-valuetext',clock(snapshot.at));
  $('minimapEnd').disabled=!result;
}

export function initMinimap() {
  if (!$('minimap')) return;
  $('minimapSlider').addEventListener('input',()=>{
    const slider=$('timeSlider');slider.value=$('minimapSlider').value;
    slider.dispatchEvent(new window.Event('input',{bubbles:true}));
  });
  $('minimapEnd').addEventListener('click',()=>$('resetTime').click());
}
