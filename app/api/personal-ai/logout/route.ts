import { NextResponse } from 'next/server';
import { personalAiCookieName } from '@/lib/personal-ai-auth';

export const runtime = 'nodejs';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(personalAiCookieName, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return res;
}
