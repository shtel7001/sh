import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchYahooBars } from '@/lib/market';
export const runtime='nodejs'; export const maxDuration=30;
export async function GET(req:Request){if(!await isAuthed())return unauthorized();const u=new URL(req.url);const code=u.searchParams.get('code')||'';const market=u.searchParams.get('market')==='KOSDAQ'?'KOSDAQ':'KOSPI';if(!/^\d{6}$/.test(code))return NextResponse.json({error:'잘못된 종목코드'},{status:400});try{return NextResponse.json({bars:(await fetchYahooBars(code,market,180)).slice(-120)});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'차트 수집 실패'},{status:502});}}
