// N1 Ledger uses Decimal(str(value)). Keep decimal totals so equal farming
// cancels exactly and cannot fabricate a lead_reversal from floating drift.
class DecimalTotal {
  constructor(){this.coefficient=0n;this.exponent=0;}
  add(value){
    let [digits,exponent='0']=String(value).toLowerCase().split('e');
    let e=Number(exponent),dot=digits.indexOf('.');
    if(dot>=0){e-=digits.length-dot-1;digits=digits.replace('.','');}
    const c=BigInt(digits),common=Math.min(this.exponent,e);
    this.coefficient=this.coefficient*10n**BigInt(this.exponent-common)+c*10n**BigInt(e-common);this.exponent=common;
  }
  number(){return Number(`${this.coefficient}e${this.exponent}`);}
}
export class RankLedger {
  constructor(server,patch){this.server=server;this.patch=patch;this.entries=[];this.accounts=new Map([['blue',new DecimalTotal()],['red',new DecimalTotal()]]);this.difference=new DecimalTotal();}
  settle(event_id,resource_id,at,category,metric,team,reward){
    const postings=[{account:`environment:${category}`,amount:-reward},{account:team,amount:reward}];
    this.entries.push({event_id,resource_id,at,category,metric,postings});
    for(const posting of postings){if(!this.accounts.has(posting.account))this.accounts.set(posting.account,new DecimalTotal());this.accounts.get(posting.account).add(posting.amount);}
    this.difference.add(team==='blue'?reward:-reward);
  }
  get netDiff(){return this.difference.number();}
  toDict(){return {server:this.server,patch:this.patch,unit:'gold',balances:Object.fromEntries([...this.accounts].sort(([a],[b])=>a.localeCompare(b)).map(([a,v])=>[a,v.number()])),net_diff:this.netDiff,entries:this.entries,opportunity_costs:[]};}
}
