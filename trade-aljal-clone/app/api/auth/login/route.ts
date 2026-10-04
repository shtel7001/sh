import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { createSessionToken, sessionCookieName, sessionMaxAge } from '../../../../lib/auth';

export const runtime = 'nodejs';

export async function POST(req:Request) {
  const expected = process.env.RADAR_PASSWORD || '';
  const secret = process.env.SESSION_SECRET || '';
  if (!expected || secret.length < 24) {
    return NextResponse.json({error:'서버 인증 환경변수가 설정되지 않았습니다.'},{status:503});
  }
  const body = await req.json().catch(()=>({password:''}));
  const value = String(body?.password || '');
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a,b);
  if (!ok) return NextResponse.json({error:'인증번호가 올바르지 않습니다.'},{status:401});

  const res = NextResponse.json({ok:true});
  res.cookies.set(sessionCookieName, createSessionToken(), {
    httpOnly:true,
    secure:true,
    sameSite:'lax',
    path:'/',
    maxAge:sessionMaxAge,
  });
  return res;
}
