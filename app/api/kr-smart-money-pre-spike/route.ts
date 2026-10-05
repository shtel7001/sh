// @ts-nocheck
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;

const SCOPE='kr-smart-money-pre-spike-20261005-v1';
const ACCESS_CODE_HASH='dcf62aebf5b5020c642a92711ca9b135eaaa5524dd31bd43a15d3abb68d46619';
const UA='Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization, X-Auth-Token','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
function json(data:any,init:any={}){return NextResponse.json(data,{...init,headers:{...CORS,...(init.headers||{})}})}
function secret(){return process.env.SESSION_SECRET||''}
function sign(p:string){return crypto.createHmac('sha256',secret()+':'+SCOPE).update(p).digest('base64url')}
function reqToken(req:Request){return req.headers.get('x-auth-token')||(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'')}
function validToken(t:string){
  if(!t||!secret())return false;
  const i=t.lastIndexOf('.'); if(i<0)return false;
  const p=t.slice(0,i),s=t.slice(i+1); if(!p.startsWith(SCOPE+'.'))return false;
  const e=sign(p); if(s.length!==e.length)return false;
  try{return crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e))}catch{return false}
}
function validPassword(v:any){
  const a=crypto.createHash('sha256').update(String(v||'').trim()).digest();
  try{return crypto.timingSafeEqual(a,Buffer.from(ACCESS_CODE_HASH,'hex'))}catch{return false}
}
function createToken(){const p=SCOPE+'.'+crypto.randomBytes(24).toString('base64url');return p+'.'+sign(p)}
function unauthorized(){return json({error:'UNAUTHORIZED'},{status:401,headers:{'Cache-Control':'no-store'}})}
function num(v:any){if(typeof v==='number')return Number.isFinite(v)?v:null;const n=Number(String(v??'').replace(/[,%+\s]/g,''));return Number.isFinite(n)?n:null}
function clamp(v:any,a:number,b:number){return Math.max(a,Math.min(b,Number(v)||0))}
function ymd(v:any){const s=String(v||'').replace(/\D/g,'').slice(0,8);return /^\d{8}$/.test(s)?s:''}
function dash(v:any){const s=ymd(v);return s?s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8):String(v||'')}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function fetchAny(url:string,kind:'json'|'text'|'buffer'='json',timeout=9000){
  let last:any;
  for(let k=0;k<2;k++){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
    try{
      const r=await fetch(url,{signal:c.signal,cache:'no-store',headers:{'User-Agent':UA,'Accept':'application/json,text/plain,text/html,*/*','Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6','Referer':'https://m.stock.naver.com/'}});
      if(!r.ok)throw new Error('HTTP_'+r.status);
      if(kind==='json')return await r.json();
      if(kind==='buffer')return Buffer.from(await r.arrayBuffer());
      return await r.text();
    }catch(e){last=e;await sleep(180*(k+1))}finally{clearTimeout(t)}
  }
  throw last||new Error('FETCH_FAILED');
}
function pickArray(j:any){
  if(Array.isArray(j))return j;
  for(const k of ['stocks','items','data','stockList','result'])if(Array.isArray(j?.[k]))return j[k];
  for(const k of ['stocks','items','data'])if(Array.isArray(j?.result?.[k]))return j.result[k];
  return [];
}
function normStock(x:any,market:string){
  const code=String(x?.itemCode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||'';
  const name=String(x?.stockName??x?.itemName??x?.name??'').trim();
  if(!code||!name)return null;
  return {code,name,market,currentPrice:num(x?.closePrice??x?.currentPrice??x?.price),changePct:num(x?.fluctuationsRatio??x?.changeRate??x?.changePct??x?.rate),volume:num(x?.accumulatedTradingVolume??x?.accumulatedVolume??x?.volume),tradeValue:num(x?.accumulatedTradingValue??x?.tradeValue??x?.amount),marketCap:num(x?.marketValue??x?.marketCap)};
}
async function universeMarket(market:'KOSPI'|'KOSDAQ'){
  const out:any[]=[]; const seen=new Set<string>();
  for(let page=1;page<=35;page++){
    let rows:any[]=[];
    try{rows=pickArray(await fetchAny('https://m.stock.naver.com/api/stocks/marketValue/'+market+'?page='+page+'&pageSize=100'))}catch{break}
    if(!rows.length)break;
    let added=0;
    for(const x of rows){const s=normStock(x,market);if(s&&!seen.has(s.code)){seen.add(s.code);out.push(s);added++}}
    if(added===0||rows.length<20)break;
  }
  return out;
}
async function getUniverse(market:string){
  if(market==='KOSPI')return universeMarket('KOSPI');
  if(market==='KOSDAQ')return universeMarket('KOSDAQ');
  const [a,b]=await Promise.all([universeMarket('KOSPI'),universeMarket('KOSDAQ')]);
  return a.concat(b);
}

type DBar={date:string;open:number;high:number;low:number;close:number;volume:number};
function parseFchartDay(xml:string):DBar[]{
  const out:DBar[]=[];const re=/<item\s+data="([^"]+)"\s*\/?\s*>/g;let m:any;
  while((m=re.exec(xml))){
    const p=m[1].split('|');if(p.length<6)continue;
    const date=dash(p[0]),open=num(p[1]),high=num(p[2]),low=num(p[3]),close=num(p[4]),volume=num(p[5]);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||[open,high,low,close,volume].some(x=>x===null))continue;
    out.push({date,open,high,low,close,volume});
  }
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}
async function naverDaily(code:string,count=190){
  const xml=await fetchAny('https://fchart.stock.naver.com/sise.nhn?symbol='+encodeURIComponent(code)+'&timeframe=day&count='+count+'&requestType=0','text',10000);
  const rows=parseFchartDay(xml);if(rows.length<25)throw new Error('NAVER_DAY_EMPTY');
  return rows;
}
function avg(a:number[]){return a.length?a.reduce((s,x)=>s+x,0)/a.length:0}
function asOfIndex(rows:DBar[],requested:string){
  if(!rows.length)return -1;
  if(!requested)return rows.length-1;
  let idx=-1;for(let i=0;i<rows.length;i++){if(rows[i].date<=requested)idx=i;else break}
  return idx;
}
function dayChange(rows:DBar[],i:number){return i>0?(rows[i].close/rows[i-1].close-1)*100:0}
function median(a:number[]){if(!a.length)return 0;const b=a.slice().sort((x,y)=>x-y),m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2}

function analyzeDaily(rows:DBar[],baseIdx:number,cfg:any,mode:string){
  const lookback=Math.round(clamp(cfg.lookbackDays||20,5,20));
  const min5=clamp(cfg.min5x||3,1.2,20),maxMove=clamp(cfg.maxPreMove||3,.5,10),noSurge=clamp(cfg.notSurgedPct||5,1,20);
  const start=Math.max(1,baseIdx-lookback),signals:any[]=[];
  for(let i=start;i<baseIdx;i++){
    const hist=rows.slice(Math.max(0,i-20),i).map(x=>x.volume).filter(v=>v>0);
    if(hist.length<5)continue;
    const baseline=median(hist)||avg(hist);if(!baseline)continue;
    const r=rows[i].volume/baseline;
    const ch=dayChange(rows,i);
    if(r<Math.max(1.35,min5*.55)||ch>maxMove)continue;
    const future=rows.slice(i+1,baseIdx+1);const maxHigh=future.length?Math.max(...future.map(x=>x.high)):rows[i].high;
    const runup=(maxHigh/rows[i].close-1)*100;
    const closePos=(rows[i].close-rows[i].low)/Math.max(.0001,rows[i].high-rows[i].low);
    const prevLows=rows.slice(Math.max(0,i-3),i).map(x=>x.low);const risingLow=prevLows.length?rows[i].low>=Math.min(...prevLows):false;
    const nextVol=rows.slice(i+1,Math.min(baseIdx,i+3)).map(x=>x.volume/(baseline||1));
    const persist=1+nextVol.filter(x=>x>=1.2).length;
    const r15=(r+(nextVol[0]||0)+(nextVol[1]||0))/Math.max(1,1+(nextVol[0]!==undefined?1:0)+(nextVol[1]!==undefined?1:0));
    let score=0;
    score+=Math.min(30,12+Math.max(0,r-1)*7);
    score+=persist>=3?15:persist===2?10:5;
    score+=ch<=0?15:Math.max(0,15*(1-ch/maxMove));
    score+=closePos>=.55?10:5;
    score+=risingLow?8:0;
    score+=runup>=5?12:runup>=3?8:3;
    score=Math.min(90,Math.round(score*10)/10);
    signals.push({date:rows[i].date,time:'일봉',ts:i,score5m:score,ratio5:r,ratio15:r15,persist,priceMove:ch,vwapAbove:closePos>=.55,runupAfter:runup,notSurged:runup<noSurge,close:rows[i].close,dataSource:'NAVER_DAY_FALLBACK'});
  }
  signals.sort((a,b)=>b.score5m-a.score5m||b.ts-a.ts);
  return signals;
}

function symbol(code:string,market:string){return code+'.'+(market==='KOSDAQ'?'KQ':'KS')}
function kst(ts:number){const d=new Date((ts+9*3600)*1000).toISOString();return {date:d.slice(0,10),time:d.slice(11,16)}}
async function yahooBars(code:string,market:string,interval='5m',range='60d'){
  const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol(code,market))+'?range='+range+'&interval='+interval+'&includePrePost=false&events=history';
  const j=await fetchAny(url,'json',9000);const z=j?.chart?.result?.[0];if(!z)throw new Error('YAHOO_EMPTY');
  const ts:any[]=z?.timestamp||[],q=z?.indicators?.quote?.[0]||{},out:any[]=[];
  for(let i=0;i<ts.length;i++){
    const o=num(q.open?.[i]),h=num(q.high?.[i]),l=num(q.low?.[i]),c=num(q.close?.[i]),v=num(q.volume?.[i]);
    if([o,h,l,c,v].some(x=>x===null))continue;
    const p=kst(Number(ts[i]));if(p.time<'09:00'||p.time>'15:35')continue;
    out.push({ts:Number(ts[i]),date:p.date,time:p.time,open:o,high:h,low:l,close:c,volume:v});
  }
  if(out.length<100)throw new Error('YAHOO_INTRADAY_TOO_SHORT');
  return out;
}
function groupSessions(rows:any[]){const m=new Map<string,any[]>();for(const b of rows){if(!m.has(b.date))m.set(b.date,[]);m.get(b.date)!.push(b)}return [...m.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,bars])=>({date,bars:bars.sort((a:any,b:any)=>a.ts-b.ts)}))}
function analyzeIntraday(rows:any[],baseDate:string,cfg:any){
  const lookback=Math.round(clamp(cfg.lookbackDays||20,5,20)),min5=clamp(cfg.min5x||3,1.5,20),maxMove=clamp(cfg.maxPreMove||3,.5,10),noSurge=clamp(cfg.notSurgedPct||5,1,20);
  const sessions=groupSessions(rows).filter(s=>s.date<=baseDate);const basePos=sessions.findIndex(s=>s.date===baseDate);
  if(basePos<0||basePos<6)return [];
  const start=Math.max(1,basePos-lookback),signals:any[]=[];const flat=sessions.slice(0,basePos+1).flatMap(s=>s.bars);
  for(let d=start;d<basePos;d++){
    const cur=sessions[d],prev=sessions.slice(Math.max(0,d-20),d),prevMaps=prev.map(s=>new Map(s.bars.map((b:any)=>[b.time,b])));
    let cumPV=0,cumV=0;
    const ratioAt=(idx:number)=>{const b=cur.bars[idx];if(!b)return 0;const vs=prevMaps.map(mp=>Number(mp.get(b.time)?.volume||0)).filter(v=>v>0);if(vs.length<5)return 0;const base=avg(vs);return base?b.volume/base:0};
    for(let i=0;i<cur.bars.length;i++){
      const b=cur.bars[i];cumPV+=b.close*b.volume;cumV+=b.volume;const vwap=cumV?cumPV/cumV:b.close,r5=ratioAt(i);if(r5<min5)continue;
      const move=(b.close/(cur.bars[0]?.open||b.open)-1)*100;if(move>maxMove)continue;
      const r2=ratioAt(i+1),r3=ratioAt(i+2),persist=[r5,r2,r3].filter(x=>x>=Math.max(1.5,min5*.55)).length;
      const actual15=cur.bars.slice(i,i+3).reduce((s:any,x:any)=>s+x.volume,0),base15s=prevMaps.map(mp=>[cur.bars[i]?.time,cur.bars[i+1]?.time,cur.bars[i+2]?.time].reduce((s:any,t:any)=>s+Number(mp.get(t)?.volume||0),0)).filter(v=>v>0);
      const r15=base15s.length>=5?actual15/avg(base15s):0,prev3=cur.bars.slice(Math.max(0,i-3),i),risingLow=prev3.length?b.low>=Math.min(...prev3.map((x:any)=>x.low)):false;
      const future=flat.filter((x:any)=>x.ts>b.ts&&x.date<=baseDate),maxHigh=future.length?Math.max(...future.map((x:any)=>x.high)):b.high,runup=(maxHigh/b.close-1)*100;
      let score=0;score+=Math.min(25,12+Math.max(0,r5-min5)*4);score+=persist>=3?15:persist===2?10:5;score+=Math.min(15,Math.max(0,(r15-1)*7.5));score+=move<=0?15:Math.max(0,15*(1-move/maxMove));score+=b.close>=vwap?10:0;score+=risingLow?5:0;score+=5;
      score=Math.min(90,Math.round(score*10)/10);
      signals.push({date:b.date,time:b.time,ts:b.ts,score5m:score,ratio5:r5,ratio15:r15,persist,priceMove:move,vwapAbove:b.close>=vwap,runupAfter:runup,notSurged:runup<noSurge,close:b.close,dataSource:'YAHOO_5M'});
    }
  }
  return signals.sort((a,b)=>b.score5m-a.score5m||b.ts-a.ts).slice(0,60);
}

async function flow5d(code:string,asOf:string){
  try{
    const b=await fetchAny('https://finance.naver.com/item/frgn.naver?code='+code,'buffer',9000),html=iconv.decode(b,'EUC-KR'),$=cheerio.load(html),rows:any[]=[];
    $('table.type2 tr').each((_,tr)=>{const tds=$(tr).find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();if(tds.length<7||!/^\d{4}\.\d{2}\.\d{2}/.test(tds[0]||''))return;const date=tds[0].replace(/\./g,'-'),inst=num(tds[5]),foreign=num(tds[6]);if(date<=asOf&&inst!==null&&foreign!==null)rows.push({date,inst,foreign})});
    const x=rows.slice(0,5);if(!x.length)return {institution5d:null,foreign5d:null,flowBonus:0};
    const inst=x.reduce((s,r)=>s+r.inst,0),foreign=x.reduce((s,r)=>s+r.foreign,0),bonus=inst>0&&foreign>0?10:(inst>0||foreign>0?6:0);
    return {institution5d:inst,foreign5d:foreign,flowBonus:bonus};
  }catch{return {institution5d:null,foreign5d:null,flowBonus:0}}
}

async function analyzeOne(stock:any,cfg:any,mode:string){
  const rows=await naverDaily(stock.code,190),req=String(cfg.asOf||'').slice(0,10),baseIdx=asOfIndex(rows,req);
  if(baseIdx<21)return {stock,match:false,reason:'NOT_ENOUGH_HISTORY'};
  const latestIdx=rows.length-1;if(latestIdx-baseIdx>120)return {stock,match:false,reason:'OUTSIDE_120_TRADING_DAYS'};
  const baseDate=rows[baseIdx].date,baseChange=dayChange(rows,baseIdx),spikePct=clamp(cfg.spikePct||5,1,30),maxCurrent=clamp(cfg.maxCurrentChange??3,-20,10);
  const enriched={...stock,currentPrice:rows[baseIdx].close,changePct:baseChange,baseDate};
  if(mode==='reverse'&&baseChange<spikePct)return {stock:enriched,match:false,reason:'NOT_SPIKE_ON_BASE_DATE',baseDate,baseChange};
  if(mode==='candidate'&&baseChange>maxCurrent)return {stock:enriched,match:false,reason:'CURRENT_MOVE_TOO_HIGH',baseDate,baseChange};

  let signals:any[]=[],source='NAVER_DAY_FALLBACK',intradayError='';
  const age=latestIdx-baseIdx;
  if(age<=35){
    try{const m5=await yahooBars(stock.code,stock.market,'5m','60d');signals=analyzeIntraday(m5,baseDate,cfg);if(signals.length)source='YAHOO_5M'}catch(e:any){intradayError=String(e?.message||e)}
  }
  if(!signals.length){signals=analyzeDaily(rows,baseIdx,cfg,mode);source='NAVER_DAY_FALLBACK'}
  if(mode==='candidate')signals=signals.filter((s:any)=>s.notSurged);
  if(!signals.length)return {stock:enriched,match:false,reason:'NO_PATTERN',baseDate,baseChange,dataSource:source,intradayError};

  let best=signals[0],flow=await flow5d(stock.code,baseDate);
  best={...best,...flow,score:Math.min(100,Math.round((best.score5m+flow.flowBonus)*10)/10),dataSource:source};
  if(best.score<clamp(cfg.minScore||60,0,100))return {stock:enriched,match:false,reason:'LOW_SCORE',best,baseDate,baseChange,dataSource:source,intradayError};
  return {stock:enriched,match:true,best,signals:signals.slice(0,8),baseDate,baseChange,dataSource:source,intradayError};
}
async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>){
  const out:R[]=[];let idx=0;
  async function worker(){while(true){const i=idx++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch(e:any){out[i]=<any>{error:String(e?.message||e),stock:<any>items[i]}}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));return out;
}
function parseNaverMinute(xml:string){
  const out:any[]=[];const re=/<item\s+data="([^"]+)"\s*\/?\s*>/g;let m:any;
  while((m=re.exec(xml))){const p=m[1].split('|'),stamp=String(p[0]||'').replace(/\D/g,'');if(stamp.length<12)continue;const o=num(p[1]),h=num(p[2]),l=num(p[3]),c=num(p[4]),v=num(p[5]);if([o,h,l,c,v].some(x=>x===null))continue;out.push({date:stamp.slice(0,4)+'-'+stamp.slice(4,6)+'-'+stamp.slice(6,8),time:stamp.slice(8,10)+':'+stamp.slice(10,12),open:o,high:h,low:l,close:c,volume:v})}
  return out;
}
async function minute1m(code:string,market:string){
  try{const x=await fetchAny('https://fchart.stock.naver.com/sise.nhn?symbol='+code+'&timeframe=minute&count=2200&requestType=0','text',9000),r=parseNaverMinute(x);if(r.length>50)return r.slice(-1200)}catch{}
  try{return (await yahooBars(code,market,'1m','7d')).slice(-1200)}catch{return []}
}

export async function OPTIONS(){return new NextResponse(null,{status:204,headers:CORS})}
export async function GET(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'';
  if(op==='health'){
    let y:any={ok:false},n:any={ok:false};
    try{const r=await yahooBars('005930','KOSPI','5m','60d');y={ok:true,count:r.length,last:r.at(-1)?.date}}catch(e:any){y={ok:false,error:String(e?.message||e)}}
    try{const r=await naverDaily('005930',190);const bi=r.length-1;const sig=analyzeDaily(r,bi,{lookbackDays:20,min5x:1.2,maxPreMove:10,minScore:0,notSurgedPct:20},'candidate');n={ok:true,count:r.length,last:r.at(-1)?.date,lastChange:dayChange(r,bi),sampleSignals:sig.length,bestSignal:sig[0]?{date:sig[0].date,ratio:sig[0].ratio5,score:sig[0].score5m}:null}}catch(e:any){n={ok:false,error:String(e?.message||e)}}
    let nm:any={ok:false};try{const r=await minute1m('005930','KOSPI');nm={ok:true,count:r.length,first:r[0]?{date:r[0].date,time:r[0].time}:null,last:r.at(-1)?{date:r.at(-1).date,time:r.at(-1).time}:null}}catch(e:any){nm={ok:false,error:String(e?.message||e)}}
    return json({ok:true,yahoo:y,naver:n,naverMinute:nm});
  }
  if(!validToken(reqToken(req)))return unauthorized();
  if(op==='ping')return json({ok:true});
  if(op==='universe'){
    try{const rows=await getUniverse(u.searchParams.get('market')||'ALL');return json({ok:true,count:rows.length,rows},{headers:{'Cache-Control':'no-store'}})}
    catch(e:any){return json({error:'UNIVERSE_FAILED',message:String(e?.message||e)},{status:502})}
  }
  if(op==='detail'){
    const code=String(u.searchParams.get('code')||'').replace(/\D/g,'').slice(0,6),market=u.searchParams.get('market')==='KOSDAQ'?'KOSDAQ':'KOSPI',asOf=String(u.searchParams.get('asOf')||'').slice(0,10);
    if(!/^\d{6}$/.test(code))return json({error:'BAD_CODE'},{status:400});
    try{
      const daily=await naverDaily(code,190),idx=asOfIndex(daily,asOf),baseDate=idx>=0?daily[idx].date:daily.at(-1)?.date;
      let m5:any[]=[];try{m5=(await yahooBars(code,market,'5m','60d')).filter(x=>x.date<=baseDate).slice(-1200)}catch{}
      const m1=await minute1m(code,market);
      return json({ok:true,code,market,baseDate,daily:daily.slice(Math.max(0,idx-40),idx+1),m5,m1:m1.filter(x=>!baseDate||x.date<=baseDate).slice(-900)},{headers:{'Cache-Control':'no-store'}});
    }catch(e:any){return json({error:'DETAIL_FAILED',message:String(e?.message||e)},{status:502})}
  }
  return json({error:'BAD_OP'},{status:400});
}
export async function POST(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'',body=await req.json().catch(()=>({}));
  if(op==='login'){
    if(!secret())return json({error:'AUTH_NOT_CONFIGURED'},{status:503});
    if(!validPassword(body?.code||body?.password))return json({error:'INVALID_CODE'},{status:401});
    return json({ok:true,token:createToken()},{headers:{'Cache-Control':'no-store'}});
  }
  if(!validToken(reqToken(req)))return unauthorized();
  if(op==='analyze'){
    const stocks=Array.isArray(body?.stocks)?body.stocks.slice(0,12):[],mode=body?.mode==='reverse'?'reverse':'candidate',cfg=body?.cfg||{};
    const results=await mapLimit(stocks,6,(s:any)=>analyzeOne(s,cfg,mode));
    const errorSummary:any={};for(const r of results){if((r as any)?.error){const k=String((r as any).error).split(':')[0];errorSummary[k]=(errorSummary[k]||0)+1}}
    return json({ok:true,mode,results,errorSummary},{headers:{'Cache-Control':'no-store'}});
  }
  return json({error:'BAD_OP'},{status:400});
}