// Browser port of N4 simulator/winprob2.py; parameters are exported from Python.
import {PythonRandom} from './rank-random.mjs';
export const finiteNumber=(value,name,min=null)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||(min!==null&&value<min))throw new Error(`${name}: invalid finite number`);
  return value;
};
export function sum(values){
  // Compensated summation for the fsum-derived summaries in the Python core.
  let total=0,correction=0;
  for(const value of values){const next=total+value;correction+=Math.abs(total)>=Math.abs(value)?(total-next)+value:(value-next)+total;total=next;}
  return total+correction;
}
export function quantile(values,q){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),i=(sorted.length-1)*q,lo=Math.floor(i),hi=Math.min(lo+1,sorted.length-1);
  return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo);
}
export function summarizeDistribution(samples){
  const values=[...samples].sort((a,b)=>a-b);
  for(const v of values)if(finiteNumber(v,'probability',0)>1)throw new Error('probability must be <= 1');
  if(!values.length)return {n:0,mean:null,std:null,p05:null,p50:null,p95:null};
  const mean=sum(values)/values.length;
  return {n:values.length,mean,std:Math.sqrt(sum(values.map(v=>(v-mean)**2))/values.length),p05:quantile(values,.05),p50:quantile(values,.5),p95:quantile(values,.95)};
}
const sigmoid=z=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));
export function winProbability(economy_diff,time_s,mode,{server,patch,seed=0,samples=128,profile,coefficients,fight_power_delta=null,high_ground_advantage=null,backdoor_pressure_delta=null}){
  if(!Number.isSafeInteger(seed)||!Number.isInteger(samples)||samples<1||samples>10000)throw new Error('integer seed and samples in [1,10000] required');
  if(profile.server!==server||profile.patch!==patch||coefficients.server!==server||coefficients.patch!==patch)throw new Error('禁止跨服/跨补丁');
  if(profile.mode!==mode)throw new Error('profile mode mismatch');
  if(time_s!==null)finiteNumber(time_s,'time_s',0);
  for(const [key,value] of Object.entries({high_ground_advantage,backdoor_pressure_delta}))if(value!==null&&Math.abs(finiteNumber(value,key))>1)throw new Error(`${key} must be in [-1,1]`);
  const storm_active=time_s===null||time_s>=1200;
  const inputs={economy_diff,time_s,mode_volatility:profile.volatility,fight_power_delta,
    high_ground_advantage:storm_active?high_ground_advantage:0,backdoor_pressure_delta:storm_active?backdoor_pressure_delta:0,
    economy_per_1000:coefficients.economy_per_1000,time_interaction_per_min:coefficients.time_interaction_per_min,volatility_scale:coefficients.volatility_scale,
    fight_power_scale:coefficients.fight_power_scale,storm_high_ground_scale:storm_active?coefficients.storm_high_ground_scale:0,storm_backdoor_scale:storm_active?coefficients.storm_backdoor_scale:0};
  for(const [key,value] of Object.entries(inputs))if(value!==null)finiteNumber(value,key,['economy_diff','fight_power_delta','high_ground_advantage','backdoor_pressure_delta'].includes(key)?null:0);
  const missing=Object.keys(inputs).filter(k=>inputs[k]===null).sort();
  const result={server,patch,mode,label:profile.label,calibrated:false,calibration_status:'未校准',metric:'模型内 P(win) 映射',status:missing.length?'unknown':'synthetic',inputs,coefficients:structuredClone(coefficients),seed,samples:[],probability:null,distribution:summarizeDistribution([]),missing,
    synthetic:true,game_patch:null,model_patch:patch,logit_terms:null,storm_active,
    uncertainty:{kind:'synthetic_logit_noise',interval:[.05,.95],label:'合成演示区间；不是实测置信区间',calibration_error:null,parameter_uncertainty:null,empirical_sample_size:null},
    warning:'合成演示/待标定；未校准；不代表真实胜率'};
  if(missing.length)return result;
  const logit_terms={economy:economy_diff/1000*coefficients.economy_per_1000*(1+time_s/60*coefficients.time_interaction_per_min),fight_power:fight_power_delta*coefficients.fight_power_scale,storm_high_ground:inputs.high_ground_advantage*inputs.storm_high_ground_scale,storm_backdoor:inputs.backdoor_pressure_delta*inputs.storm_backdoor_scale};
  const z=sum(Object.values(logit_terms)),sigma=profile.volatility*coefficients.volatility_scale;
  finiteNumber(z,'computed logit');finiteNumber(sigma,'computed volatility',0);
  const rng=new PythonRandom(seed),draws=Array.from({length:samples},()=>sigmoid(z+rng.gauss(0,sigma)));
  return {...result,probability:sigmoid(z),samples:draws,distribution:summarizeDistribution(draws),logit_terms};
}
