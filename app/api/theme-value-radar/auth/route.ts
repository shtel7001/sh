import { NextRequest, NextResponse } from 'next/server';
import { accessCodeMatches, createThemeValueSession, themeValueCookieMaxAge, themeValueCookieName } from '@/lib/theme-value-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req:NextRequest){
  let body:any = {};
  try { body = await req.json(); } catch {}

  if(!accessCodeMatches(body?.code)){
    return NextResponse.json(
      { ok:false, message:'인증번호가 올바르지 않습니다.' },
      { status:401, headers:{ 'Cache-Control':'no-store' } }
    );
  }

  const token = createThemeValueSession();
  const res = NextResponse.json(
    { ok:true, token, expiresIn:themeValueCookieMaxAge },
    { headers:{ 'Cache-Control':'no-store' } }
  );

  res.cookies.set(themeValueCookieName, token, {
    httpOnly:true,
    secure:true,
    sameSite:'lax',
    path:'/',
    maxAge:themeValueCookieMaxAge
  });

  return res;
}
