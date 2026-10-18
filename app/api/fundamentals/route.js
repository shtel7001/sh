import {publicEps} from '../../../lib/public-eps.js';
import {NextResponse} from 'next/server';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const raw=x=>{const v=x?.raw??x;return typeof v==='number'&&Number.isFinite(v)?v:null};
async function fmpEps(symbol){
 const key=process.env.FMP_API_KEY;
 if(!key)return {epsError:'FMP_API_KEY 미등록 (Vercel 환경변수 설정 필요)'};
 try{
  const u=new URL('https://financialmodelingprep.com/stable/earnings');
  u.searchParams.set('symbol',symbol);u.searchParams.set('limit','16');u.searchParams.set('apikey',key);
  const r=await fetch(u,{next:{revalidate:3600},signal:AbortSignal.timeout(8500)});
  if(!r.ok)throw Error('FMP HTTP '+r.status+(r.status===402?' (요금제 접근 제한)':''));
  const j=await r.json();
  if(!Array.isArray(j))throw Error(j?.['Error Message']||j?.message||'FMP 응답 형식 오류');
  const rows=j.filter(x=>x.symbol===symbol&&x.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const past=rows.filter(x=>typeof x.epsActual==='number').at(-1);
  const future=rows.find(x=>x.date>new Date().toISOString().slice(0,10)&&x.epsActual==null&&typeof x.epsEstimated==='number');
  const actual=past?.epsActual??null,estimate=future?.epsEstimated??null;
  return {epsActual:actual,epsEstimate:estimate,epsGrowth:actual>0&&estimate!==null?(estimate/actual-1)*100:null,epsActualPeriod:past?.date||null,epsEstimatePeriod:future?.date||null,epsSource:'FMP',epsNote:'최근 발표 분기와 다음 발표 예정 분기 비교',epsError:actual===null||estimate===null?'발표 또는 향후 예상 EPS 미제공':null};
 }catch(e){return {epsError:'FMP: '+String(e.message||e)}}
}
async function fundamentals(symbol){
 const fmp=await fmpEps(symbol);if(fmp.epsActual!==undefined&&fmp.epsActual!==null&&fmp.epsEstimate!==null)return {symbol,sector:null,...fmp};
 const fallback=await publicEps(symbol);
 if(fallback.epsActual!==null&&fallback.epsEstimate!==null)return {symbol,...fallback};
 const ua={'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'};
 try{
  const cookieRes=await fetch('https://fc.yahoo.com',{headers:ua,signal:AbortSignal.timeout(7000)});
  const cookie=cookieRes.headers.get('set-cookie')?.split(';')[0];
  if(!cookie)throw Error('Yahoo 인증 쿠키 수신 실패');
  const crumbRes=await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb',{headers:{...ua,Cookie:cookie},signal:AbortSignal.timeout(7000)});
  if(!crumbRes.ok)throw Error('Yahoo 인증 토큰 조회 실패');
  const crumb=await crumbRes.text();
  if(!crumb||crumb.startsWith('<'))throw Error('Yahoo 인증 토큰 유효하지 않음');
  const url='https://query2.finance.yahoo.com/v10/finance/quoteSummary/'+encodeURIComponent(symbol)+'?modules=earningsHistory,earningsTrend,earnings,calendarEvents,defaultKeyStatistics,summaryDetail,financialData,assetProfile&crumb='+encodeURIComponent(crumb);
  const r=await fetch(url,{headers:{...ua,Cookie:cookie},signal:AbortSignal.timeout(9000),next:{revalidate:1800}});
  if(!r.ok)throw Error('Yahoo 재무 API HTTP '+r.status);
  const j=await r.json(),v=j.quoteSummary?.result?.[0];
  if(!v)throw Error('EPS 자료 없음');
  const history=v.earningsHistory?.history||[];
  const past=history.filter(x=>raw(x.epsActual)!==null).sort((a,b)=>String(a.quarter||'').localeCompare(String(b.quarter||''))).at(-1);
  const trends=v.earningsTrend?.trend||[];
  const next=trends.find(x=>x.period==='0q'&&raw(x.earningsEstimate?.avg)!==null)||trends.find(x=>x.period==='+1q');
  const reported=raw(past?.epsActual),estimate=raw(next?.earningsEstimate?.avg);
  const growth=reported!==null&&estimate!==null&&reported>0?(estimate/reported-1)*100:null;
  const pastEstimate=raw(past?.epsEstimate);
  const following=trends.find(x=>x.period==='+1q');
  const nextNext=raw(following?.earningsEstimate?.avg);
  const pe=raw(v.summaryDetail?.trailingPE)||raw(v.defaultKeyStatistics?.trailingPE);
  const forwardPe=raw(v.summaryDetail?.forwardPE)||raw(v.defaultKeyStatistics?.forwardPE);
  
  return {symbol,sector:v.assetProfile?.sector||fallback.sector||null,epsActual:reported??fallback.epsActual,epsPastEstimate:pastEstimate??fallback.epsPastEstimate,epsEstimate:estimate??fallback.epsEstimate,epsNextEstimate:nextNext??fallback.epsNextEstimate,epsGrowth:growth??fallback.epsGrowth,epsActualPeriod:past?.quarter||fallback.epsActualPeriod||null,epsEstimatePeriod:next?.endDate||fallback.epsEstimatePeriod||null,epsNextPeriod:following?.endDate||fallback.epsNextPeriod||null,epsSource:'Yahoo Finance',epsMethod:v.earningsHistory?.defaultMethodology||null,epsReportDate:v.calendarEvents?.earnings?.earningsDate?.[0]||null,pe:pe??fallback.pe,forwardPe:forwardPe??fallback.forwardPe,peDrop:pe>0&&forwardPe>0?(1-forwardPe/pe)*100:fallback.peDrop,epsNote:growth===null?'비교 불가':'최근 발표 분기 대비 다음 미발표 분기 예상 EPS 변화율'};
 }catch(e){return {symbol,...fallback,epsError:fallback.epsError||('Yahoo summary: '+String(e.message||e))}}
}
export async function POST(req){
 try{const b=await req.json(),symbols=[...new Set((Array.isArray(b.symbols)?b.symbols:[]).filter(x=>/^[A-Z0-9.-]{1,15}$/.test(x)))].slice(0,12);
 const items=await Promise.all(symbols.map(fundamentals));
 return NextResponse.json({ok:true,items});
 }catch(e){return NextResponse.json({ok:false,error:String(e.message||e)},{status:500})}
}