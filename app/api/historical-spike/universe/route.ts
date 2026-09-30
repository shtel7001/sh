import { NextRequest, NextResponse } from 'next/server';
import { isHistoricalAuthed } from '@/lib/historical-spike-auth';
import { jfetch, num } from '@/lib/historical-spike-naver';
export const runtime='nodejs'; export const maxDuration=30;
async function fetchMarket(market:'KOSPI'|'KOSDAQ',limit:number){
  const out:any[]=[];
  for(let page=1;out.length<limit&&page<=8;page++){
    let data:any;
    try{data=await jfetch(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`,12000);}
    catch{data=await jfetch(`https://m.stock.naver.com/api/stock/domestic/stockList?sortType=marketValue&category=${market}&page=${page}&pageSize=100`,12000);}
    const rows=data?.stocks||data?.stockList||data?.result||(Array.isArray(data)?data:[]);
    if(!Array.isArray(rows)||!rows.length) break;
    for(const r of rows){
      const code=r.itemCode||r.code||r.stockCode, name=r.stockName||r.name||r.itemName;
      if(!code||!name) continue;
      out.push({code:String(code),name:String(name),market,rank:out.length+1,currentPrice:num(r.closePrice??r.currentPrice??r.nv),currentChange:num(r.fluctuationsRatio??r.changeRate??r.cr),marketValueRaw:r.marketValue??r.marketCap??r.mks??null,marketValue:num(r.marketValue??r.marketCap??r.mks)});
      if(out.length>=limit) break;
    }
    if(rows.length<50) break;
  }
  return out.slice(0,limit);
}
export async function GET(req:NextRequest){
  if(!isHistoricalAuthed(req)) return NextResponse.json({ok:false,error:'AUTH_REQUIRED'},{status:401});
  try{const [kospi,kosdaq]=await Promise.all([fetchMarket('KOSPI',500),fetchMarket('KOSDAQ',300)]);return NextResponse.json({ok:true,kospi,kosdaq,counts:{kospi:kospi.length,kosdaq:kosdaq.length}},{headers:{'Cache-Control':'private, max-age=1800'}});}catch(e:any){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500});}
}
