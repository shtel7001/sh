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
   const a=q.close.map((c,i)=>({c,l:q.low[i],h:q.high[i]})).filter(x=>x.c>0&&x.l>0&&x.h>0);
   if(a.length>=180)return a;
  }catch{}
 }
 throw Error('일봉 데이터 부족');
}
function detect(a,days,tol,breakPct,period){
 const n=a.length,ma=a.slice(-period).reduce((s,x)=>s+x.c,0)/period;
 const old=a.slice(Math.max(0,n-days-1),n-16);
 if(old.length<15)return null;
 const prior=Math.min(...old.map(x=>x.l));
 const recent=a.slice(n-16,n-1),low=Math.min(...recent.map(x=>x.l));
 const peak=Math.max(...a.slice(Math.max(0,n-days-1),n-1).map(x=>x.h));
 const last=a[n-1],distance=(last.l/ma-1)*100;
 if(low>prior*(1-breakPct/100)||Math.abs(distance)>tol||last.c<ma*(1-tol/100))return null;
 const score=Math.round(Math.max(0,100-Math.abs(distance)*12));
 return {current:last.c,priorHigh:peak,highGapPct:(last.c/peak-1)*100,ma150:a.slice(-150).reduce((v,p)=>v+p.c,0)/150,priorLow:prior,newLow:low,distance,breakdownPct:(low/prior-1)*100,score,spark:a.slice(-200).map((x,i)=>[i,x.c]),sparkMA150:a.slice(-200).map((x,i)=>n-200+i>=149?a.slice(n-200+i-149,n-200+i+1).reduce((v,p)=>v+p.c,0)/150:null),sparkSupport:a.slice(-200).map((x,i)=>n-200+i>=period-1?a.slice(n-200+i-period+1,n-200+i+1).reduce((v,p)=>v+p.c,0)/period:null),supportPeriod:period,supportMA:ma,ma20:a.slice(-20).reduce((s,x)=>s+x.c,0)/20,ma50:a.slice(-50).reduce((s,x)=>s+x.c,0)/50,ma100:a.slice(-100).reduce((s,x)=>s+x.c,0)/100,reason:'전저점 이탈 후 '+period+'일선 접근'};
}
export async function POST(req){
 try{
  const b=await req.json(),stocks=(Array.isArray(b.stocks)?b.stocks:[]).slice(0,20);
  const days=Math.max(30,Math.min(240,Number(b.days)||90));
  const tol=Math.max(.5,Math.min(15,Number(b.proximity)||3));
  const bp=Math.max(.1,Math.min(15,Number(b.breakPct)||1));
  const period=[20,50,100,150].includes(Number(b.supportPeriod))?Number(b.supportPeriod):150;
  const z=await Promise.all(stocks.map(async s=>{try{const v=detect(await bars(s.yahoo||s.code),days,tol,bp,period);return {hit:v?{...s,...v}:null}}catch(e){return {error:{code:s.code,error:String(e.message||e)}}}}));
  return NextResponse.json({ok:true,hits:z.filter(x=>x.hit).map(x=>x.hit),errors:z.filter(x=>x.error).map(x=>x.error)});
 }catch(e){return NextResponse.json({ok:false,error:String(e.message||e)},{status:500})}
}