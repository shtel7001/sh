import type {Bar} from './market';

export type Settings={
  lookbackDays:number; minScore:number; lowZoneMaxPct:number; nearMa5Pct:number; touchTolerancePct:number;
  cycleRisePct:number; cycleMaxBars:number; trendMinSlopePct:number; maxBelowMa60Pct:number;
  useIntraday:boolean; intradayBars:number;
};

const avg=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const pct=(a:number,b:number)=>b?((a/b)-1)*100:0;
const round=(n:number,d=2)=>Number(n.toFixed(d));
function sma(b:Bar[],n:number,i:number){if(i<n-1)return null;return avg(b.slice(i-n+1,i+1).map(x=>x.close))}
function slopePct(a:number[]){if(a.length<2)return 0;const n=a.length;let sx=0,sy=0,sxy=0,sxx=0;for(let i=0;i<n;i++){sx+=i;sy+=a[i];sxy+=i*a[i];sxx+=i*i}const d=n*sxx-sx*sx;if(!d)return 0;const m=(n*sxy-sx*sy)/d;return m/(avg(a)||1)*100}

export function analyzeDaily(raw:Bar[],s:Settings){
  const b=raw.filter(x=>Number.isFinite(x.close)&&x.close>0).sort((a,c)=>a.date.localeCompare(c.date));
  const n=b.length;if(n<65)return{pass:false,error:'일봉 65개 미만',score:0};
  const ma5=b.map((_,i)=>sma(b,5,i));
  const ma20=b.map((_,i)=>sma(b,20,i));
  const ma60=b.map((_,i)=>sma(b,60,i));
  const i=n-1,cur=b[i],m5=ma5[i]!,m20=ma20[i]!,m60=ma60[i]!;
  const searchDays=Math.max(1,Math.min(60,Math.floor(s.lookbackDays)));
  const start=Math.max(4,n-searchDays);
  const recent=b.slice(n-searchDays);
  const rangeHigh=Math.max(...recent.map(x=>x.high||x.close));
  const rangeLow=Math.min(...recent.map(x=>x.low||x.close));
  const rangePositionPct=rangeHigh>rangeLow?((cur.close-rangeLow)/(rangeHigh-rangeLow))*100:((cur.close-cur.low)/(Math.max(1,cur.high-cur.low)))*100;
  const ma20Vals=ma20.slice(Math.max(19,i-5),i+1).filter((x):x is number=>typeof x==='number');
  const ma60Vals=ma60.slice(Math.max(59,i-5),i+1).filter((x):x is number=>typeof x==='number');
  const ma20SlopePct=slopePct(ma20Vals),ma60SlopePct=slopePct(ma60Vals);
  const return20Pct=pct(cur.close,b[Math.max(0,i-20)].close);
  const distanceMa5Pct=pct(cur.close,m5),distanceMa20Pct=pct(cur.close,m20),distanceMa60Pct=pct(cur.close,m60);
  const lowTouchMa5Pct=pct(cur.low,m5);

  let trendScore=0;
  if(ma20SlopePct>=s.trendMinSlopePct)trendScore+=16;else if(ma20SlopePct>0)trendScore+=11;
  if(m20>=m60)trendScore+=10;
  if(cur.close>=m60)trendScore+=8;else if(distanceMa60Pct>=-s.maxBelowMa60Pct)trendScore+=4;
  if(return20Pct>0)trendScore+=Math.min(6,2+return20Pct/3);
  trendScore=Math.min(40,trendScore);

  let lowScore=0;
  if(rangePositionPct<=s.lowZoneMaxPct)lowScore+=18;else if(rangePositionPct<=Math.min(70,s.lowZoneMaxPct+20))lowScore+=9;
  const absGap5=Math.abs(distanceMa5Pct);
  if(absGap5<=s.nearMa5Pct)lowScore+=14;else if(absGap5<=s.nearMa5Pct*1.8)lowScore+=7;
  if(Math.abs(lowTouchMa5Pct)<=s.touchTolerancePct||lowTouchMa5Pct<0&&distanceMa5Pct<=s.nearMa5Pct)lowScore+=5;
  if(Math.abs(distanceMa20Pct)<=3)lowScore+=3;
  lowScore=Math.min(40,lowScore);

  let cycleCount=0,lastEntry=-99;const cycleDetails:{date:string;gainPct:number}[]=[];
  for(let k=start;k<i;k++){
    const km5=ma5[k],km20=ma20[k];if(!km5||!km20||k-lastEntry<2)continue;
    const touch=(b[k].low<=km5*(1+s.touchTolerancePct/100))&&(b[k].close>=km20*.96);
    if(!touch)continue;
    const end=Math.min(i,k+Math.max(1,s.cycleMaxBars));
    let hi=b[k].close;for(let j=k+1;j<=end;j++)hi=Math.max(hi,b[j].high||b[j].close);
    const gain=pct(hi,b[k].close);
    if(gain>=s.cycleRisePct){cycleCount++;lastEntry=k;cycleDetails.push({date:b[k].date,gainPct:round(gain)})}
  }
  const cycleScore=Math.min(20,cycleCount*7);
  let score=Math.round((trendScore+lowScore+cycleScore)*10)/10;

  const uptrend=(ma20SlopePct>=s.trendMinSlopePct||return20Pct>0)&&(m20>=m60*.985||distanceMa60Pct>=-s.maxBelowMa60Pct);
  const lowZone=rangePositionPct<=Math.min(75,s.lowZoneMaxPct+20)||absGap5<=s.nearMa5Pct*1.8||Math.abs(distanceMa20Pct)<=3;
  const pass=uptrend&&lowZone&&score>=s.minScore;
  const grade=score>=82?'A+':score>=74?'A':score>=66?'B+':score>=58?'B':'C';
  const reasons:string[]=[];
  if(ma20SlopePct>0)reasons.push(`20일선 우상향 +${round(ma20SlopePct,3)}%/bar`);
  if(m20>=m60)reasons.push('20일선이 60일선 위');
  reasons.push(`최근 ${searchDays}일 가격위치 ${round(rangePositionPct,1)}% (0%=저점)`);
  reasons.push(`5일선 괴리 ${round(distanceMa5Pct)}% · 오늘 저가/5일선 ${round(lowTouchMa5Pct)}%`);
  if(cycleCount)reasons.push(`5일선 눌림→+${s.cycleRisePct}% 반등 패턴 ${cycleCount}회`);
  else reasons.push('과거 반복패턴 0회(현재 저점·추세 점수로 선별)');
  return{pass,score,grade,trendScore:round(trendScore,1),lowScore:round(lowScore,1),cycleScore,cycleCount,cycleDetails:cycleDetails.slice(-5),searchDays,rangePositionPct:round(rangePositionPct,1),rangeLow,rangeHigh,distanceMa5Pct:round(distanceMa5Pct),distanceMa20Pct:round(distanceMa20Pct),distanceMa60Pct:round(distanceMa60Pct),lowTouchMa5Pct:round(lowTouchMa5Pct),ma20SlopePct:round(ma20SlopePct,4),ma60SlopePct:round(ma60SlopePct,4),return20Pct:round(return20Pct),close:cur.close,ma5:m5,ma20:m20,ma60:m60,lastDate:cur.date,reasons};
}

export function analyze30m(raw:Bar[],s:Settings){
  const b=raw.filter(x=>Number.isFinite(x.close)&&x.close>0).sort((a,c)=>a.date.localeCompare(c.date));
  const n=b.length,use=Math.max(3,Math.min(20,Math.floor(s.intradayBars)));if(n<use+5)return{pass:false,bonus:0,error:'30분봉 이력 부족'};
  const w=b.slice(-use),closes=w.map(x=>x.close),slope=slopePct(closes),low=Math.min(...w.map(x=>x.low||x.close)),riseFromLow=pct(b[n-1].close,low),lastUp=b[n-1].close>=b[n-2].close;
  let bonus=0;if(slope>0)bonus+=4;if(riseFromLow>=.5)bonus+=3;if(lastUp)bonus+=3;
  return{pass:bonus>=6,bonus,slopePct:round(slope,4),riseFromLowPct:round(riseFromLow),lastUp,barsUsed:use,lastDate:b[n-1].date,reasons:bonus>=6?[`30분봉 저점 반등 보너스 +${bonus}점`,`최근 ${use}개 기울기 ${round(slope,4)}%/bar`]:[]};
}
