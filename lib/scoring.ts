import type { Bar } from './market';

const pct=(a:number,b:number)=>b?((a/b)-1)*100:0;
const avg=(x:number[])=>x.length?x.reduce((a,b)=>a+b,0)/x.length:0;
const sma=(bars:Bar[],n:number,i=bars.length-1)=>i+1<n?null:avg(bars.slice(i-n+1,i+1).map(b=>b.close));

function priceReturns(bars:Bar[]){
  const i=bars.length-1,c=bars[i]?.close||0;
  const ret=(n:number)=>i-n>=0?pct(c,bars[i-n].close):0;
  return {r1:ret(1),r3:ret(3),r5:ret(5),r10:ret(10),r20:ret(20)};
}

function rollingVolumeRatio(bars:Bar[],idx:number){
  if(idx<20) return 0;
  const base=avg(bars.slice(idx-20,idx).map(b=>b.volume));
  return base?bars[idx].volume/base:0;
}

export function absorptionScore(bars:Bar[],idx=bars.length-1){
  if(idx<25)return {score:0,reasons:[] as string[],volumeRatio:0};
  const cur=bars[idx],prev=bars[idx-1];
  const ratio=rollingVolumeRatio(bars,idx);
  const day=pct(cur.close,prev.close);
  const range=Math.max(cur.high-cur.low,1e-9);
  const closePos=(cur.close-cur.low)/range;
  let s=0; const reasons:string[]=[];

  if(ratio>=3){s+=13;reasons.push(`20일 평균 대비 거래량 ${ratio.toFixed(1)}배`);}
  else if(ratio>=2){s+=10;reasons.push(`20일 평균 대비 거래량 ${ratio.toFixed(1)}배`);}
  else if(ratio>=1.5){s+=7;reasons.push(`20일 평균 대비 거래량 ${ratio.toFixed(1)}배`);}
  else if(ratio>=1.2){s+=4;reasons.push(`20일 평균 대비 거래량 ${ratio.toFixed(1)}배`);}

  if(ratio>=1.5 && day>-2 && day<4){s+=6;reasons.push(`거래량 증가에도 당일 등락 ${day.toFixed(1)}%로 제한`);}
  if(ratio>=1.3 && closePos>=0.7){s+=4;reasons.push('거래량 동반 후 종가가 당일 고가권에서 마감');}

  let absorbDays=0;
  for(let j=Math.max(20,idx-4);j<=idx;j++){
    const vr=rollingVolumeRatio(bars,j);
    const d=j>0?pct(bars[j].close,bars[j-1].close):0;
    const rg=Math.max(bars[j].high-bars[j].low,1e-9);
    const cp=(bars[j].close-bars[j].low)/rg;
    if(vr>=1.3 && d>-3 && d<5 && cp>=0.55) absorbDays++;
  }
  if(absorbDays>=2){const add=Math.min(4,absorbDays);s+=add;reasons.push(`최근 5일 중 물량흡수형 거래 ${absorbDays}회`);}

  const recentRange=avg(bars.slice(idx-4,idx+1).map(b=>(b.high-b.low)/Math.max(b.close,1)));
  const prevRange=avg(bars.slice(idx-20,idx-5).map(b=>(b.high-b.low)/Math.max(b.close,1)));
  const recentVol=avg(bars.slice(idx-4,idx+1).map(b=>b.volume));
  const prevVol=avg(bars.slice(idx-20,idx-5).map(b=>b.volume));
  if(prevRange>0&&prevVol>0&&recentRange<prevRange*0.92&&recentVol>prevVol*1.2){s+=3;reasons.push('가격 변동폭은 줄고 거래량은 늘어나는 압축 매집 패턴');}

  return {score:Math.min(30,s),reasons,volumeRatio:ratio};
}

function localMinima(vals:number[]){
  const r:number[]=[];
  for(let i=2;i<vals.length-2;i++) if(vals[i]<=vals[i-1]&&vals[i]<=vals[i+1]&&vals[i]<=vals[i-2]&&vals[i]<=vals[i+2]) r.push(i);
  return r;
}

export function trendScore(bars:Bar[],idx=bars.length-1){
  if(idx<65)return {score:0,reasons:[] as string[]};
  let s=0; const reasons:string[]=[];
  const m5=sma(bars,5,idx)!,m5p=sma(bars,5,idx-3)!;
  const m20=sma(bars,20,idx)!,m20p=sma(bars,20,idx-8)!;
  const m60=sma(bars,60,idx)!;
  if(m5>m5p){s+=4;reasons.push('5일 이동평균선 우상향');}
  if(m20>m20p){s+=5;reasons.push('20일 이동평균선 상승 전환/유지');}

  const oldLow=Math.min(...bars.slice(idx-30,idx-15).map(b=>b.low));
  const newLow=Math.min(...bars.slice(idx-14,idx+1).map(b=>b.low));
  if(newLow>oldLow*1.01){s+=5;reasons.push('최근 저점이 이전 저점보다 높아짐');}

  const gap=Math.abs(m20-m60)/m60*100;
  if(gap<=3){s+=4;reasons.push(`20일선·60일선 간격 ${gap.toFixed(1)}%`);}
  if(bars[idx].close>=m20){s+=3;reasons.push('종가가 20일선 위에서 유지');}

  const closes=bars.slice(idx-45,idx+1).map(b=>b.close);
  const mins=localMinima(closes);
  if(mins.length>=2){
    const a=closes[mins.at(-2)!],b=closes[mins.at(-1)!];
    if(Math.abs(a-b)/Math.max(Math.min(a,b),1)<0.045){s+=4;reasons.push('W형 저점/쌍바닥 후보');}
    else if(b>a){s+=3;reasons.push('최근 두 저점이 상승');}
  }
  return {score:Math.min(25,s),reasons};
}

export function stealthScore(bars:Bar[],idx=bars.length-1){
  if(idx<25)return {score:0,reasons:[] as string[]};
  let s=0; const reasons:string[]=[];
  let obv=0; const obvs:number[]=[];
  for(let i=Math.max(1,idx-20);i<=idx;i++){
    obv += bars[i].close>bars[i-1].close?bars[i].volume:bars[i].close<bars[i-1].close?-bars[i].volume:0;
    obvs.push(obv);
  }
  if(obvs.length>=6&&obvs.at(-1)!>obvs.at(-6)!){s+=4;reasons.push('OBV 5거래일 상승');}

  const recentVol=avg(bars.slice(idx-4,idx+1).map(b=>b.volume));
  const baseVol=avg(bars.slice(idx-24,idx-5).map(b=>b.volume));
  const r5=pct(bars[idx].close,bars[idx-5].close);
  if(baseVol>0&&recentVol/baseVol>=1.3&&r5>-3&&r5<9){s+=4;reasons.push(`5일 거래량 증가에도 주가 변화 ${r5.toFixed(1)}%로 조용한 매집 후보`);}

  const cur=bars[idx],day=pct(cur.close,bars[idx-1].close),range=Math.max(cur.high-cur.low,1e-9),closePos=(cur.close-cur.low)/range;
  if(rollingVolumeRatio(bars,idx)>=1.4&&day<=1.5&&closePos>=0.6){s+=2;reasons.push('보합권 대량거래 후 종가 회복');}
  return {score:Math.min(10,s),reasons};
}

export function overheatPenalty(bars:Bar[]){
  const r=priceReturns(bars); let p=0; const reasons:string[]=[];
  if(r.r1>=8){p-=6;reasons.push(`이미 1일 +${r.r1.toFixed(1)}% 상승`);}
  if(r.r3>=12){p-=6;reasons.push(`이미 3일 +${r.r3.toFixed(1)}% 상승`);}
  if(r.r5>=18){p-=5;reasons.push(`이미 5일 +${r.r5.toFixed(1)}% 상승`);}
  if(r.r20>=30){p-=3;reasons.push(`이미 20일 +${r.r20.toFixed(1)}% 상승`);}
  return {penalty:Math.max(-20,p),reasons};
}

export function currentAccumulationSignal(bars:Bar[]){
  const a=absorptionScore(bars),t=trendScore(bars),s=stealthScore(bars),p=overheatPenalty(bars),r=priceReturns(bars);
  const last=bars.at(-1)!;
  return {
    currentPrice:last.close,
    changePct:r.r1,
    ret5:r.r5,
    absorptionScore:a.score,
    trendScore:t.score,
    stealthScore:s.score,
    technicalScore:a.score+t.score+s.score,
    penalty:p.penalty,
    volumeRatio:a.volumeRatio,
    reasons:[...a.reasons,...t.reasons,...s.reasons,...p.reasons]
  };
}

export function stage(score:number){
  return score>=85?'강한 매집':score>=70?'매집 집중':score>=55?'매집 의심':score>=40?'관심':'관찰';
}
