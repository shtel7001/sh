import {NextResponse} from 'next/server';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const raw=x=>{const v=x?.raw??x;return typeof v==='number'&&Number.isFinite(v)?v:null};
async function fundamentals(symbol){
 const ua={'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'};
 try{
  const cookieRes=await fetch('https://fc.yahoo.com',{headers:ua,signal:AbortSignal.timeout(7000)});
  const cookie=cookieRes.headers.get('set-cookie')?.split(';')[0];
  if(!cookie)throw Error('Yahoo 인증 쿠키 수신 실패');
  const crumbRes=await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb',{headers:{...ua,Cookie:cookie},signal:AbortSignal.timeout(7000)});
  if(!crumbRes.ok)throw Error('Yahoo 인증 토큰 조회 실패');
  const crumb=await crumbRes.text();
  if(!crumb||crumb.startsWith('<'))throw Error('Yahoo 인증 토큰 유효하지 않음');
  const url='https://query2.finance.yahoo.com/v10/finance/quoteSummary/'+encodeURIComponent(symbol)+'?modules=earningsHistory,earningsTrend,assetProfile&crumb='+encodeURIComponent(crumb);
  const r=await fetch(url,{headers:{...ua,Cookie:cookie},signal:AbortSignal.timeout(9000),next:{revalidate:1800}});
  if(!r.ok)throw Error('Yahoo 재무 API HTTP '+r.status);
  const j=await r.json(),v=j.quoteSummary?.result?.[0];
  if(!v)throw Error('EPS 자료 없음');
  const history=v.earningsHistory?.history||[];
  const past=history.filter(x=>raw(x.epsActual)!==null).at(-1);
  const trends=v.earningsTrend?.trend||[];
  const next=trends.find(x=>x.period==='0q')||trends.find(x=>x.period==='+1q');
  const reported=raw(past?.epsActual),estimate=raw(next?.earningsEstimate?.avg);
  const growth=reported!==null&&estimate!==null&&reported>0?(estimate/reported-1)*100:null;
  return {symbol,sector:v.assetProfile?.sector||null,epsActual:reported,epsEstimate:estimate,epsGrowth:growth,epsActualPeriod:past?.quarter||null,epsEstimatePeriod:next?.endDate||null,epsNote:growth===null?'비교 불가':'최근 발표 분기 대비 다음 미발표 분기 예상 EPS 변화율'};
 }catch(e){return {symbol,sector:null,epsActual:null,epsEstimate:null,epsGrowth:null,epsError:String(e.message||e)}}
}
export async function POST(req){
 try{const b=await req.json(),symbols=[...new Set((Array.isArray(b.symbols)?b.symbols:[]).filter(x=>/^[A-Z0-9.-]{1,15}$/.test(x)))].slice(0,12);
 const items=await Promise.all(symbols.map(fundamentals));
 return NextResponse.json({ok:true,items});
 }catch(e){return NextResponse.json({ok:false,error:String(e.message||e)},{status:500})}
}