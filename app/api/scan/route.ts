import {NextResponse} from 'next/server';
import {isAuthed,unauthorized} from '@/lib/guard';
import {fetchYahooBars,fetchYahoo30m,type UniverseStock} from '@/lib/market';
import {analyzeDaily,analyze30m,type Settings} from '@/lib/rebound';
export const runtime='nodejs';export const maxDuration=60;

async function one(stock:UniverseStock,s:Settings){
 try{
  const dailyBars=await fetchYahooBars(stock.code,120);
  const daily=analyzeDaily(dailyBars,s);
  if(!daily.pass)return{...stock,dataStatus:'ok',match:false,daily,intraday:null,score:daily.score||0};
  const intraday=analyze30m(await fetchYahoo30m(stock.code),s);
  const match=!!intraday.pass;const score=Math.round(((daily.score||0)*0.6+(intraday.score||0)*0.4)*10)/10;
  return{...stock,currentPrice:daily.close??stock.currentPrice,dataStatus:'ok',match,daily,intraday,score,reasons:[...(daily.reasons||[]),...(intraday.reasons||[])],chartBars:match?dailyBars.slice(-60):[]};
 }catch(e){return{...stock,dataStatus:'error',match:false,error:e instanceof Error?e.message:'분석 실패',score:0}}
}
export async function POST(req:Request){
 if(!await isAuthed())return unauthorized();
 const b=await req.json().catch(()=>null);const stocks:UniverseStock[]=Array.isArray(b?.stocks)?b.stocks:[];
 if(!stocks.length||stocks.length>16)return NextResponse.json({error:'한 번에 1~16종목을 분석합니다.'},{status:400});
 const s:Settings={maxBelowDays:Math.min(5,Math.max(1,Number(b?.settings?.maxBelowDays??3))),gapPct:Math.min(5,Math.max(.5,Number(b?.settings?.gapPct??2.5))),ma20CompareDays:Math.min(20,Math.max(3,Number(b?.settings?.ma20CompareDays??8))),supportTolPct:Math.min(4,Math.max(.3,Number(b?.settings?.supportTolPct??1.5))),bottomTolPct:Math.min(5,Math.max(.5,Number(b?.settings?.bottomTolPct??2)))};
 const out:any[]=[];for(let i=0;i<stocks.length;i+=8)out.push(...await Promise.all(stocks.slice(i,i+8).map(x=>one(x,s))));
 return NextResponse.json({results:out,settings:s});
}
