// View helpers accept projected values; they never infer missing model values.
const finite = value => typeof value === 'number' && Number.isFinite(value);
function svgElement(svg, tag, attrs = {}, text) {
  const node = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  svg.append(node);
  return node;
}

export function renderEconomyChart(svg, points) {
  svg.replaceChildren();
  // Keep the axis text readable at the panel's actual width, including tablet sidebars.
  const width=Math.max(280,Math.round(svg.clientWidth||680));
  svg.setAttribute('viewBox',`0 0 ${width} 245`);
  svgElement(svg, 'title', {}, '合成经济差过程：均值折线与 P10–P90 区间；缺参处断开，待标定。');
  const values = points.flatMap(p => [p.mean, p.low, p.high]).filter(finite);
  if (!values.length) {
    svgElement(svg, 'text', {x: width/2, y: 120, 'text-anchor': 'middle'}, '经济过程参数待标定');
    return;
  }
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values), padding = Math.max(50, (hi-lo)*.12);
  const min = lo-padding, max = hi+padding, end = Math.max(1, ...points.map(p => p.minutes));
  const left=58,right=width-18;
  const x = t => left + t/end*(right-left), y = v => 190-(v-min)/(max-min)*165;
  for (let i = 0; i <= 4; i++) {
    const value = min+(max-min)*i/4;
    svgElement(svg, 'line', {x1:left,y1:y(value),x2:right,y2:y(value),stroke:'#2c394a','stroke-width':1});
    svgElement(svg, 'text', {x:left-9,y:y(value)+4,'text-anchor':'end'}, Math.round(value).toLocaleString('zh-CN'));
  }
  svgElement(svg, 'line', {x1:left,y1:y(0),x2:right,y2:y(0),stroke:'#8294ab','stroke-dasharray':'4 4'});
  let prior = null;
  for (const p of points) {
    const px = x(p.minutes);
    if (finite(p.low) && finite(p.high)) {
      svgElement(svg,'line',{x1:px,y1:y(p.low),x2:px,y2:y(p.high),stroke:'#82b1e7','stroke-width':8,opacity:.25});
    }
    if (finite(p.mean)) {
      if (prior) svgElement(svg,'line',{x1:x(prior.minutes),y1:y(prior.mean),x2:px,y2:y(p.mean),stroke:'#e9c17c','stroke-width':2.5});
      const dot=svgElement(svg,'circle',{cx:px,cy:y(p.mean),r:4,fill:'#e9c17c'});
      const title=svg.ownerDocument.createElementNS(svg.namespaceURI,'title');
      title.textContent=`${p.label}：经济差均值 ${p.mean.toFixed(2)}，合成 / 未校准`;dot.append(title);
      prior=p;
    } else {
      if(p.label)svgElement(svg,'text',{x:px,y:207,'text-anchor':p===points.at(-1)?'end':'middle'},'待标定');
      prior=null;
    }
    if(p.label)svgElement(svg,'text',{x:px,y:228,'text-anchor':p===points.at(-1)?'end':'middle'},p.label);
  }
}

export function renderProbabilityHistogram(svg, samples) {
  svg.replaceChildren();
  const values=samples.filter(finite);
  svgElement(svg,'title',{},`模型内 / 未校准：${values.length} 个有效末段概率映射样本。`);
  if (!values.length) {svgElement(svg,'text',{x:160,y:78,'text-anchor':'middle'},'胜率映射待标定');return;}
  const bins=Array(10).fill(0);
  for (const value of values) bins[Math.min(9,Math.floor(value*10))]++;
  const peak=Math.max(...bins);
  bins.forEach((count,i)=>{
    const rect=svgElement(svg,'rect',{x:30+i*27,y:120-count/peak*100,width:22,height:count/peak*100,fill:'#82b1e7',rx:2});
    const title=svg.ownerDocument.createElementNS(svg.namespaceURI,'title');title.textContent=`${i*10}–${(i+1)*10}%：${count} 次`;rect.append(title);
    if(count)svgElement(svg,'text',{x:41+i*27,y:115-count/peak*100,'text-anchor':'middle'},String(count));
  });
  for (const [position,label] of [[30,'0%'],[165,'50%'],[300,'100%']]) svgElement(svg,'text',{x:position,y:143,'text-anchor':'middle'},label);
}
