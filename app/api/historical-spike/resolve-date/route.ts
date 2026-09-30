import { NextRequest, NextResponse } from 'next/server';
import { isHistoricalAuthed } from '@/lib/historical-spike-auth';
import { estimatedPage, jfetch, within240 } from '@/lib/historical-spike-naver';
export const runtime='nodejs';
export async function GET(req:NextRequest){
  if(!isHistoricalAuthed(req)) return NextResponse.json({ok:false,error:'AUTH_REQUIRED'},{status:401});
  const date=req.nextUrl.searchParams.get('date')||''; if(!within240(date)) return NextResponse.json({ok:false,error:'DATE_OUT_OF_RANGE'},{status:400});
  const guess=estimatedPage(date,60),pages=[...new Set([guess,guess-1,guess+1,guess-2,guess+2].filter(x=>x>0&&x<=6))]; let best:string|null=null;
  for(const p of pages){try{const arr=await jfetch(`https://m.stock.naver.com/api/index/KOSPI/price?pageSize=60&page=${p}`,10000);if(!Array.isArray(arr))continue;const exact=arr.find((x:any)=>x.localTradedAt===date);if(exact)return NextResponse.json({ok:true,requested:date,resolved:date,adjusted:false});for(const x of arr){if(x.localTradedAt<date&&(!best||x.localTradedAt>best))best=x.localTradedAt;}}catch{}}
  return best?NextResponse.json({ok:true,requested:date,resolved:best,adjusted:true}):NextResponse.json({ok:false,error:'DATE_NOT_FOUND'},{status:404});
}
