import type {Bar} from './market';

export type Settings={
 searchDays:number;
 cycleWindowDays:number;
 minCycles:number;
 touchTolerancePct:number;
 profitZonePct:number;
 minSwingPct:number;
 minTrendSlopePct:number;
 longSupportPct:number;
 recentHighDays:number;
 minPullbackPct:number;
 near5MaxPct:number;
 below5MaxPct:number;
 near20Pct:number;
 maxPositionPct:number;
 currentLowOnly:boolean;
 useIntraday:boolean;
 intradayBars:number;
 intradayMinSlopePct:number;
};

const avg=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const pct=(a:number,b:number)=>b?((a/b)-1)*100:0;
const round=(n:number,d=2)=>Number(n.toFixed(d));
function sma(b:Bar[],n:number,i:number){if(i<n-1)return null;return avg(b.slice(i-n+1,i+1).map(x=>x.close))}
function slopePct(a:number[]){if(a.length<2)return 0;const n=a.length;let sx=0,sy=0,sxy=0,sxx=0;for(let i=0;i<n;i++){sx+=i;sy+=a[i];sxy+=i*a[i];sxx+=i*i}const d=n*sxx-sx*sx;if(!d)return 0;const m=(n*sxy-sx*sy)/d;return m/(avg(a)||1)*100}

function countCycles(b:Bar[],ma5:(number|null)[],s:Settings){
 const start=Math.max(4,b.length-s.cycleWindowDays);
 let cycles=0,state:'LOW'|'HIGH'='LOW',lowPrice=0,lowDate='';
 const completed:{lowDate:string;highDate:string;gainPct:number}[]=[];
 for(let i=start;i<b.length;i++){
  const m5=ma5[i];if(!m5)continue;
  const devClose=pct(b[i].close,m5),devLow=pct(b[i].low||b[i].close,m5);
  if(state==='LOW'){
   if(devClose<=s.touchTolerancePct||devLow<=s.touchTolerancePct){lowPrice=Math.min(b[i].low||b[i].close,b[i].close);lowDate=b[i].date;state='HIGH'}
  }else{
   if((b[i].low||b[i].close)<lowPrice){lowPrice=b[i].low||b[i].close;lowDate=b[i].date}
   const gain=pct(Math.max(b[i].high||b[i].close,b[i].close),lowPrice);
   const highDev=pct(Math.max(b[i].high||b[i].close,b[i].close),m5);
   if(highDev>=s.profitZonePct||gain>=s.minSwingPct){cycles++;completed.push({lowDate,highDate:b[i].date,gainPct:round(gain)});state='LOW'}
  }
 }
 return{cycles,completed:completed.slice(-6)};
}

function lowSignalAt(b:Bar[],ma5:(number|null)[],ma20:(number|null)[],i:number,s:Settings){
 const m5=ma5[i],m20=ma20[i];if(!m5||!m20)return null;
 const a=Math.max(0,i-s.recentHighDays+1),part=b.slice(a,i+1);
 const high=Math.max(...part.map(x=>x.high||x.close)),low=Math.min(...part.map(x=>x.low||x.close));
 const pullback=Math.max(0,(1-b[i].close/high)*100);
 const pos=high===low?50:((b[i].close-low)/(high-low))*100;
 const d5=pct(b[i].close,m5),d20=pct(b[i].close,m20),lowD5=pct(b[i].low||b[i].close,m5);
 const near5=d5<=s.near5MaxPct&&d5>=-s.below5MaxPct;
 const touch5=lowD5<=s.touchTolerancePct&&lowD5>=-(s.below5MaxPct+2);
 const near20=Math.abs(d20)<=s.near20Pct;
 const pass=pullback>=s.minPullbackPct&&(near5||near20||touch5)&&pos<=s.maxPositionPct;
 return{pass,pullbackPct:round(pullback),positionPct:round(pos),vsMa5Pct:round(d5),vsMa20Pct:round(d20),lowVsMa5Pct:round(lowD5),near5,near20,touch5,recentHigh:high,recentLow:low};
}

export function analyzeDaily(raw:Bar[],s:Settings){
 const b=raw.filter(x=>Number.isFinite(x.close)&&x.close>0).sort((a,c)=>a.date.localeCompare(c.date));const n=b.length;
 if(n<35)return{pass:false,error:'일봉 35개 미만',score:0,trendPass:false,cyclePass:false,lowPass:false};
 const ma5=b.map((_,i)=>sma(b,5,i)),ma20=b.map((_,i)=>sma(b,20,i)),ma60=b.map((_,i)=>sma(b,60,i));
 const i=n-1,cur=b[i],m5=ma5[i]!,m20=ma20[i]!,m60=ma60[i];
 const ma20Series=ma20.slice(Math.max(19,i-9),i+1).filter((x):x is number=>typeof x==='number');
 const ma20Slope=slopePct(ma20Series);
 const longBase=typeof m60==='number'?m60:m20;
 const aboveLongPct=pct(cur.close,longBase);
 const trendPass=ma20Slope>=s.minTrendSlopePct&&aboveLongPct>=-s.longSupportPct;
 const cycle=countCycles(b,ma5,s),cyclePass=cycle.cycles>=s.minCycles;
 const begin=Math.max(20,n-s.searchDays),signals:any[]=[];
 for(let k=begin;k<n;k++){const z=lowSignalAt(b,ma5,ma20,k,s);if(z?.pass)signals.push({...z,index:k,date:b[k].date,close:b[k].close,daysAgo:n-1-k})}
 const latestSignal=signals.length?signals[signals.length-1]:null;
 const currentSignal=lowSignalAt(b,ma5,ma20,i,s);
 const lowPass=!!latestSignal&&(!s.currentLowOnly||!!currentSignal?.pass);
 const latestChange=pct(cur.close,b[i-1].close),ma5Slope=slopePct(ma5.slice(Math.max(4,i-4),i+1).filter((x):x is number=>typeof x==='number'));
 const reboundHint=latestChange>0||pct(cur.close,m5)>0||ma5Slope>0;
 let score=0;
 if(trendPass)score+=30;else if(ma20Slope>0)score+=15;
 score+=Math.min(25,cycle.cycles*8);
 if(latestSignal){score+=Math.min(25,8+latestSignal.pullbackPct*2);if(latestSignal.near5)score+=5;if(latestSignal.near20)score+=5}
 if(reboundHint)score+=10;
 score=Math.min(100,round(score,1));
 const pass=trendPass&&cyclePass&&lowPass;
 const reasons:string[]=[];
 if(trendPass)reasons.push(`우상향: 20일선 기울기 ${round(ma20Slope,3)}%/bar · 장기선 대비 ${round(aboveLongPct)}%`);
 if(cyclePass)reasons.push(`5일선 저점→고점 왕복 ${cycle.cycles}회`);
 if(latestSignal)reasons.push(`저점권 ${latestSignal.daysAgo}일 전 · 최근고점 대비 -${latestSignal.pullbackPct}% · 5일선 ${latestSignal.vsMa5Pct>=0?'+':''}${latestSignal.vsMa5Pct}%`);
 if(latestSignal?.near20)reasons.push(`20일선 근접 ${latestSignal.vsMa20Pct>=0?'+':''}${latestSignal.vsMa20Pct}%`);
 if(reboundHint)reasons.push(`반등 힌트: 당일 ${round(latestChange)}% · 5일선 기울기 ${round(ma5Slope,3)}%/bar`);
 return{pass,score,trendPass,cyclePass,lowPass,close:cur.close,lastDate:cur.date,ma5:m5,ma20:m20,ma60:m60,ma20SlopePct:round(ma20Slope,4),aboveLongPct:round(aboveLongPct),cycleCount:cycle.cycles,cycles:cycle.completed,signalDate:latestSignal?.date||null,signalDaysAgo:latestSignal?.daysAgo??null,pullbackPct:latestSignal?.pullbackPct??null,positionPct:latestSignal?.positionPct??null,currentVsMa5Pct:round(pct(cur.close,m5)),currentVsMa20Pct:round(pct(cur.close,m20)),signalVsMa5Pct:latestSignal?.vsMa5Pct??null,signalVsMa20Pct:latestSignal?.vsMa20Pct??null,latestChangePct:round(latestChange),ma5SlopePct:round(ma5Slope,4),reboundHint,reasons,error:pass?undefined:!trendPass?'우상향 조건 불충족':!cyclePass?'5일선 왕복 횟수 부족':'저점권 조건 불충족'};
}

export function analyze30m(raw:Bar[],s:Settings){
 const b=raw.filter(x=>Number.isFinite(x.close)&&x.close>0).sort((a,c)=>a.date.localeCompare(c.date)),n=b.length,use=Math.max(3,Math.min(s.intradayBars,n));
 if(n<Math.max(10,use+2))return{pass:false,error:'30분봉 이력 부족',score:0};
 const closes=b.slice(-use).map(x=>x.close),slope=slopePct(closes),m5=sma(b,5,n-1)!;
 const pass=slope>=s.intradayMinSlopePct&&b[n-1].close>=m5*.99;
 const score=Math.max(0,Math.min(100,50+Math.min(50,slope*300)));
 return{pass,score:round(score,1),slopePct:round(slope,4),aboveMa5Pct:round(pct(b[n-1].close,m5)),barsUsed:use,lastDate:b[n-1].date,reasons:pass?[`30분봉 최근 ${use}개 우상향 +${round(slope,4)}%/bar`]:[]};
}
