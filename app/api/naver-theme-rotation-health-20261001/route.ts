import { NextResponse } from 'next/server';
import { runThemeRotationAnalysis } from '@/lib/naver-theme-rotation-v2';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(){
  try{
    const r=await runThemeRotationAnalysis(60);
    return NextResponse.json({ok:r.ok,totalThemeCount:r.totalThemeCount,top30:r.top30.length,selected5:r.selected5.length,final20:r.final20.length,firstThemes:r.top30.slice(0,3).map(x=>x.name)});
  }catch(e){return NextResponse.json({ok:false,message:e instanceof Error?e.message:'health failed'},{status:500});}
}
