import type {Bar} from './market';

const pct=(a:number,b:number)=>b?((a/b)-1)*100:0;
const avg=(x:number[])=>x.length?x.reduce((a,b)=>a+b,0)/x.length:0;
const sma=(bars:Bar[],n:number,i=bars.length-1)=> i+1<n?null:avg(bars.slice(i-n+1,i+1).map(b=>b.close));

export function priceReturns(bars:Bar[]){
  const i=bars.length-1,c=bars[i].close; const ret=(n:number)=>i-n>=0?pct(c,bars[i-n].close):0;
  return {r1:ret(1),r3:ret(3),r5:ret(5),r10:ret(10),r20:ret(20)};
}

export function volumeScore(bars:Bar[], idx=bars.length-1){
  if(idx<20)return {score:0,reasons:[] as string[],ratio:0};
  const cur=bars[idx], base=avg(bars.slice(idx-20,idx).map(b=>b.volume)); const ratio=base?cur.volume/base:0; let s=0; const reasons:string[]=[];
  if(ratio>=5)s+=15; else if(ratio>=3)s+=11; else if(ratio>=2)s+=7; else if(ratio>=1.5)s+=4;
  if(ratio>=1.5) reasons.push(`20일 평균 대비 거래량 ${ratio.toFixed(1)}배`);
  const dayPct=pct(cur.close,bars[idx-1].close);
  if(ratio>=2 && dayPct<3){s+=4; reasons.push(`가격 반응 ${dayPct.toFixed(1)}%로 제한된 상태에서 거래량 선행`);}
  if(ratio>=3 && dayPct>=-2 && dayPct<=2.5){s+=2; reasons.push('거래량은 급증했지만 가격은 아직 크게 반응하지 않음');}
  const recent=bars.slice(Math.max(20,idx-4),idx+1); const repeat=recent.filter((b,k)=>{
    const j=idx-recent.length+1+k; const a=avg(bars.slice(j-20,j).map(x=>x.volume)); return a>0&&b.volume/a>=1.5;
  }).length;
  if(repeat>=2){const add=Math.min(4,repeat-1);s+=add;reasons.push(`최근 5일 중 거래량 이상 ${repeat}회 반복`);}
  let obv=0; const obvs:number[]=[]; for(let i=Math.max(1,idx-20);i<=idx;i++){ obv += bars[i].close>bars[i-1].close?bars[i].volume:bars[i].close<bars[i-1].close?-bars[i].volume:0; obvs.push(obv); }
  if(obvs.length>=6 && obvs.at(-1)!>obvs.at(-6)!){s+=2;reasons.push('OBV 5거래일 상승');}
  return {score:Math.min(25,s),reasons,ratio};
}

function localMinima(vals:number[]){ const r:number[]=[]; for(let i=2;i<vals.length-2;i++) if(vals[i]<=vals[i-1]&&vals[i]<=vals[i+1]&&vals[i]<=vals[i-2]&&vals[i]<=vals[i+2]) r.push(i); return r; }
export function chartScore(bars:Bar[],idx=bars.length-1){
  let s=0; const reasons:string[]=[]; if(idx<65)return {score:0,reasons};
  const m5=sma(bars,5,idx)!,m5p=sma(bars,5,idx-3)!; if(m5>m5p){s+=3;reasons.push('5일 이동평균선 상승 전환/유지');}
  const m20=sma(bars,20,idx)!,m20p=sma(bars,20,idx-8)!; if(m20>m20p){s+=2;reasons.push('20일 이동평균선 상승');}
  const m60=sma(bars,60,idx)!; const gap=Math.abs(m20-m60)/m60*100; if(gap<=2.5){s+=3;reasons.push(`20일선·60일선 간격 ${gap.toFixed(1)}%`);}
  const p20=sma(bars,20,idx-5)!,p60=sma(bars,60,idx-5)!; const prevGap=(p60-p20)/p60*100; const nowGap=(m60-m20)/m60*100;
  if(m20<m60 && nowGap>0&&nowGap<3.5&&nowGap<prevGap){s+=2;reasons.push('20/60 골든크로스 접근');}
  const closes=bars.slice(idx-45,idx+1).map(b=>b.close); const mins=localMinima(closes); if(mins.length>=2){const a=closes[mins.at(-2)!],b=closes[mins.at(-1)!]; if(Math.abs(a-b)/Math.min(a,b)<0.04){s+=2;reasons.push('5일선/가격 W형 저점 후보');} else if(b>a){s+=1;reasons.push('최근 저점 상승');}}
  const high20=Math.max(...bars.slice(idx-20,idx).map(b=>b.high)); const dist=(high20-bars[idx].close)/high20*100; const av=avg(bars.slice(idx-20,idx).map(b=>b.volume));
  if(dist>=0&&dist<=2.5&&bars[idx].volume>av*1.2){s+=2;reasons.push(`20일 박스 상단까지 ${dist.toFixed(1)}%, 거래량 동반 접근`);}
  return {score:Math.min(15,s),reasons};
}

export function spikePenalty(bars:Bar[]){
  const r=priceReturns(bars); let p=0; const reasons:string[]=[];
  if(r.r1>=10){p-=35;reasons.push(`1일 +${r.r1.toFixed(1)}% 급등: 이미 반영 구간 강한 감점`);}
  else if(r.r1>=7){p-=25;reasons.push(`1일 +${r.r1.toFixed(1)}% 상승: 추격 방지 감점`);}
  else if(r.r1>=5){p-=15;reasons.push(`1일 +${r.r1.toFixed(1)}% 상승: 선행 후보 감점`);}
  else if(r.r1>=3){p-=6;reasons.push(`1일 +${r.r1.toFixed(1)}% 상승: 일부 가격 반영`);}

  if(r.r3>=15){p-=20;reasons.push(`3일 +${r.r3.toFixed(1)}% 급등: 단기 과열 감점`);}
  else if(r.r3>=10){p-=12;reasons.push(`3일 +${r.r3.toFixed(1)}% 상승 감점`);}
  else if(r.r3>=6){p-=5;reasons.push(`3일 +${r.r3.toFixed(1)}% 상승: 일부 반영`);}

  if(r.r5>=20){p-=15;reasons.push(`5일 +${r.r5.toFixed(1)}% 급등 감점`);}
  else if(r.r5>=12){p-=10;reasons.push(`5일 +${r.r5.toFixed(1)}% 상승 감점`);}
  else if(r.r5>=8){p-=5;reasons.push(`5일 +${r.r5.toFixed(1)}% 상승: 선행성 약화`);}

  if(r.r20>=30){p-=5;reasons.push(`20일 +${r.r20.toFixed(1)}% 상승 감점`);}

  if(r.r1>=-2.5&&r.r1<3&&r.r5>=-5&&r.r5<6){reasons.push(`가격 미반영 구간: 1일 ${r.r1.toFixed(1)}%, 5일 ${r.r5.toFixed(1)}%`);}
  return {penalty:Math.max(-60,p),reasons};
}

export function stage(score:number){return score>=85?'강한 전조':score>=70?'전조 집중':score>=50?'이상징후':score>=30?'관심':'관찰';}

export function currentPriceSignal(bars:Bar[]){
  const v=volumeScore(bars),c=chartScore(bars),pen=spikePenalty(bars),r=priceReturns(bars); const last=bars.at(-1)!;
  const preSpikeEligible=r.r1<5&&r.r3<10&&r.r5<12;
  return {currentPrice:last.close,changePct:r.r1,ret5:r.r5,volumeScore:v.score,chartScore:c.score,penalty:pen.penalty,reasons:[...v.reasons,...c.reasons,...pen.reasons],volumeRatio:v.ratio,preSpikeEligible};
}

export type SpikeThresholds={d1:number;d3:number;d5:number;d10:number};
export function backtestBars(bars:Bar[],t:SpikeThresholds){
  const events:any[]=[]; let cooldown=-1;
  for(let i=65;i<bars.length-10;i++){
    if(i<=cooldown)continue;
    const p0=bars[i-1].close; const r1=pct(bars[i].close,p0),r3=pct(bars[i+2].close,p0),r5=pct(bars[i+4].close,p0),r10=pct(bars[i+9].close,p0);
    if(r1>=t.d1||r3>=t.d3||r5>=t.d5||r10>=t.d10){
      const snap:any={date:bars[i].date,spikePct:Math.max(r1,r3,r5,r10)};
      for(const off of [60,30,20,10,5,3,1]){ const j=i-off; if(j>=65){const v=volumeScore(bars,j),c=chartScore(bars,j);snap[`d${off}`]={score:Math.round(((v.score+c.score)/40)*100),volume:v.score,chart:c.score};}}
      let volLead=false,chartLead=false; for(let j=Math.max(65,i-20);j<i;j++){if(volumeScore(bars,j).score>=8)volLead=true;if(chartScore(bars,j).score>=5)chartLead=true;}
      snap.leads={volume:volLead,chart:chartLead}; events.push(snap); cooldown=i+7;
    }
  }
  return events;
}

export function signalPerformance(bars:Bar[],t:SpikeThresholds){
  const init=()=>({tp:0,fp:0,fn:0,tn:0,signalCount:0,sumReturn:0,medianReturn:0,maxDrawdown:0,returns:[] as number[]});
  const v=init(),c=init();
  for(let i=65;i<bars.length-10;i++){
    const base=bars[i].close; const fut=bars.slice(i+1,i+11); if(fut.length<10)continue;
    const r1=pct(fut[0].close,base),r3=pct(fut[2].close,base),r5=pct(fut[4].close,base),r10=pct(fut[9].close,base);
    const event=r1>=t.d1||r3>=t.d3||r5>=t.d5||r10>=t.d10; const ret10=r10; const dd=(Math.min(...fut.map(x=>x.low))/base-1)*100;
    const sigs:[ReturnType<typeof init>,boolean][]=[[v,volumeScore(bars,i).score>=8],[c,chartScore(bars,i).score>=5]];
    for(const [o,signal] of sigs){if(signal){o.signalCount++;o.sumReturn+=ret10;o.returns.push(ret10);o.maxDrawdown=Math.min(o.maxDrawdown,dd);}if(signal&&event)o.tp++;else if(signal&&!event)o.fp++;else if(!signal&&event)o.fn++;else o.tn++;}
  }
  for(const o of [v,c]){o.returns.sort((a,b)=>a-b);if(o.returns.length)o.medianReturn=o.returns[Math.floor(o.returns.length/2)];}
  return {volume:v,chart:c};
}
