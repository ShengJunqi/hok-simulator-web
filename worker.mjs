import {runProgram, summarizeBatch} from './sim-core.mjs';

self.onmessage = async ({data}) => {
  const {jobId, programs, runs, seed} = data;
  try {
    if (!Number.isInteger(runs) || runs < 1 || runs > 10000 || !Number.isInteger(seed) || seed < 0 || seed > 2147483647-runs+1) throw new Error('次数或seed超出范围');
    const variants = [], total = runs * programs.length;
    for (let index=0; index<programs.length; index++) {
      const {name, program} = programs[index], samples = []; let first;
      for (let i=0; i<runs; i++) {
        const result = runProgram(program, seed+i); if (!first) first=result;
        samples.push({seed:seed+i, economy_diff:result.economy_diff, tower_diff:result.tower_diff});
        if (i % 10 === 0 || i === runs-1) {
          self.postMessage({type:'progress', jobId, done:index*runs+i+1, total});
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      variants.push({name, ...summarizeBatch(program, samples, first, seed)});
    }
    self.postMessage({type:'complete', jobId, variants});
  } catch (error) { self.postMessage({type:'error', jobId, message:error.message}); }
};
