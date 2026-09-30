import { NextRequest, NextResponse } from 'next/server';
import { accessCodeMatches, createThemeValueSession, themeValueCookieMaxAge, themeValueCookieName } from '@/lib/theme-value-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest){
  let code = '';
  try {
    const form = await req.formData();
    code = String(form.get('code') || '').trim();
  } catch {}

  const target = new URL('/theme-value-radar-20261001.html', req.url);

  if(!accessCodeMatches(code)){
    target.searchParams.set('auth', 'bad');
    return NextResponse.redirect(target, 303);
  }

  const token = createThemeValueSession();
  target.searchParams.set('auth', 'ok');
  const res = NextResponse.redirect(target, 303);
  res.cookies.set(themeValueCookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: themeValueCookieMaxAge
  });
  return res;
}
