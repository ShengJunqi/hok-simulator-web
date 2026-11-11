import {validateRankBundle,simulateProcess,summarizeBatch} from './rank-core.mjs';
self.onmessage=({data})=>{
  try{
    const {bundle,request,job}=data;
    validateRankBundle(bundle,request.server);
    if(!Number.isInteger(request.runs)||request.runs<1||request.runs>1000)throw new Error('运行次数须为 1–1000 的整数');
    const results=[];
    for(let i=0;i<request.runs;i++){
      results.push(simulateProcess(bundle,{...request,seed:request.seed+i}));
      if((i+1)%10===0||i+1===request.runs)self.postMessage({type:'progress',job,done:i+1,total:request.runs});
    }
    self.postMessage({type:'complete',job,batch:summarizeBatch(results,request.seed)});
  }catch(error){self.postMessage({type:'error',job:data.job,message:error.message});}
};
