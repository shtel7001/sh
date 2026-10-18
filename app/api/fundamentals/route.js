import {NextResponse} from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36';
const raw=x=>{const v=x?.raw??x;if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
const headers={'User-Agent':UA,'Accept':'application/json,text/plain,*/*','Accept-Language':'en-US,en;q=0.9'};
async function session(){
 const r=await fetch('https://fc.yahoo.com',{headers,signal:AbortSignal.timeout(6500),cache:'no-store'});
 const cookies=r.headers.get('set-cookie')||'';
 const cookie=cookies.split(/,(?=\s*[^;,=]+\s*=)/).map(x=>x.trim().split(';')[0]).filter(Boolean).join('; ');
 if(!cookie)throw Error('Yahoo cookie unavailable');
 const cr=await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb',{headers:{...headers,Cookie:cookie},signal:AbortSignal.timeout(6500),cache:'no-store'});
 if(!cr.ok)throw Error('Yahoo crumb HTTP '+cr.status);
 const crumb=(await cr.text()).trim();
 if(!crumb||crumb.startsWith('<'))throw Error('Yahoo crumb invalid');
 return {cookie,crumb};
}
async function yahooSummary(symbol,auth){
 const modules='earningsHistory,earningsTrend,summaryDetail,defaultKeyStatistics,assetProfile,price,quoteType';
 let lastError='';
 for(const host of ['query1','query2']){
  try{
   const url='https://'+host+'.finance.yahoo.com/v10/finance/quoteSummary/'+encodeURIComponent(symbol)+'?modules='+modules+'&crumb='+encodeURIComponent(auth.crumb);
   const r=await fetch(url,{headers:{...headers,Cookie:auth.cookie},signal:AbortSignal.timeout(10000),cache:'no-store'});
   if(!r.ok)throw Error('HTTP '+r.status);
   const j=await r.json();const v=j?.quoteSummary?.result?.[0];
   if(!v)throw Error(j?.quoteSummary?.error?.description||'Yahoo response missing');
   return v;
  }catch(e){lastError=String(e.message||e)}
 }
 throw Error(lastError);
}
function parse(symbol,v){
 const history=[...(v.earningsHistory?.history||[])].filter(x=>raw(x.epsActual)!==null).sort((a,b)=>String(a.quarter||'').localeCompare(String(b.quarter||'')));
 const past=history.at(-1);
 const trend=v.earningsTrend?.trend||[];
 const next=trend.find(x=>x.period==='0q')||trend.find(x=>x.period==='+1q');
 const after=trend.find(x=>x.period==='+1q'&&x!==next)||trend.find(x=>x.period==='+2q');
 const epsActual=raw(past?.epsActual),epsPastEstimate=raw(past?.epsEstimate),epsEstimate=raw(next?.earningsEstimate?.avg),epsNextEstimate=raw(after?.earningsEstimate?.avg);
 const pe=raw(v.summaryDetail?.trailingPE)??raw(v.defaultKeyStatistics?.trailingPE);
 const forwardPe=raw(v.summaryDetail?.forwardPE)??raw(v.defaultKeyStatistics?.forwardPE);
 return {symbol,nameYahoo:v.price?.longName||v.price?.shortName||v.quoteType?.longName||v.quoteType?.shortName||null,sector:v.assetProfile?.sector||null,epsActual,epsPastEstimate,epsEstimate,epsNextEstimate,epsActualPeriod:past?.quarter||null,epsEstimatePeriod:next?.endDate||null,epsNextPeriod:after?.endDate||null,pe,forwardPe,peDrop:pe>0&&forwardPe>0?(1-forwardPe/pe)*100:null,epsGrowth:epsActual>0&&epsEstimate!==null?(epsEstimate/epsActual-1)*100:null,epsSource:'Yahoo Finance',epsError:epsActual===null||epsEstimate===null?'Yahoo 응답에 발표 또는 예상 EPS 필드 없음':null};
}
export async function POST(req){
 try{
  const b=await req.json();
  const symbols=[...new Set((Array.isArray(b.symbols)?b.symbols:[]).filter(x=>typeof x==='string'&&/^[A-Z0-9.-]{1,15}$/.test(x)))].slice(0,12);
  let auth,sessionError;
  try{auth=await session()}catch(e){sessionError=String(e.message||e)}
  const items=await Promise.all(symbols.map(async symbol=>{
   if(!auth)return {symbol,epsSource:'Yahoo Finance',epsActual:null,epsEstimate:null,epsError:'Yahoo 인증 실패: '+sessionError};
   try{return parse(symbol,await yahooSummary(symbol,auth))}
   catch(e){return {symbol,epsSource:'Yahoo Finance',epsActual:null,epsEstimate:null,epsError:'Yahoo 조회 실패: '+String(e.message||e)}}
  }));
  return NextResponse.json({ok:true,source:'Yahoo Finance only',items});
 }catch(e){return NextResponse.json({ok:false,error:String(e.message||e)},{status:500})}
}
