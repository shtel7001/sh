// Independent read-only adapters inspired by the existing EPS radar's public-source approach.
const n=v=>{const x=v&&typeof v==='object'?(v.raw??v.value??v):v;if(x==null)return null;const y=Number(String(x).replace(/[$,%\s,]/g,''));return Number.isFinite(y)?y:null};
const pick=(obj,key)=>{if(!obj||typeof obj!=='object')return null;for(const [k,v] of Object.entries(obj)){if(k===key)return v;if(v&&typeof v==='object'){const t=pick(v,key);if(t!==null)return t}}return null};
const ua={'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36','Accept':'application/json,text/html,*/*','Accept-Language':'en-US,en;q=0.9'};
async function get(url,type='json'){const r=await fetch(url,{headers:{...ua,Referer:'https://www.nasdaq.com/'},signal:AbortSignal.timeout(9500),next:{revalidate:1800}});if(!r.ok)throw Error('HTTP '+r.status);return type==='text'?r.text():r.json()}
function parseEmbedded(html){const results=[];for(const pattern of [/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/g,/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/g]){for(const m of html.matchAll(pattern)){try{results.push(JSON.parse(m[1]))}catch{}}}return results}
export async function publicEps(symbol){
 const sy=symbol.replace(/\./g,'-'),nas=symbol.replace(/\./g,'/'),errors=[];
 const [y,fin,earn]=await Promise.allSettled([
  get('https://finance.yahoo.com/quote/'+encodeURIComponent(sy)+'/analysis/','text'),
  get('https://api.nasdaq.com/api/company/'+encodeURIComponent(nas)+'/financials?frequency=2'),
  get('https://api.nasdaq.com/api/company/'+encodeURIComponent(nas)+'/earnings?limit=8')
 ]);
 for(const [i,x] of [y,fin,earn].entries())if(x.status==='rejected')errors.push(['Yahoo analysis','Nasdaq financials','Nasdaq earnings'][i]+': '+x.reason.message);
 let epsActual=null,epsEstimate=null,epsPastEstimate=null,epsNextEstimate=null,epsActualPeriod=null,epsEstimatePeriod=null,epsNextPeriod=null,pe=null,forwardPe=null,sector=null;
 if(y.status==='fulfilled'){
  const html=y.value,objects=parseEmbedded(html);
  const findTrend=o=>{const t=pick(o,'earningsTrend');return Array.isArray(t?.trend)?t.trend:Array.isArray(t)?t:null};
  const findHistory=o=>{const h=pick(o,'earningsHistory');return Array.isArray(h?.history)?h.history:Array.isArray(h)?h:null};
  for(const o of objects){const h=findHistory(o)||[],t=findTrend(o)||[];const past=h.filter(x=>n(x.epsActual)!==null).at(-1),next=t.find(x=>x.period==='0q'),after=t.find(x=>x.period==='+1q');
   epsActual??=n(past?.epsActual);epsPastEstimate??=n(past?.epsEstimate);epsActualPeriod??=past?.quarter||null;epsEstimate??=n(next?.earningsEstimate?.avg);epsEstimatePeriod??=next?.endDate||null;epsNextEstimate??=n(after?.earningsEstimate?.avg);epsNextPeriod??=after?.endDate||null;
   pe??=n(pick(o,'trailingPE'));forwardPe??=n(pick(o,'forwardPE'));sector??=pick(o,'sector')||null;
  }
  // Yahoo often embeds quoted JSON in HTML instead of a dedicated script.
  const extract=k=>{const m=html.match(new RegExp('["\\\\]*'+k+'["\\\\]*\\s*:\\s*\\{?\\s*["\\\\]*raw["\\\\]*\\s*:\\s*(-?[0-9.]+)'));return m?n(m[1]):null};
  pe??=extract('trailingPE');forwardPe??=extract('forwardPE');
 }
 if(earn.status==='fulfilled'){
  const d=earn.value?.data||{},rows=d?.earnings?.rows||d?.earningsData||d?.rows||[];
  if(Array.isArray(rows)){const parsed=rows.map(x=>({date:x.date||x.fiscalQuarterEnding||x.period,actual:n(x.epsActual??x.actualEPS??x.eps),estimate:n(x.epsForecast??x.estimatedEPS??x.consensusEPS)}));
   const reported=parsed.filter(x=>x.actual!==null).at(-1),future=parsed.find(x=>x.actual===null&&x.estimate!==null);
   epsActual??=reported?.actual??null;epsPastEstimate??=reported?.estimate??null;epsActualPeriod??=reported?.date??null;epsEstimate??=future?.estimate??null;epsEstimatePeriod??=future?.date??null;
  }
 }
 if(fin.status==='fulfilled'){const d=fin.value?.data||{};const entries=JSON.stringify(d);const m=entries.match(/"operatingIncome"\s*:\s*"?([\d,.]+)"?/i);const op=m?n(m[1]):null;return {epsActual,epsPastEstimate,epsEstimate,epsNextEstimate,epsActualPeriod,epsEstimatePeriod,epsNextPeriod,pe,forwardPe,peDrop:pe>0&&forwardPe>0?(1-forwardPe/pe)*100:null,epsGrowth:epsActual>0&&epsEstimate!==null?(epsEstimate/epsActual-1)*100:null,operatingIncome:op,sector,epsSource:[y.status==='fulfilled'?'Yahoo Finance':null,earn.status==='fulfilled'?'Nasdaq':null].filter(Boolean).join(' + ')||'조회 실패',epsError:epsActual===null&&epsEstimate===null?errors.join(' / ')||'공개 응답에 EPS 수치 없음':null}}
 return {epsActual,epsPastEstimate,epsEstimate,epsNextEstimate,epsActualPeriod,epsEstimatePeriod,epsNextPeriod,pe,forwardPe,peDrop:pe>0&&forwardPe>0?(1-forwardPe/pe)*100:null,epsGrowth:epsActual>0&&epsEstimate!==null?(epsEstimate/epsActual-1)*100:null,sector,epsSource:[y.status==='fulfilled'?'Yahoo Finance':null,earn.status==='fulfilled'?'Nasdaq':null].filter(Boolean).join(' + ')||'조회 실패',epsError:epsActual===null&&epsEstimate===null?errors.join(' / ')||'공개 응답에 EPS 수치 없음':null};
}