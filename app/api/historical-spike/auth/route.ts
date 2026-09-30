import { NextRequest, NextResponse } from 'next/server';
import { accessCodeMatches, createHistoricalSession, historicalCookieMaxAge, historicalCookieName, isHistoricalAuthed } from '@/lib/historical-spike-auth';
export const runtime='nodejs';
export async function GET(req:NextRequest){ return NextResponse.json({ok:true,authenticated:isHistoricalAuthed(req)}); }
export async function POST(req:NextRequest){
  if(!process.env.SESSION_SECRET) return NextResponse.json({ok:false,error:'SESSION_SECRET_MISSING'},{status:503});
  const body=await req.json().catch(()=>({}));
  if(!accessCodeMatches(String(body?.code||''))) return NextResponse.json({ok:false,error:'INVALID_CODE'},{status:401});
  const res=NextResponse.json({ok:true,authenticated:true});
  res.cookies.set(historicalCookieName,createHistoricalSession(),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:historicalCookieMaxAge});
  return res;
}
