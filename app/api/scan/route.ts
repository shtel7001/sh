import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchYahooBars, type UniverseStock } from '@/lib/market';
export const runtime='nodejs'; export const maxDuration=60;

type Hit={date:string;previousClose:number;close:number;risePct:number;volume:number};
async function one(stock:UniverseStock,period:number,threshold:number,startDate?:string,endDate?:string){
  try{
    const bars=await fetchYahooBars(stock.code,stock.market,520);
    const ranged=bars.filter(b=>(!startDate||b.date>=startDate)&&(!endDate||b.date<=endDate)).slice(-period);
    const dates=new Set(ranged.map(b=>b.date));const hits:Hit[]=[];
    for(let i=1;i<bars.length;i++){
      const b=bars[i],p=bars[i-1];if(!dates.has(b.date)||!p.close)continue;
      const rise=(b.close-p.close)/p.close*100;
      if(rise>=threshold)hits.push({date:b.date,previousClose:p.close,close:b.close,risePct:rise,volume:b.volume});
    }
    const last=bars.at(-1)!;const maxRisePct=hits.length?Math.max(...hits.map(h=>h.risePct)):0;
    return {...stock,currentClose:last.close,currentDate:last.date,scannedDays:ranged.length,hits,hitCount:hits.length,maxRisePct,latestHitDate:hits.at(-1)?.date||null,matched:hits.length>0,dataStatus:'ok'};
  }catch(e){return {...stock,matched:false,dataStatus:'error',error:e instanceof Error?e.message:'가격 수집 실패',hits:[],hitCount:0,maxRisePct:0};}
}
export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  const body=await req.json().catch(()=>null);const stocks:UniverseStock[]=body?.stocks||[];
  const period=Math.max(1,Math.min(240,Number(body?.period??60)));const threshold=Math.max(1,Math.min(30,Number(body?.threshold??7)));
  const startDate=typeof body?.startDate==='string'?body.startDate:undefined,endDate=typeof body?.endDate==='string'?body.endDate:undefined;
  if(!Array.isArray(stocks)||stocks.length>30)return NextResponse.json({error:'한 번에 최대 30종목까지 분석합니다.'},{status:400});
  const out:any[]=[];for(let i=0;i<stocks.length;i+=6)out.push(...await Promise.all(stocks.slice(i,i+6).map(s=>one(s,period,threshold,startDate,endDate))));
  return NextResponse.json({results:out,period,threshold,startDate,endDate});
}
