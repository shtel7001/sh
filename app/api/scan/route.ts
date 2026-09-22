import {NextResponse} from 'next/server';
import {isAuthed,unauthorized} from '@/lib/guard';
import {fetchDailyBars,fetchYahoo30m,type UniverseStock} from '@/lib/market';
import {analyzeDaily,analyze30m,type Settings} from '@/lib/rebound';
export const runtime='nodejs';export const maxDuration=60;

const clamp=(v:unknown,min:number,max:number,fallback:number)=>Math.min(max,Math.max(min,Number.isFinite(Number(v))?Number(v):fallback));
function settings(x:any):Settings{return{
  lookbackDays:clamp(x?.lookbackDays,1,60,20),minScore:clamp(x?.minScore,30,90,58),lowZoneMaxPct:clamp(x?.lowZoneMaxPct,5,70,35),nearMa5Pct:clamp(x?.nearMa5Pct,.3,8,2.5),touchTolerancePct:clamp(x?.touchTolerancePct,.3,6,1.8),cycleRisePct:clamp(x?.cycleRisePct,1,15,3),cycleMaxBars:clamp(x?.cycleMaxBars,2,20,7),trendMinSlopePct:clamp(x?.trendMinSlopePct,-.1,.3,0),maxBelowMa60Pct:clamp(x?.maxBelowMa60Pct,0,12,3),useIntraday:x?.useIntraday===true,intradayBars:clamp(x?.intradayBars,3,20,6)
}}

async function one(stock:UniverseStock,s:Settings){
  try{
    const fetched=await fetchDailyBars(stock.code,stock.market,'yahoo',140);
    const daily=analyzeDaily(fetched.bars,s);
    if(!daily.pass)return{...stock,dataStatus:'ok',match:false,daily,intraday:null,score:daily.score||0,source:fetched.source};
    let intraday:any=null,bonus=0;
    if(s.useIntraday){try{intraday=analyze30m(await fetchYahoo30m(stock.code,stock.market),s);bonus=Number(intraday?.bonus||0)}catch(e){intraday={pass:false,bonus:0,error:e instanceof Error?e.message:'30분봉 수집 실패'}}}
    const score=Math.min(100,Math.round(((daily.score||0)+bonus)*10)/10);
    return{...stock,currentPrice:daily.close??stock.currentPrice,dataStatus:'ok',match:true,daily,intraday,score,source:fetched.source,reasons:[...(daily.reasons||[]),...(intraday?.reasons||[])],chartBars:fetched.bars.slice(-60)};
  }catch(e){return{...stock,dataStatus:'error',match:false,error:e instanceof Error?e.message:'분석 실패',score:0}}
}

export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  const b=await req.json().catch(()=>null),stocks:UniverseStock[]=Array.isArray(b?.stocks)?b.stocks:[];
  if(!stocks.length||stocks.length>16)return NextResponse.json({error:'한 번에 1~16종목을 분석합니다.'},{status:400});
  const s=settings(b?.settings),out:any[]=[];
  for(let i=0;i<stocks.length;i+=4)out.push(...await Promise.all(stocks.slice(i,i+4).map(x=>one(x,s))));
  return NextResponse.json({results:out,settings:s});
}
