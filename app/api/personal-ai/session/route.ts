import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  personalAiCookieName,
  verifyPersonalAiSession,
} from '@/lib/personal-ai-auth';

export const runtime = 'nodejs';

export async function GET() {
  const store = await cookies();
  const token = store.get(personalAiCookieName)?.value;
  return NextResponse.json({ authenticated: verifyPersonalAiSession(token) });
}
