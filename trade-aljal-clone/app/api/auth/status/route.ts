import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionCookieName, verifySession } from '../../../../lib/auth';

export async function GET() {
  const jar = await cookies();
  const ok = verifySession(jar.get(sessionCookieName)?.value);
  return NextResponse.json({ok});
}
