// CPython Random integer seeding (MT19937), 53-bit random(), and gauss().
// This is used only by the rank port. Cross-language tests exercise exact draws.
export class PythonRandom {
  constructor(seed) {
    if (!Number.isSafeInteger(seed)) throw new Error('seed must be a safe integer');
    let value=BigInt(seed);if(value<0n)value=-value;
    const key=[];do{key.push(Number(value&0xffffffffn));value>>=32n;}while(value);
    this.mt=new Uint32Array(624);this.mt[0]=19650218;
    for(let i=1;i<624;i++)this.mt[i]=(Math.imul(1812433253,this.mt[i-1]^(this.mt[i-1]>>>30))+i)>>>0;
    let i=1,j=0;
    for(let k=Math.max(624,key.length);k>0;k--){
      this.mt[i]=((this.mt[i]^Math.imul(this.mt[i-1]^(this.mt[i-1]>>>30),1664525))+key[j]+j)>>>0;
      i++;j++;if(i>=624){this.mt[0]=this.mt[623];i=1;}if(j>=key.length)j=0;
    }
    for(let k=623;k>0;k--){
      this.mt[i]=((this.mt[i]^Math.imul(this.mt[i-1]^(this.mt[i-1]>>>30),1566083941))-i)>>>0;
      i++;if(i>=624){this.mt[0]=this.mt[623];i=1;}
    }
    this.mt[0]=0x80000000;this.index=624;this.gaussNext=null;
  }
  uint32(){
    if(this.index>=624){
      for(let i=0;i<624;i++){
        const y=(this.mt[i]&0x80000000)|(this.mt[(i+1)%624]&0x7fffffff);
        this.mt[i]=this.mt[(i+397)%624]^(y>>>1)^((y&1)?0x9908b0df:0);
      }
      this.index=0;
    }
    let y=this.mt[this.index++];y^=y>>>11;y^=(y<<7)&0x9d2c5680;y^=(y<<15)&0xefc60000;y^=y>>>18;
    return y>>>0;
  }
  random(){return ((this.uint32()>>>5)*67108864+(this.uint32()>>>6))/9007199254740992;}
  gauss(mu=0,sigma=1){
    let z=this.gaussNext;this.gaussNext=null;
    if(z===null){const angle=this.random()*(2*Math.PI),radius=Math.sqrt(-2*Math.log(1-this.random()));z=Math.cos(angle)*radius;this.gaussNext=Math.sin(angle)*radius;}
    return mu+z*sigma;
  }
  uniform(a,b){return a+(b-a)*this.random();}
}
