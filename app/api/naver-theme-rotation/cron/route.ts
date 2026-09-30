import { NextRequest,NextResponse } from 'next/server';
import { getDailyThemeRotationAnalysis } from '@/lib/naver-theme-rotation-v2';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(req:NextRequest){
  const auth=req.headers.get('authorization'),secret=process.env.CRON_SECRET,schedule=req.headers.get('x-vercel-cron-schedule');
  const allowed=secret?auth===`Bearer ${secret}`:schedule==='10 22 * * *';
  if(!allowed)return NextResponse.json({ok:false},{status:401});
  try{const r=await getDailyThemeRotationAnalysis();return NextResponse.json({ok:true,asOf:r.asOf,totalThemeCount:r.totalThemeCount});}catch(e){return NextResponse.json({ok:false,message:e instanceof Error?e.message:'cron failed'},{status:500});}
}
