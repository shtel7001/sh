import {NextResponse} from 'next/server';
import {isAuthed,unauthorized} from '@/lib/guard';
import {fetchDailyBars,fetchYahoo30m,type UniverseStock} from '@/lib/market';
import {analyzeDaily,analyze30m,type Settings} from '@/lib/rebound';
export const runtime='nodejs';export const maxDuration=60;

const clamp=(v:unknown,min:number,max:number,fallback:number)=>Math.min(max,Math.max(min,Number.isFinite(Number(v))?Number(v):fallback));
function settings(x:any):Settings{return{
 searchDays:clamp(x?.searchDays,1,60,10),
 cycleWindowDays:clamp(x?.cycleWindowDays,20,120,60),
 minCycles:clamp(x?.minCycles,1,8,2),
 touchTolerancePct:clamp(x?.touchTolerancePct,0,5,1),
 profitZonePct:clamp(x?.profitZonePct,.5,12,2),
 minSwingPct:clamp(x?.minSwingPct,1,25,5),
 minTrendSlopePct:clamp(x?.minTrendSlopePct,-.2,1,0),
 longSupportPct:clamp(x?.longSupportPct,0,15,4),
 recentHighDays:clamp(x?.recentHighDays,5,40,15),
 minPullbackPct:clamp(x?.minPullbackPct,1,25,3),
 near5MaxPct:clamp(x?.near5MaxPct,0,8,3),
 below5MaxPct:clamp(x?.below5MaxPct,0,12,5),
 near20Pct:clamp(x?.near20Pct,1,15,6),
 maxPositionPct:clamp(x?.maxPositionPct,20,95,70),
 currentLowOnly:x?.currentLowOnly!==false,
 useIntraday:x?.useIntraday===true,
 intradayBars:clamp(x?.intradayBars,3,20,6),
 intradayMinSlopePct:clamp(x?.intradayMinSlopePct,-.2,.5,0)
}}

async function one(stock:UniverseStock,s:Settings){
 try{
  const dailyFetched=await fetchDailyBars(stock.code,stock.market,'yahoo',140);
  const daily=analyzeDaily(dailyFetched.bars,s);
  if(!daily.pass)return{...stock,dataStatus:'ok',match:false,daily,intraday:null,score:daily.score||0,source:dailyFetched.source};
  let intraday:any=null;
  if(s.useIntraday){
   try{intraday=analyze30m(await fetchYahoo30m(stock.code,stock.market),s)}catch(e){intraday={pass:false,error:e instanceof Error?e.message:'30분봉 수집 실패',score:0}}
  }
  const match=!!daily.pass&&(!s.useIntraday||!!intraday?.pass);
  const score=Math.round((s.useIntraday?((daily.score||0)*.9+(intraday?.score||0)*.1):(daily.score||0))*10)/10;
  return{...stock,currentPrice:daily.close??stock.currentPrice,dataStatus:'ok',match,daily,intraday,score,source:dailyFetched.source,reasons:[...(daily.reasons||[]),...(intraday?.reasons||[])],chartBars:match?dailyFetched.bars.slice(-60):[]};
 }catch(e){return{...stock,dataStatus:'error',match:false,error:e instanceof Error?e.message:'분석 실패',score:0}}
}

export async function POST(req:Request){
 if(!await isAuthed())return unauthorized();
 const b=await req.json().catch(()=>null),stocks:UniverseStock[]=Array.isArray(b?.stocks)?b.stocks:[];
 if(!stocks.length||stocks.length>24)return NextResponse.json({error:'한 번에 1~24종목을 분석합니다.'},{status:400});
 const s=settings(b?.settings),out:any[]=[];
 for(let i=0;i<stocks.length;i+=6)out.push(...await Promise.all(stocks.slice(i,i+6).map(x=>one(x,s))));
 return NextResponse.json({results:out,settings:s});
}
