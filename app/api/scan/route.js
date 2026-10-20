import {NextResponse} from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
async function bars(symbol){
 for(const host of ['query1','query2']){
  try{
   const r=await fetch('https://'+host+'.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?range=2y&interval=1d',{cache:'no-store'});
   if(!r.ok)continue;
   const j=await r.json(),d=j.chart?.result?.[0],q=d?.indicators?.quote?.[0];
   if(!q)continue;
   const a=q.close.map((c,i)=>({c,l:q.low[i],h:q.high[i],v:q.volume?.[i]||0,t:d.timestamp?.[i]||0})).filter(x=>x.c>0&&x.l>0&&x.h>0);
   if(a.length>=180)return a;
  }catch{}
 }
 throw Error('일봉 데이터 부족');
}
function weeklyBars(a){
 const weeks=[];
 for(const x of a){
  const dt=new Date(x.t*1000),dow=(dt.getUTCDay()+6)%7;
  dt.setUTCDate(dt.getUTCDate()-dow);
  const key=dt.toISOString().slice(0,10);
  if(weeks.at(-1)?.key===key){const w=weeks.at(-1);w.c=x.c;w.h=Math.max(w.h,x.h);w.l=Math.min(w.l,x.l);w.v+=x.v||0;}
  else weeks.push({key,c:x.c,h:x.h,l:x.l,v:x.v||0});
 }
 return weeks;
}
function detectWeinstein(a,days,tol){
 const weeks=weeklyBars(a);
 // Only completed weekly bars: the current partial week must not be treated as closed.
 const now=new Date(),day=(now.getUTCDay()+6)%7;
 const currentMonday=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-day)).toISOString().slice(0,10);
 const w=weeks.at(-1)?.key===currentMonday?weeks.slice(0,-1):weeks;
 if(w.length<40)return null;
 const maAt=i=>w.slice(i-29,i+1).reduce((sum,x)=>sum+x.c,0)/30;
 const n=w.length,ma=maAt(n-1),priorMA=maAt(n-5),prevMA=maAt(n-2);
 const slope=(ma/priorMA-1)*100;
 const latest=w.at(-1),previous=w.at(-2);
 const prevAbove=previous.c>prevMA;
 const above=latest.c>ma;
 const avgVolume=w.slice(-11,-1).reduce((sum,x)=>sum+x.v,0)/10;
 const volRatio=avgVolume>0?latest.v/avgVolume:null;
 const crossing=above&&!prevAbove;
 const breakout=crossing&&slope>0&&volRatio!==null&&volRatio>=1.5;
 const proximity=Math.abs((latest.c/ma-1)*100)<=tol;
 const stage=above&&slope>0?'2단계 상승':!above&&slope<0?'4단계 하락':slope>0?'2단계 전환 관찰':'1·3단계 횡보/전환';
 const signal=breakout?'30주선 돌파·거래량 증가':crossing?'30주선 상향 돌파(확인 대기)':above&&slope>0&&proximity?'30주선 위 상승추세·눌림목':null;
 if(!signal)return null;
 const last=a.at(-1),peak=Math.max(...a.slice(-Math.min(days,a.length),-1).map(x=>x.h));
 const sma=p=>a.slice(-p).reduce((sum,x)=>sum+x.c,0)/p;
 const spark=a.slice(-200).map((x,i)=>[i,x.c]);
 const sparkSupport=a.slice(-200).map((x,i)=>{const k=a.length-Math.min(200,a.length)+i;return k>=149?a.slice(k-149,k+1).reduce((sum,x)=>sum+x.c,0)/150:null});
 return {current:last.c,priorHigh:peak,highGapPct:(last.c/peak-1)*100,ma150:sma(150),priorLow:Math.min(...a.slice(-Math.min(days,a.length)).map(x=>x.l)),newLow:Math.min(...a.slice(-16).map(x=>x.l)),distance:(latest.c/ma-1)*100,breakdownPct:0,score:Math.min(100,Math.round(65+(crossing?15:0)+(slope>0?10:0)+(volRatio>=1.5?10:0))),spark,sparkMA150:sparkSupport,sparkSupport,declineDays:0,declinePct:(last.c/a.at(-21).c-1)*100,supportPeriod:150,supportMA:ma,ma20:sma(20),ma50:sma(50),ma100:sma(100),reason:signal,weinstein:true,stage,weeklyMA30:ma,weeklySlopePct:slope,weeklyVolumeRatio:volRatio,weeklySignal:signal,weeklyClose:latest.c,weeklyDate:latest.key};
}
function detect(a,days,tol,breakPct,period,mode,declineDays){
 const n=a.length,ma=a.slice(-period).reduce((s,x)=>s+x.c,0)/period;
 const old=a.slice(Math.max(0,n-days-1),n-16);
 if(old.length<15)return null;
 const prior=Math.min(...old.map(x=>x.l));
 const recent=a.slice(n-16,n-1),low=Math.min(...recent.map(x=>x.l));
 const peak=Math.max(...a.slice(Math.max(0,n-days-1),n-1).map(x=>x.h));
 const last=a[n-1],distance=(last.c/ma-1)*100;
 const window=a.slice(-(declineDays+1));
 const startClose=window[0].c;
 const declinePct=(last.c/startClose-1)*100;
 const hasDeclined=declinePct<0;
 if(!hasDeclined)return null;
 const nearNow=Math.abs(distance)<=tol||Math.abs((last.l/ma-1)*100)<=tol;
 const touchedRecently=a.slice(-6).some(x=>x.l<=ma*(1+tol/100)&&x.h>=ma*(1-tol/100));
 const broken=low<=prior*(1-breakPct/100);
 if(mode==='strict'){if(!broken||!nearNow||last.c<ma*(1-tol/100))return null;}
 else if(mode==='support'){if(!nearNow&&!touchedRecently)return null;}
 else {if(!nearNow)return null;}
 const score=Math.round(Math.max(0,100-Math.abs(distance)*12));
 return {current:last.c,priorHigh:peak,highGapPct:(last.c/peak-1)*100,ma150:a.slice(-150).reduce((v,p)=>v+p.c,0)/150,priorLow:prior,newLow:low,distance,breakdownPct:(low/prior-1)*100,score,spark:a.slice(-200).map((x,i)=>[i,x.c]),sparkMA150:a.slice(-200).map((x,i)=>n-Math.min(n,200)+i>=149?a.slice(n-Math.min(n,200)+i-149,n-Math.min(n,200)+i+1).reduce((v,p)=>v+p.c,0)/150:null),sparkSupport:a.slice(-200).map((x,i)=>n-Math.min(n,200)+i>=period-1?a.slice(n-Math.min(n,200)+i-period+1,n-Math.min(n,200)+i+1).reduce((v,p)=>v+p.c,0)/period:null),declineDays,declinePct,supportPeriod:period,supportMA:ma,ma20:a.slice(-20).reduce((s,x)=>s+x.c,0)/20,ma50:a.slice(-50).reduce((s,x)=>s+x.c,0)/50,ma100:a.slice(-100).reduce((s,x)=>s+x.c,0)/100,reason:(broken?'전저점 이탈 · ':'')+period+'일선 '+(nearNow?'접근':'최근 6거래일 터치')};
}
export async function POST(req){
 try{
  const b=await req.json(),stocks=(Array.isArray(b.stocks)?b.stocks:[]).slice(0,20);
  const days=Math.max(30,Math.min(252,Number(b.days)||90));
  const tol=Math.max(.5,Math.min(15,Number(b.proximity)||3));
  const bp=Math.max(.1,Math.min(15,Number(b.breakPct)||1));
  const period=[20,50,100,150].includes(Number(b.supportPeriod))?Number(b.supportPeriod):150;
  const mode=['strict','support','near'].includes(b.mode)?b.mode:'support';
  const declineDays=Math.max(5,Math.min(252,Math.round(Number(b.declineDays)||20)));
  const weinstein=b.supportPeriod==='30w';
  const z=await Promise.all(stocks.map(async s=>{try{const a=await bars(s.yahoo||s.code);const v=weinstein?detectWeinstein(a,days,tol):detect(a,days,tol,bp,period,mode,declineDays);return {hit:v?{...s,...v}:null}}catch(e){return {error:{code:s.code,error:String(e.message||e)}}}}));
  return NextResponse.json({ok:true,hits:z.filter(x=>x.hit).map(x=>x.hit),errors:z.filter(x=>x.error).map(x=>x.error)});
 }catch(e){return NextResponse.json({ok:false,error:String(e.message||e)},{status:500})}
}