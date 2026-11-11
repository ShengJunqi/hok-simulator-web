// Match Python Fraction(float).limit_denominator(10**9), then its exact cubic.
// Kept separate from the existing simulator, whose parameter scope is unchanged.
export function rankContestProbability(x){
  if(typeof x!=='number'||!Number.isFinite(x)||x<-.5||x>.5)throw new Error('contest x outside [-0.5,0.5]');
  if(x===0)return .5;
  const sign=x<0?-1n:1n,buffer=new ArrayBuffer(8),view=new DataView(buffer);
  view.setFloat64(0,Math.abs(x));const bits=view.getBigUint64(0),exponent=Number((bits>>52n)&2047n);
  let n=bits&((1n<<52n)-1n),d=1n,power=exponent===0?-1074:exponent-1075;
  if(exponent)n|=1n<<52n;
  if(power>=0)n<<=BigInt(power);else d<<=BigInt(-power);
  while((n&1n)===0n&&d>1n){n>>=1n;d>>=1n;}
  const max=1000000000n;
  if(d>max){
    const originalN=n,originalD=d;let p0=0n,q0=1n,p1=1n,q1=0n;
    for(;;){const a=n/d,q2=q0+a*q1;if(q2>max)break;[p0,q0,p1,q1]=[p1,q1,p0+a*p1,q2];[n,d]=[d,n-a*d];}
    const k=(max-q0)/q1,b1n=p0+k*p1,b1d=q0+k*q1;
    const abs=v=>v<0n?-v:v;
    if(abs(p1*originalD-originalN*q1)*b1d<=abs(b1n*originalD-originalN*b1d)*q1){n=p1;d=q1;}else{n=b1n;d=b1d;}
  }
  n*=sign;
  return Number(210n*d**3n+311n*n*d**2n+100n*n**3n)/Number(420n*d**3n);
}
