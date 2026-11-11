// Reproduce N4's CN/competitive/seed42 demonstration in the browser executor.
import {readFile,writeFile} from 'node:fs/promises';
import {simulateProcess,simulateBatch,validateRankBundle} from './rank-core.mjs';
const bundle=validateRankBundle(JSON.parse(await readFile(new URL('./data/rank-cn.json',import.meta.url),'utf8')),'cn');
const heroes=bundle.roles.map(lane=>({hero_id:`demo.${lane}`,lane,server:bundle.server,patch:bundle.patch,tags:[],phase_tiers:{early:2,mid:2,late:2,storm:2}}));
const scope={server:bundle.server,patch:bundle.patch};
const economy={...scope,by_hero:Object.fromEntries(heroes.map(h=>[h.hero_id,{gold_delta:0,level_delta:0}])),adc_dawn_ready:true,adc_dawn_timing:600};
const storm={...scope,high_ground_lane_owner:'blue',backdoor_pressure:1,bait_state:'real',frontline_available:{blue:5,red:5},split_players:{blue:0,red:0},split_mobility:{blue:0,red:0},split_wave_clear:{blue:0,red:0}};
const request={mode:'competitive',heroes,opponent_heroes:heroes,combat_economy:{blue:economy,red:{...economy,adc_dawn_ready:false,adc_dawn_timing:660}},storm,seed:42,horizon_s:1260};
const single=simulateProcess(bundle,request),batch=simulateBatch(bundle,{...request,runs:100});
const example={label:'合成演示 / 模型内 / 未校准',server:'cn',mode:'competitive',seed:42,horizon_s:single.horizon_s,
  events:single.events.length,ledger_entries:single.ledger.entries.length,economy_diff:single.economy_diff,
  counts:single.counts,turning_points:single.turning_points,probability_center:single.win_probability.probability,
  probability_distribution:single.win_probability.distribution,batch:{runs:batch.runs,...batch.distribution},
  combat:single.combat,logit_terms:single.win_probability.logit_terms,
  stage_endpoints:[240,600,660,1200,1260].map(at=>single.timeline.find(row=>row.at===at)),
  pending:'破晓价格、出装阈值、翻盘候选效果与所有模型系数待标定；英雄姓名不赋予能力加成。'};
await writeFile(new URL('../../handoff/N2_rank_example_20261110.json',import.meta.url),JSON.stringify(example,null,2)+'\n','utf8');
console.log(JSON.stringify({mode:example.mode,events:example.events,economy_diff:example.economy_diff,probability_center:example.probability_center,batch_mean:example.batch.mean},null,2));
