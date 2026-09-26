import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const SCOPE='dead-golden-6020-radar-v1';
const marketCache=new Map<string,{time:number,data:any[]}>();
const CACHE_TTL=60*60*1000;

function secret(){return process.env.SESSION_SECRET||''}
function sign(payload:string){return crypto.createHmac('sha256',`${secret()}:${SCOPE}`).update(payload).digest('base64url')}
function createToken(){const p=`${SCOPE}.${crypto.randomBytes(18).toString('base64url')}`;return `${p}.${sign(p)}`}
function requestToken(req:Request){return req.headers.get('x-auth-token')||(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'')}
function validToken(token?:string|null){if(!token||!secret())return false;const i=token.lastIndexOf('.');if(i<0)return false;const p=token.slice(0,i),s=token.slice(i+1);if(!p.startsWith(`${SCOPE}.`))return false;const e=sign(p);if(s.length!==e.length)return false;try{return crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e))}catch{return false}}
function validPassword(v:string){const expected=process.env.RADAR_PASSWORD||'';if(!expected||!secret())return false;const a=Buffer.from(String(v||'')),b=Buffer.from(expected);return a.length===b.length&&crypto.timingSafeEqual(a,b)}
function unauthorized(){return NextResponse.json({error:'UNAUTHORIZED'},{status:401})}
async function fetchJson(url:string,timeoutMs=10000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{signal:c.signal,cache:'no-store',headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/plain,*/*','Referer':'https://m.stock.naver.com/'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json()}finally{clearTimeout(t)}}
function n(v:any){return typeof v==='number'?v:Number(String(v??'').replace(/,/g,''))}
function ymd(d:Date){return d.toISOString().slice(0,10).replace(/-/g,'')}
function dt(s:string){const d=new Date(`${s}T00:00:00+09:00`);return isNaN(d.getTime())?null:d}
function dtext(v:string){return v?String(v).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):''}
function round(v:number,p=2){const m=10**p;return Math.round(v*m)/m}
function sma(a:number[],w:number,i:number){if(i<w-1)return null;let s=0;for(let k=i-w+1;k<=i;k++)s+=a[k];return s/w}

async function loadMarket(market:'KOSPI'|'KOSDAQ'){
  const c=marketCache.get(market);if(c&&Date.now()-c.time<CACHE_TTL)return c.data;
  const requestedSize=100,base=`https://m.stock.naver.com/api/stocks/marketValue/${market}`;
  const first=await fetchJson(`${base}?page=1&pageSize=${requestedSize}`,9000),a1=first.stocks||first.result||first.items||[];
  const pageSize=Math.max(1,a1.length||20),total=Number(first.totalCount||first.total||a1.length)||a1.length,pages=Math.max(1,Math.ceil(total/pageSize));let all:any[]=[...a1];
  for(let p=2;p<=pages;p+=5){const ps=Array.from({length:Math.min(5,pages-p+1)},(_,i)=>p+i);const rr=await Promise.allSettled(ps.map(x=>fetchJson(`${base}?page=${x}&pageSize=${pageSize}`,9000)));for(const r of rr)if(r.status==='fulfilled')all.push(...(r.value.stocks||r.value.result||r.value.items||[]))}
  const seen=new Set<string>(),out:any[]=[];for(const s of all){const raw=String(s.itemCode||s.code||'').replace(/\D/g,''),code=raw.padStart(6,'0'),name=s.stockName||s.name||s.itemName||'';if(/^\d{6}$/.test(code)&&name&&!seen.has(code)){seen.add(code);out.push({code,name,market,price:n(s.closePrice||s.now||0)||null,marketValue:s.marketValue||s.marketCap||null})}}
  marketCache.set(market,{time:Date.now(),data:out});return out;
}

type Row={date:string;open:number;high:number;low:number;close:number;volume:number;ma5?:number|null;ma20?:number|null;ma60?:number|null};
type Cfg={start:string;end:string;minGapMonths:number;maxGapMonths:number;resistancePct:number;supportPct:number;minDropPct:number;supportLookback:number};
function chartRows(j:any){const raw=j.priceInfos||j.prices||j.result||j.items||j.chartData||[],out:Row[]=[];for(const x of raw){const date=String(x.localDate||x.date||x.tradeDate||'').replace(/\D/g,'').slice(0,8),close=n(x.closePrice??x.close??x.nv),high=n(x.highPrice??x.high??close),low=n(x.lowPrice??x.low??close),open=n(x.openPrice??x.open??close),volume=n(x.accumulatedTradingVolume??x.volume??0);if(/^\d{8}$/.test(date)&&isFinite(close)&&close>0)out.push({date,open,high,low,close,volume:isFinite(volume)?volume:0})}out.sort((a,b)=>a.date.localeCompare(b.date));return out}
function detect(rows:Row[],cfg:Cfg){
  if(rows.length<90)return null;const closes=rows.map(x=>x.close);for(let i=0;i<rows.length;i++){rows[i].ma5=sma(closes,5,i);rows[i].ma20=sma(closes,20,i);rows[i].ma60=sma(closes,60,i)}
  const endY=cfg.end.replace(/-/g,''),startY=cfg.start.replace(/-/g,'');let last=rows.length-1;while(last>0&&rows[last].date>endY)last--;if(rows[last].date<startY)return null;
  const deads:number[]=[],golds:number[]=[];for(let i=1;i<=last;i++){const p=rows[i-1],c=rows[i];if([p.ma5,p.ma20,c.ma5,c.ma20].some(v=>v==null))continue;if((p.ma5 as number)>=(p.ma20 as number)&&(c.ma5 as number)<(c.ma20 as number))deads.push(i);if((p.ma5 as number)<=(p.ma20 as number)&&(c.ma5 as number)>(c.ma20 as number)&&c.date>=startY&&c.date<=endY)golds.push(i)}if(!deads.length||!golds.length)return null;
  const minDays=cfg.minGapMonths*30.44,maxDays=cfg.maxGapMonths*30.44;let best:any=null;
  for(const gi of golds){let di=-1,gap=0;for(let k=deads.length-1;k>=0;k--){if(deads[k]>=gi)continue;const a=dt(dtext(rows[deads[k]].date)),b=dt(dtext(rows[gi].date));if(!a||!b)continue;const days=(b.getTime()-a.getTime())/86400000;if(days>=minDays&&days<=maxDays){di=deads[k];gap=days;break}}if(di<0)continue;
    let ri=-1,rd=999;for(let i=gi+1;i<=last;i++){const r=rows[i];if(!r.ma60)continue;const dist=Math.abs((r.high-r.ma60)/r.ma60*100),pr=rows[Math.max(0,i-1)];const below=r.close<=r.ma60*(1+cfg.resistancePct/100)&&(!pr.ma60||pr.close<pr.ma60*1.02);if(below&&dist<=cfg.resistancePct&&dist<rd){ri=i;rd=dist}}if(ri<0||ri>=last)continue;
    let si=-1,sd=999;for(let i=Math.max(ri+1,last-cfg.supportLookback+1);i<=last;i++){const r=rows[i];if(!r.ma20)continue;const dist=Math.abs((r.close-r.ma20)/r.ma20*100),touch=r.low<=r.ma20*(1+cfg.supportPct/100)&&r.close>=r.ma20*(1-cfg.supportPct/100);if(touch&&dist<=cfg.supportPct&&dist<sd){si=i;sd=dist}}if(si<0)continue;
    const rr=rows[ri],cur=rows[last];if(!cur.ma20||!cur.ma60)continue;const low=Math.min(...rows.slice(ri+1,last+1).map(x=>x.low)),drop=(low-rr.high)/rr.high*100;if(drop>-cfg.minDropPct)continue;const d20=(cur.close-cur.ma20)/cur.ma20*100,d60=(cur.close-cur.ma60)/cur.ma60*100,b20=last>=5?rows[last-5].ma20:null,slope=b20?(cur.ma20-b20)/b20*100:0,recent=rows.slice(Math.max(0,last-19),last+1),v20=recent.reduce((s,x)=>s+x.volume,0)/recent.length,vr=v20?cur.volume/v20:1;
    let score=Math.max(0,30-sd*8)+Math.max(0,24-rd*6)+Math.min(18,Math.max(0,(-drop-cfg.minDropPct)*2+8))+Math.max(0,Math.min(16,8+slope*6))+Math.max(0,Math.min(12,(1.3-vr)*15));score=Math.round(Math.min(100,score));
    const hit={score,deadDate:dtext(rows[di].date),goldenDate:dtext(rows[gi].date),resistanceDate:dtext(rr.date),supportDate:dtext(rows[si].date),gapMonths:round(gap/30.44,1),close:cur.close,ma5:round(cur.ma5 as number,2),ma20:round(cur.ma20,2),ma60:round(cur.ma60,2),dist20:round(d20,2),dist60:round(d60,2),resistanceDist:round(rd,2),dropPct:round(drop,2),slope20:round(slope,2),volumeRatio:round(vr,2),lastDate:dtext(cur.date),chart:rows.slice(Math.max(0,last-130),last+1).map(x=>({date:dtext(x.date),close:x.close,ma5:x.ma5?round(x.ma5,2):null,ma20:x.ma20?round(x.ma20,2):null,ma60:x.ma60?round(x.ma60,2):null}))};if(!best||hit.score>best.score)best=hit;
  }return best;
}
async function scanOne(s:any,cfg:Cfg){try{const start=dt(cfg.start),end=dt(cfg.end);if(!start||!end)return null;const fs=new Date(start);fs.setMonth(fs.getMonth()-cfg.maxGapMonths-3);const url=`https://api.stock.naver.com/chart/domestic/item/${encodeURIComponent(s.code)}?periodType=dayCandle&startDateTime=${ymd(fs)}&endDateTime=${ymd(end)}`;const hit=detect(chartRows(await fetchJson(url)),cfg);return hit?{...s,...hit}:null}catch{return null}}

export async function GET(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'';
  if(op==='auth')return NextResponse.json({ok:validToken(requestToken(req))},{headers:{'Cache-Control':'no-store'}});
  if(!validToken(requestToken(req)))return unauthorized();
  if(op==='stocks')try{const market=(u.searchParams.get('market')||'ALL').toUpperCase();let stocks:any[]=[];if(market==='ALL'||market==='KOSPI')stocks.push(...await loadMarket('KOSPI'));if(market==='ALL'||market==='KOSDAQ')stocks.push(...await loadMarket('KOSDAQ'));return NextResponse.json({stocks,count:stocks.length})}catch(e:any){return NextResponse.json({error:'STOCK_LIST_FAILED',message:String(e?.message||e)},{status:502})}
  return NextResponse.json({error:'BAD_OP'},{status:400});
}

export async function POST(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'',body:any=await req.json().catch(()=>({}));
  if(op==='login'){if(!process.env.RADAR_PASSWORD||!process.env.SESSION_SECRET)return NextResponse.json({error:'AUTH_NOT_CONFIGURED'},{status:503});if(!validPassword(String(body?.code||body?.password||'')))return NextResponse.json({error:'INVALID_CODE'},{status:401});return NextResponse.json({ok:true,token:createToken()},{headers:{'Cache-Control':'no-store'}})}
  if(!validToken(requestToken(req)))return unauthorized();
  if(op==='scan'){const stocks=Array.isArray(body.stocks)?body.stocks.slice(0,24):[];if(!stocks.length)return NextResponse.json({error:'NO_STOCKS'},{status:400});const cfg:Cfg={start:String(body.start||''),end:String(body.end||''),minGapMonths:Math.max(1,Number(body.minGapMonths)||3),maxGapMonths:Math.min(18,Math.max(2,Number(body.maxGapMonths)||12)),resistancePct:Math.max(.2,Math.min(10,Number(body.resistancePct)||3)),supportPct:Math.max(.2,Math.min(10,Number(body.supportPct)||3)),minDropPct:Math.max(.5,Math.min(20,Number(body.minDropPct)||2)),supportLookback:Math.max(1,Math.min(15,Number(body.supportLookback)||5))};if(!/^\d{4}-\d{2}-\d{2}$/.test(cfg.start)||!/^\d{4}-\d{2}-\d{2}$/.test(cfg.end))return NextResponse.json({error:'BAD_DATE'},{status:400});const results:any[]=[];for(let i=0;i<stocks.length;i+=8){const rr=await Promise.all(stocks.slice(i,i+8).map((s:any)=>scanOne(s,cfg)));results.push(...rr.filter(Boolean))}return NextResponse.json({results,processed:stocks.length})}
  return NextResponse.json({error:'BAD_OP'},{status:400});
}
