import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchYahooBars, type UniverseStock } from '@/lib/market';
import { backtestBars, currentPriceSignal, signalPerformance, type SpikeThresholds } from '@/lib/scoring';
export const runtime='nodejs'; export const maxDuration=60;

async function one(stock:UniverseStock,period:number,t:SpikeThresholds){
  try{
    const bars=await fetchYahooBars(stock.code,stock.market,Math.max(140,period+30)); const cut=bars.slice(-Math.max(period,65));
    const sig=currentPriceSignal(cut); const hist=bars.slice(-150); const events=backtestBars(hist,t).slice(-5); const stats=signalPerformance(hist,t);
    return {...stock,...sig,sectorScore:null,newsScore:null,supplyScore:null,disclosureScore:null,themeScore:null,detectedAt:new Date().toISOString(),dataStatus:'ok',events,stats};
  }catch(e){return {...stock,dataStatus:'error',error:e instanceof Error?e.message:'가격 수집 실패',events:[]};}
}
export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  const body=await req.json().catch(()=>null); const stocks:UniverseStock[]=body?.stocks||[]; const period=[30,60,90,120].includes(body?.period)?body.period:120;
  const t:SpikeThresholds={d1:Number(body?.thresholds?.d1??5),d3:Number(body?.thresholds?.d3??8),d5:Number(body?.thresholds?.d5??10),d10:Number(body?.thresholds?.d10??15)};
  if(!Array.isArray(stocks)||stocks.length>12)return NextResponse.json({error:'한 번에 최대 12종목까지 분석합니다.'},{status:400});
  const out:any[]=[]; for(let i=0;i<stocks.length;i+=4){out.push(...await Promise.all(stocks.slice(i,i+4).map(s=>one(s,period,t))));}
  return NextResponse.json({results:out});
}
