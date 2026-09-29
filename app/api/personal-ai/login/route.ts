import { NextResponse } from 'next/server';
import {
  createPersonalAiSession,
  personalAiCookieName,
  personalAiSessionMaxAge,
  verifyPersonalAiAccessCode,
} from '@/lib/personal-ai-auth';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 24) {
    return NextResponse.json(
      { error: '서버 보안키 설정을 확인해야 합니다.' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({ code: '' }));
  if (!verifyPersonalAiAccessCode(body?.code)) {
    return NextResponse.json(
      { error: '개인 인증번호가 올바르지 않습니다.' },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(personalAiCookieName, createPersonalAiSession(), {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: personalAiSessionMaxAge,
  });
  return res;
}
