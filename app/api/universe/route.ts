import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchKosdaqUniverse } from '@/lib/kosdaqUniverse';
export const runtime='nodejs'; export const maxDuration=60;
export async function GET(){
  if(!await isAuthed())return unauthorized();
  try{const data=await fetchKosdaqUniverse();return NextResponse.json({...data,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store, max-age=0'}});}
  catch(e){return NextResponse.json({error:e instanceof Error?e.message:'KOSDAQ 종목목록 수집 실패',stocks:[]},{status:502});}
}
