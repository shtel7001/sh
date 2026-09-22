import {NextResponse} from 'next/server';
import {isAuthed,unauthorized} from '@/lib/guard';
import {fetchUniverse,type Market} from '@/lib/market';
export const runtime='nodejs';export const maxDuration=60;
export async function GET(req:Request){if(!await isAuthed())return unauthorized();try{const u=new URL(req.url),q=u.searchParams.get('market'),only:Market|undefined=q==='KOSPI'||q==='KOSDAQ'?q:undefined;const data=await fetchUniverse(only);return NextResponse.json({...data,counts:{KOSPI:data.stocks.filter(x=>x.market==='KOSPI').length,KOSDAQ:data.stocks.filter(x=>x.market==='KOSDAQ').length},updatedAt:new Date().toISOString()})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'종목목록 수집 실패',stocks:[]},{status:502})}}
