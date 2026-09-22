import {NextResponse} from 'next/server';
import {isAuthed,unauthorized} from '@/lib/guard';
import {fetchDailyBars,type UniverseStock} from '@/lib/market';
import {analyzeDaily,type Settings} from '@/lib/pattern';
export const runtime='nodejs';
export const maxDuration=60;

const clamp=(v:unknown,min:number,max:number,fallback:number)=>Math.min(max,Math.max(min,Number.isFinite(Number(v))?Number(v):fallback));
function settings(x:any):Settings{return{
  searchDays:clamp(x?.searchDays,1,240,20),
  downtrendDays:clamp(x?.downtrendDays,30,240,150),
  near20Pct:clamp(x?.near20Pct,.5,15,3),
  minDeclinePct:clamp(x?.minDeclinePct,0,60,8),
  minNegativeMa20Ratio:clamp(x?.minNegativeMa20Ratio,30,95,55),
  minDowntrendR2:clamp(x?.minDowntrendR2,0,.9,.12),
  requireStepDown:x?.requireStepDown!==false,
  requireMa5Above20Now:x?.requireMa5Above20Now!==false
}}

async function one(stock:UniverseStock,s:Settings){
  try{
    const need=Math.min(560,Math.max(220,Math.ceil(s.searchDays+s.downtrendDays+45)));
    const fetched=await fetchDailyBars(stock.code,stock.market,'yahoo',need);
    const daily=analyzeDaily(fetched.bars,s);
    return {...stock,currentPrice:daily.close??stock.currentPrice,dataStatus:'ok',match:!!daily.pass,daily,score:daily.score||0,source:fetched.source,reasons:daily.reasons||[],chartBars:daily.pass?fetched.bars.slice(-Math.min(260,Math.max(100,s.searchDays+40))):[]};
  }catch(e){return {...stock,dataStatus:'error',match:false,error:e instanceof Error?e.message:'분석 실패',score:0}}
}

export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  const b=await req.json().catch(()=>null),stocks:UniverseStock[]=Array.isArray(b?.stocks)?b.stocks:[];
  if(!stocks.length||stocks.length>20)return NextResponse.json({error:'한 번에 1~20종목을 분석합니다.'},{status:400});
  const s=settings(b?.settings),out:any[]=[];
  for(let i=0;i<stocks.length;i+=5)out.push(...await Promise.all(stocks.slice(i,i+5).map(x=>one(x,s))));
  return NextResponse.json({results:out,settings:s});
}
