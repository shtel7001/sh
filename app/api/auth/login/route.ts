import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createSessionToken, sessionCookieName, sessionMaxAge } from '@/lib/auth';

export const runtime='nodejs';
export async function POST(req:Request){
  const expected=process.env.RADAR_PASSWORD;
  const secret=process.env.SESSION_SECRET;
  if(!expected||!secret||secret.length<24) return NextResponse.json({error:'서버 환경변수 RADAR_PASSWORD / SESSION_SECRET 설정이 필요합니다.'},{status:503});
  const {password}=await req.json().catch(()=>({password:''}));
  const a=Buffer.from(String(password||'')),b=Buffer.from(expected);
  const ok=a.length===b.length && crypto.timingSafeEqual(a,b);
  if(!ok)return NextResponse.json({error:'비밀번호가 올바르지 않습니다.'},{status:401});
  const res=NextResponse.json({ok:true});
  res.cookies.set(sessionCookieName,createSessionToken(),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:sessionMaxAge});
  return res;
}
