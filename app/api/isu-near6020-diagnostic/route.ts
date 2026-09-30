import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const SCOPE='dead-golden-near60-20-radar-v1';
const ACCESS_CODE_HASH='f1ea5932a7301a0441b309d4c55ea2f4410b5b67a32fff2435d5aed762432c8e';
const marketCache=new Map<string,{time:number,data:any[]}>();
const CACHE_TTL=60*60*1000;

function secret(){return process.env.SESSION_SECRET||''}
function sign(payload:string){return crypto.createHmac('sha256',`${secret()}:${SCOPE}`).update(payload).digest('base64url')}
function createToken(){const p=`${SCOPE}.${crypto.randomBytes(18).toString('base64url')}`;return `${p}.${sign(p)}`}
function requestToken(req:Request){return req.headers.get('x-auth-token')||(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'')}
function validToken(token?:string|null){if(!token||!secret())return false;const i=token.lastIndexOf('.');if(i<0)return false;const p=token.slice(0,i),s=token.slice(i+1);if(!p.startsWith(`${SCOPE}.`))return false;const e=sign(p);if(s.length!==e.length)return false;try{return crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e))}catch{return false}}
function validPassword(v:string){if(!secret())return false;const actual=crypto.createHash('sha256').update(String(v||'')).digest();return crypto.timingSafeEqual(actual,Buffer.from(ACCESS_CODE_HASH,'hex'))}
function unauthorized(){return NextResponse.json({error:'UNAUTHORIZED'},{status:401})}
async function fetchJson(url:string,timeoutMs=10000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{signal:c.signal,cache:'no-store',headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/plain,*/*','Referer':'https://m.stock.naver.com/'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json()}finally{clearTimeout(t)}}
function n(v:any){return typeof v==='number'?v:Number(String(v??'').replace(/,/g,''))}
function ymd(d:Date){return d.toISOString().slice(0,10).replace(/-/g,'')}
function dt(s:string){const d=new Date(`${s}T00:00:00Z`);return isNaN(d.getTime())?null:d}
function dtext(v:string){return v?String(v).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):''}
function round(v:number,p=2){const m=10**p;return Math.round(v*m)/m}
function sma(a:number[],w:number,i:number){if(i<w-1)return null;let s=0;for(let k=i-w+1;k<=i;k++)s+=a[k];return s/w}

async function loadMarket(market:'KOSPI'|'KOSDAQ'){
  const c=marketCache.get(market);if(c&&Date.now()-c.time<CACHE_TTL)return c.data;
  const requestedSize=100,base=`https://m.stock.naver.com/api/stocks/marketValue/${market}`;
  const first=await fetchJson(`${base}?page=1&pageSize=${requestedSize}`,9000),a1=first.stocks||first.result||first.items||[];
  const pageSize=Math.max(1,a1.length||20),total=Number(first.totalCount||first.total||a1.length)||a1.length,pages=Math.max(1,Math.ceil(total/pageSize));let all:any[]=[...a1];
  for(let p=2;p<=pages;p+=5){const ps=Array.from({length:Math.min(5,pages-p+1)},(_,i)=>p+i);const rr=await Promise.allSettled(ps.map(x=>fetchJson(`${base}?page=${x}&pageSize=${pageSize}`,9000)));for(const r of rr){if(r.status==='rejected')throw new Error('종목 목록 일부를 불러오지 못했습니다. 다시 실행해 주세요.');all.push(...(r.value.stocks||r.value.result||r.value.items||[]))}}
  const seen=new Set<string>(),out:any[]=[];for(const s of all){const raw=String(s.itemCode||s.code||'').replace(/\D/g,''),code=raw.padStart(6,'0'),name=s.stockName||s.name||s.itemName||'';if(/^\d{6}$/.test(code)&&name&&!seen.has(code)){seen.add(code);out.push({code,name,market,price:n(s.closePrice||s.now||0)||null,marketValue:s.marketValue||s.marketCap||null})}}
  marketCache.set(market,{time:Date.now(),data:out});return out;
}

type Row={date:string;open:number;high:number;low:number;close:number;volume:number;ma5?:number|null;ma20?:number|null;ma60?:number|null};
type Cfg={start:string;end:string;minGapMonths:number;maxGapMonths:number;near60Pct:number;supportPct:number;supportLookback:number};
function chartRows(j:any){const raw=j.priceInfos||j.prices||j.result||j.items||j.chartData||[],out:Row[]=[];for(const x of raw){const date=String(x.localDate||x.date||x.tradeDate||'').replace(/\D/g,'').slice(0,8),close=n(x.closePrice??x.close??x.nv),high=n(x.highPrice??x.high??close),low=n(x.lowPrice??x.low??close),open=n(x.openPrice??x.open??close),volume=n(x.accumulatedTradingVolume??x.volume??0);if(/^\d{8}$/.test(date)&&isFinite(close)&&close>0)out.push({date,open,high,low,close,volume:isFinite(volume)?volume:0})}out.sort((a,b)=>a.date.localeCompare(b.date));return out}
function detect(rows:Row[],cfg:Cfg){
  if(rows.length<90)return null;const closes=rows.map(x=>x.close);for(let i=0;i<rows.length;i++){rows[i].ma5=sma(closes,5,i);rows[i].ma20=sma(closes,20,i);rows[i].ma60=sma(closes,60,i)}
  const endY=cfg.end.replace(/-/g,''),startY=cfg.start.replace(/-/g,'');let last=rows.length-1;while(last>0&&rows[last].date>endY)last--;if(rows[last].date<startY)return null;
  const deads:number[]=[],golds:number[]=[];for(let i=1;i<=last;i++){const p=rows[i-1],c=rows[i];if([p.ma5,p.ma20,c.ma5,c.ma20].some(v=>v==null))continue;if((p.ma5 as number)>=(p.ma20 as number)&&(c.ma5 as number)<(c.ma20 as number))deads.push(i);if((p.ma5 as number)<=(p.ma20 as number)&&(c.ma5 as number)>(c.ma20 as number)&&c.date>=startY&&c.date<=endY)golds.push(i)}if(!deads.length||!golds.length)return null;
  const minDays=cfg.minGapMonths*30.44,maxDays=cfg.maxGapMonths*30.44;let best:any=null;
  for(const gi of golds){let di=-1,gap=0;for(let k=deads.length-1;k>=0;k--){if(deads[k]>=gi)continue;const a=dt(dtext(rows[deads[k]].date)),b=dt(dtext(rows[gi].date));if(!a||!b)continue;const days=(b.getTime()-a.getTime())/86400000;if(days>=minDays&&days<=maxDays){di=deads[k];gap=days;break}}if(di<0)continue;
    const cur=rows[last];if(!cur.ma20||!cur.ma60)continue;
    const d20=(cur.close-cur.ma20)/cur.ma20*100,d60=(cur.close-cur.ma60)/cur.ma60*100;
    // Both breakout and below-MA60 prices qualify, using the cutoff day's close.
    if(Math.abs(d60)>cfg.near60Pct+1e-9)continue;
    let si=-1,sd=999;for(let i=Math.max(gi,last-cfg.supportLookback+1);i<=last;i++){const r=rows[i];if(!r.ma20)continue;const dist=Math.abs((r.close-r.ma20)/r.ma20*100),touch=r.low<=r.ma20*(1+cfg.supportPct/100)&&r.close>=r.ma20*(1-cfg.supportPct/100);if(touch&&dist<=cfg.supportPct+1e-9&&dist<sd){si=i;sd=dist}}if(si<0)continue;
    const b20=last>=5?rows[last-5].ma20:null,slope=b20?(cur.ma20-b20)/b20*100:0,recent=rows.slice(Math.max(0,last-19),last+1),v20=recent.reduce((s,x)=>s+x.volume,0)/recent.length,vr=v20?cur.volume/v20:1;
    const nearScore=(distance:number,tolerance:number,weight:number)=>weight*(1-Math.min(1,distance/Math.max(tolerance,.01)));
    const score=Math.round(Math.min(100,nearScore(Math.abs(d60),cfg.near60Pct,40)+nearScore(sd,cfg.supportPct,30)+Math.max(0,Math.min(16,8+slope*6))+Math.max(0,Math.min(14,(1.3-vr)*15))));
    const hit={score,deadDate:dtext(rows[di].date),goldenDate:dtext(rows[gi].date),near60Date:dtext(cur.date),near60State:d60>0?'60일선 위':d60<0?'60일선 아래':'60일선 일치',supportDate:dtext(rows[si].date),gapMonths:round(gap/30.44,1),close:cur.close,ma5:round(cur.ma5 as number,2),ma20:round(cur.ma20,2),ma60:round(cur.ma60,2),dist20:round(d20,2),dist60:round(d60,2),slope20:round(slope,2),volumeRatio:round(vr,2),lastDate:dtext(cur.date),chart:rows.slice(Math.max(0,last-130),last+1).map(x=>({date:dtext(x.date),close:x.close,ma5:x.ma5?round(x.ma5,2):null,ma20:x.ma20?round(x.ma20,2):null,ma60:x.ma60?round(x.ma60,2):null}))};if(!best||hit.score>best.score)best=hit;
  }return best;
}
async function loadHistory(code:string,cfg:Cfg){
  const start=dt(cfg.start),end=dt(cfg.end);if(!start||!end)throw new Error('BAD_DATE');
  const fs=new Date(start);fs.setMonth(fs.getMonth()-cfg.maxGapMonths-3);
  // Naver dayCandle caps each response at 110 bars. Use windows below that cap.
  const windows:{start:Date;end:Date}[]=[];for(let cursor=new Date(fs);cursor<=end;){const last=new Date(cursor);last.setUTCDate(last.getUTCDate()+119);if(last>end)last.setTime(end.getTime());windows.push({start:new Date(cursor),end:last});cursor=new Date(last);cursor.setUTCDate(cursor.getUTCDate()+1);}
  const byDate=new Map<string,Row>();
  for(let i=0;i<windows.length;i+=3){
    const batches=await Promise.all(windows.slice(i,i+3).map(async w=>{
      const url=`https://api.stock.naver.com/chart/domestic/item/${encodeURIComponent(code)}?periodType=dayCandle&startDateTime=${ymd(w.start)}&endDateTime=${ymd(w.end)}`;
      const raw=await fetchJson(url);const rows=chartRows(raw);
      // The provider may ignore startDateTime and return 110 bars ending at the requested end.
      if(rows.length>=110&&rows[0].date>ymd(w.start))throw new Error('일봉 응답이 제한되어 과거 데이터를 확인할 수 없습니다.');
      return rows.filter(row=>row.date>=ymd(w.start)&&row.date<=ymd(w.end));
    }));for(const rows of batches)for(const row of rows)byDate.set(row.date,row);
  }
  const rows=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
  if(!rows.length)throw new Error('일봉 데이터를 불러오지 못했습니다.');return rows;
}
async function scanOne(s:any,cfg:Cfg){try{const rows=await loadHistory(String(s.code),cfg),hit=detect(rows,cfg);return hit?{...s,...hit}:null}catch(e:any){return {scanError:true,code:s.code,message:String(e?.message||e)}}}

export async function GET(req:Request){
  const key=new URL(req.url).searchParams.get('key')||'';
  if(Date.now()>1790740414671||crypto.createHash('sha256').update(key).digest('hex')!=='f0f442e9b139bdcbd5cd213c8de4b1829b99e04248a5c02eec4fe9d3167bcb2c')return unauthorized();
  const cfg:Cfg={start:'2026-03-01',end:'2026-09-28',minGapMonths:3,maxGapMonths:12,near60Pct:5,supportPct:5,supportLookback:3};
  try{
    const raw=await fetchJson('https://api.stock.naver.com/chart/domestic/item/457190?periodType=dayCandle&startDateTime=20241201&endDateTime=20260928',15000);
    const cappedRows=chartRows(raw),rows=await loadHistory('457190',cfg),hit=detect(rows,cfg);const limited=rows.filter(r=>r.date<='20260928');
    const crosses:any[]=[];for(let i=1;i<limited.length;i++){const p=limited[i-1],c=limited[i];if(!p.ma5||!p.ma20||!c.ma5||!c.ma20)continue;if(p.ma5>=p.ma20&&c.ma5<c.ma20)crosses.push({type:'dead',date:c.date});if(p.ma5<=p.ma20&&c.ma5>c.ma20)crosses.push({type:'golden',date:c.date});}
    const cur=limited.at(-1),dist60=cur?.ma60?(cur.close-cur.ma60)/cur.ma60*100:null;
    const support=limited.slice(-3).map(r=>({...r,dist20:r.ma20?(r.close-r.ma20)/r.ma20*100:null}));
    const golds=crosses.filter(x=>x.type==='golden'&&x.date>='20260301');
    const pairs=golds.map(g=>({golden:g.date,deads:crosses.filter(d=>d.type==='dead'&&d.date<g.date).map(d=>({date:d.date,gapDays:((dt(dtext(g.date)) as Date).getTime()-(dt(dtext(d.date)) as Date).getTime())/86400000})).filter(d=>d.gapDays>=3*30.44&&d.gapDays<=12*30.44)}));
    return NextResponse.json({cfg,rawKeys:Object.keys(raw),capped:{count:cappedRows.length,first:cappedRows[0]?.date,last:cappedRows.at(-1)?.date},rowCount:rows.length,first:rows[0]?.date,last:cur,dist60,support,crosses:crosses.filter(c=>c.date>='20260101'),pairs,detected:hit?{...hit,chart:undefined}:null,source:'Naver dayCandle'},{headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
  }catch(e:any){return NextResponse.json({error:String(e?.message||e)},{status:502});}
}
