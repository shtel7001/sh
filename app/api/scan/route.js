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
function detect(a,days,tol,breakPct){
 const n=a.length,ma=a.slice(-150).reduce((s,x)=>s+x.c,0)/150;
 const old=a.slice(Math.max(0,n-days-1),n-16);
 if(old.length<15)return null;
 const prior=Math.min(...old.map(x=>x.l));
 const recent=a.slice(n-16,n-1),low=Math.min(...recent.map(x=>x.l));
 const last=a[n-1],distance=(last.l/ma-1)*100;
 if(low>prior*(1-breakPct/100)||Math.abs(distance)>tol||last.c<ma*(1-tol/100))return null;
 const score=Math.round(Math.max(0,100-Math.abs(distance)*12));
 return {current:last.c,ma150:ma,priorLow:prior,newLow:low,distance,breakdownPct:(low/prior-1)*100,score,spark:a.slice(-60).map((x,i)=>[i,x.c]),reason:'전저점 이탈 후 150일선 접근'};
}
export async function POST(req){
 try{
  const b=await req.json(),stocks=(Array.isArray(b.stocks)?b.stocks:[]).slice(0,20);
  const days=Math.max(30,Math.min(240,Number(b.days)||90));
  const tol=Math.max(.5,Math.min(15,Number(b.proximity)||3));
  const bp=Math.max(.1,Math.min(15,Number(b.breakPct)||1));
  const z=await Promise.all(stocks.map(async s=>{try{const v=detect(await bars(s.yahoo||s.code),days,tol,bp);return {hit:v?{...s,...v}:null}}catch(e){return {error:{code:s.code,error:String(e.message||e)}}}}));
  return NextResponse.json({ok:true,hits:z.filter(x=>x.hit).map(x=>x.hit),errors:z.filter(x=>x.error).map(x=>x.error)});
 }catch(e){return NextResponse.json({ok:false,error:String(e.message||e)},{status:500})}
}