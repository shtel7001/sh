import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchUniverse } from '@/lib/market';
export const runtime='nodejs'; export const maxDuration=60;
export async function GET(){ if(!await isAuthed())return unauthorized(); try{const data=await fetchUniverse();return NextResponse.json({...data,updatedAt:new Date().toISOString()});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'종목목록 수집 실패',stocks:[]},{status:502});}}
