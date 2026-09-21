import {NextResponse} from 'next/server';
import {isAuthed,unauthorized} from '@/lib/guard';
import {fetchCompanyProfile} from '@/lib/market';
export const runtime='nodejs';export const maxDuration=60;
export async function POST(req:Request){if(!await isAuthed())return unauthorized();const body=await req.json().catch(()=>null),stocks:Array<{code:string;name?:string}>=body?.stocks||[];if(!Array.isArray(stocks)||stocks.length>30)return NextResponse.json({error:'한 번에 최대 30종목'},{status:400});const results:any[]=[];for(let i=0;i<stocks.length;i+=6)results.push(...await Promise.all(stocks.slice(i,i+6).map(s=>fetchCompanyProfile(String(s.code||''),String(s.name||'')))));return NextResponse.json({results});}
