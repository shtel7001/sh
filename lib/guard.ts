import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionCookieName, verifySession } from './auth';
export async function isAuthed(){
  const jar = await cookies();
  return verifySession(jar.get(sessionCookieName)?.value);
}
export async function unauthorized(){
  return NextResponse.json({error:'인증이 필요합니다.'},{status:401});
}
