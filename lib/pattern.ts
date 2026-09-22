import type { Bar } from './market';

export type Settings = {
  searchDays: number;
  downtrendDays: number;
  near20Pct: number;
  minDeclinePct: number;
  minNegativeMa20Ratio: number;
  minDowntrendR2: number;
  requireStepDown: boolean;
  requireMa5Above20Now: boolean;
};

type Reg = { slopePctPerBar: number; r2: number };

function sma(values:number[], n:number){
  const out:(number|null)[]=Array(values.length).fill(null);
  let sum=0;
  for(let i=0;i<values.length;i++){
    sum+=values[i];
    if(i>=n)sum-=values[i-n];
    if(i>=n-1)out[i]=sum/n;
  }
  return out;
}

function regression(values:number[]):Reg{
  const n=values.length;
  if(n<3)return {slopePctPerBar:0,r2:0};
  let sx=0,sy=0,sxx=0,sxy=0;
  for(let i=0;i<n;i++){sx+=i;sy+=values[i];sxx+=i*i;sxy+=i*values[i]}
  const den=n*sxx-sx*sx;
  const slope=den===0?0:(n*sxy-sx*sy)/den;
  const intercept=(sy-slope*sx)/n;
  const mean=sy/n;
  let ssTot=0,ssRes=0;
  for(let i=0;i<n;i++){
    const y=values[i],pred=intercept+slope*i;
    ssTot+=(y-mean)*(y-mean);
    ssRes+=(y-pred)*(y-pred);
  }
  const base=Math.abs(values[0])||1;
  return {slopePctPerBar:slope/base*100,r2:ssTot===0?0:Math.max(0,Math.min(1,1-ssRes/ssTot))};
}

function avg(a:number[]){return a.length?a.reduce((s,v)=>s+v,0)/a.length:0}
function thirdStepDown(values:number[]){
  if(values.length<9)return false;
  const k=Math.floor(values.length/3);
  const a=avg(values.slice(0,k));
  const b=avg(values.slice(k,2*k));
  const c=avg(values.slice(2*k));
  return a>b && b>c;
}
function pct(a:number,b:number){return b?((a-b)/b)*100:0}
function clamp(v:number,min:number,max:number){return Math.min(max,Math.max(min,v))}

export function analyzeDaily(bars:Bar[], s:Settings){
  const closes=bars.map(x=>x.close).filter(Number.isFinite);
  if(closes.length<Math.max(30,s.downtrendDays+21))return {pass:false,score:0,reasons:['가격 이력 부족']};
  const ma5=sma(closes,5),ma20=sma(closes,20);
  const last=closes.length-1;
  const firstCandidate=Math.max(20,last-s.searchDays+1);
  const crosses:number[]=[];
  for(let i=firstCandidate;i<=last;i++){
    const p5=ma5[i-1],p20=ma20[i-1],c5=ma5[i],c20=ma20[i];
    if(p5!=null&&p20!=null&&c5!=null&&c20!=null&&p5<=p20&&c5>c20)crosses.push(i);
  }
  if(!crosses.length)return {pass:false,score:0,crossPass:false,reasons:[`최근 ${s.searchDays}거래일 내 5일선→20일선 골든크로스 없음`]};

  let chosen:any=null;
  for(const i of [...crosses].reverse()){
    const start=i-s.downtrendDays;
    if(start<20)continue;
    const pre=closes.slice(start,i);
    const reg=regression(pre);
    const declinePct=pct(pre[pre.length-1],pre[0]);
    let neg=0,total=0;
    for(let j=start+1;j<i;j++){
      if(ma20[j]!=null&&ma20[j-1]!=null){total++;if((ma20[j] as number)<(ma20[j-1] as number))neg++}
    }
    const negativeMa20Ratio=total?neg/total*100:0;
    const stepDown=thirdStepDown(pre);
    const downtrendPass=declinePct<=-s.minDeclinePct && reg.slopePctPerBar<0 && reg.r2>=s.minDowntrendR2 && negativeMa20Ratio>=s.minNegativeMa20Ratio && (!s.requireStepDown||stepDown);
    if(!downtrendPass)continue;
    chosen={i,start,reg,declinePct,negativeMa20Ratio,stepDown};
    break;
  }
  if(!chosen)return {pass:false,score:0,crossPass:true,downtrendPass:false,reasons:['골든크로스 이전 구간이 설정한 장기 우하향 조건에 미달']};

  const crossIndex=chosen.i as number;
  const close=closes[last],cur5=ma5[last] as number,cur20=ma20[last] as number;
  const dist20Pct=pct(close,cur20);
  const maSpreadPct=pct(cur5,cur20);
  const crossDaysAgo=last-crossIndex;
  const near20Pass=Math.abs(dist20Pct)<=s.near20Pct;
  const maStatePass=!s.requireMa5Above20Now || cur5>=cur20;
  const pass=near20Pass&&maStatePass;

  const proximityScore=30*clamp(1-Math.abs(dist20Pct)/Math.max(.1,s.near20Pct),0,1);
  const downScore=25*clamp(Math.abs(chosen.declinePct)/Math.max(5,s.minDeclinePct*2),0,1);
  const consistencyScore=15*clamp((chosen.negativeMa20Ratio-s.minNegativeMa20Ratio)/(100-s.minNegativeMa20Ratio+.001)+.45,0,1);
  const r2Score=10*clamp(chosen.reg.r2,0,1);
  const recencyScore=15*clamp(1-crossDaysAgo/Math.max(1,s.searchDays),0,1);
  const spreadScore=5*clamp(1-Math.abs(maSpreadPct)/8,0,1);
  const score=Math.round((proximityScore+downScore+consistencyScore+r2Score+recencyScore+spreadScore)*10)/10;

  const reasons=[
    `골든크로스 ${crossDaysAgo}거래일 전`,
    `직전 ${s.downtrendDays}일 하락률 ${chosen.declinePct.toFixed(1)}%`,
    `20일선 하락 지속도 ${chosen.negativeMa20Ratio.toFixed(0)}%`,
    `현재 종가-20일선 ${dist20Pct>=0?'+':''}${dist20Pct.toFixed(2)}%`,
    `현재 5일선-20일선 ${maSpreadPct>=0?'+':''}${maSpreadPct.toFixed(2)}%`
  ];
  if(chosen.stepDown)reasons.push('초·중·후반 평균가격이 계단식 하락');
  if(!near20Pass)reasons.push(`20일선 ±${s.near20Pct}% 범위 밖`);
  if(!maStatePass)reasons.push('현재 5일선이 다시 20일선 아래');

  return {
    pass,score,crossPass:true,downtrendPass:true,near20Pass,maStatePass,
    close,ma5:cur5,ma20:cur20,dist20Pct,maSpreadPct,crossDaysAgo,
    crossDate:bars[crossIndex]?.date,
    crossPrice:closes[crossIndex],
    downtrendStartDate:bars[chosen.start]?.date,
    declinePct:chosen.declinePct,
    downtrendSlopePct:chosen.reg.slopePctPerBar,
    downtrendR2:chosen.reg.r2,
    negativeMa20Ratio:chosen.negativeMa20Ratio,
    stepDown:chosen.stepDown,
    reasons
  };
}
