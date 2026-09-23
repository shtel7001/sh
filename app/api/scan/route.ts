import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import type { UniverseStock } from '@/lib/market';
import { analyzeTechnical, fetchDailyBars, type RadarParams } from '@/lib/nextday';

export const runtime='nodejs';
export const maxDuration=60;

function params(x:any):RadarParams{return {
  lookback:Math.max(5,Math.min(40,Number(x?.lookback??15))),
  spikePct:Math.max(2,Math.min(20,Number(x?.spikePct??7))),
  spikeVolRatio:Math.max(1.2,Math.min(10,Number(x?.spikeVolRatio??2.5))),
  pullbackMaxDays:Math.max(1,Math.min(12,Number(x?.pullbackMaxDays??6))),
  ma20Distance:Math.max(2,Math.min(20,Number(x?.ma20Distance??8))),
  maxTodayRise:Math.max(1,Math.min(15,Number(x?.maxTodayRise??6))),
  minTechScore:Math.max(0,Math.min(70,Number(x?.minTechScore??28)))
}}
async function one(stock:UniverseStock,p:RadarParams){
  try{
    const bars=await fetchDailyBars(stock.code,stock.market,180);
    const r=analyzeTechnical(stock,bars,p);
    return {...r,dataStatus:'ok'};
  }catch(e){return {...stock,technicalScore:0,dataStatus:'error',error:e instanceof Error?e.message:'가격 수집 실패'};}
}
export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  const b=await req.json().catch(()=>({}));
  const stocks:UniverseStock[]=Array.isArray(b?.stocks)?b.stocks:[];
  if(!stocks.length||stocks.length>30)return NextResponse.json({error:'한 번에 1~30종목을 전송하세요.'},{status:400});
  const p=params(b?.params);const out:any[]=[];
  for(let i=0;i<stocks.length;i+=8)out.push(...await Promise.all(stocks.slice(i,i+8).map(s=>one(s,p))));
  return NextResponse.json({results:out,params:p});
}
