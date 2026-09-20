import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchCompanyProfile } from '@/lib/market';
import { fetchInfostockThemes } from '@/lib/infostock';
export const runtime='nodejs'; export const maxDuration=60;

async function one(s:{code:string;name?:string}){
  const code=String(s.code||''),name=String(s.name||'');
  const [base,info]=await Promise.all([fetchCompanyProfile(code,name),fetchInfostockThemes(code)]);
  const infoTheme=info.themes.join(' · ');
  return {...base,code,theme:infoTheme||base.theme,themeSource:infoTheme?'인포스탁':'네이버 기업정보 보조',infostockUrl:info.url};
}

export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  const body=await req.json().catch(()=>null);const stocks:Array<{code:string;name?:string}>=body?.stocks||[];
  if(!Array.isArray(stocks)||stocks.length>25)return NextResponse.json({error:'한 번에 최대 25종목까지 조회합니다.'},{status:400});
  const results:any[]=[];
  for(let i=0;i<stocks.length;i+=5)results.push(...await Promise.all(stocks.slice(i,i+5).map(one)));
  return NextResponse.json({results});
}
