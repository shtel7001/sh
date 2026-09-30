import { NextRequest,NextResponse } from 'next/server';
import { isThemeRotationAuthed } from '@/lib/naver-theme-rotation-auth';
import { getDailyThemeRotationAnalysis,runThemeRotationAnalysis } from '@/lib/naver-theme-rotation';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(req:NextRequest){
  if(!isThemeRotationAuthed(req))return NextResponse.json({ok:false,message:'인증이 필요합니다.'},{status:401});
  try{return NextResponse.json(await getDailyThemeRotationAnalysis());}catch(e){return NextResponse.json({ok:false,message:e instanceof Error?e.message:'분석 실패'},{status:500});}
}
export async function POST(req:NextRequest){
  if(!isThemeRotationAuthed(req))return NextResponse.json({ok:false,message:'인증이 필요합니다.'},{status:401});
  let body:any={};try{body=await req.json();}catch{}
  const lookback=Math.max(60,Math.min(240,Number(body?.lookback)||240));
  try{return NextResponse.json(await runThemeRotationAnalysis(lookback));}catch(e){return NextResponse.json({ok:false,message:e instanceof Error?e.message:'분석 실패'},{status:500});}
}
