import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchYahooBars, type UniverseStock } from '@/lib/market';
import { currentAccumulationSignal } from '@/lib/scoring';

export const runtime='nodejs';
export const maxDuration=60;

async function one(stock:UniverseStock,period:number){
  try{
    const bars=await fetchYahooBars(stock.code,stock.market,Math.max(140,period+30));
    const cut=bars.slice(-Math.max(period,70));
    const sig=currentAccumulationSignal(cut);
    return {
      ...stock,
      ...sig,
      flowScore:null,
      flowReasons:[],
      detectedAt:new Date().toISOString(),
      dataStatus:'ok'
    };
  }catch(e){
    return {
      ...stock,
      dataStatus:'error',
      error:e instanceof Error?e.message:'가격 수집 실패'
    };
  }
}

export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  const body=await req.json().catch(()=>null);
  const stocks:UniverseStock[]=body?.stocks||[];
  const period=[60,90,120,180].includes(body?.period)?body.period:120;
  if(!Array.isArray(stocks)||stocks.length>12){
    return NextResponse.json({error:'한 번에 최대 12종목까지 분석합니다.'},{status:400});
  }
  const out:any[]=[];
  for(let i=0;i<stocks.length;i+=4){
    out.push(...await Promise.all(stocks.slice(i,i+4).map(s=>one(s,period))));
  }
  return NextResponse.json({results:out});
}
