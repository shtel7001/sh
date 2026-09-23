import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchCatalyst } from '@/lib/nextday';

export const runtime='nodejs';
export const maxDuration=60;

type Item={code:string;name?:string};
export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  const b=await req.json().catch(()=>({}));
  const stocks:Item[]=Array.isArray(b?.stocks)?b.stocks:[];
  if(!stocks.length||stocks.length>12)return NextResponse.json({error:'한 번에 1~12종목을 전송하세요.'},{status:400});
  const out:any[]=[];
  for(let i=0;i<stocks.length;i+=4){
    out.push(...await Promise.all(stocks.slice(i,i+4).map(async s=>{
      try{return {code:s.code,...await fetchCatalyst(s.code),catalystStatus:'ok'};}
      catch(e){return {code:s.code,catalystScore:0,catalystRisk:0,catalystReasons:[],themes:[],items:[],catalystStatus:'error',error:e instanceof Error?e.message:'뉴스·공시 수집 실패'};}
    })));
  }
  return NextResponse.json({results:out,updatedAt:new Date().toISOString()});
}
