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
function symbol(code:string,market:string){return code+'.'+(market==='KOSDAQ'?'KQ':'KS')}
function kst(ts:number){
  const d=new Date((ts+9*3600)*1000).toISOString();
  return {date:d.slice(0,10),time:d.slice(11,16)};
}
async function yahooBars(code:string,market:string,interval='5m',range='60d'){
  const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol(code,market))+'?range='+range+'&interval='+interval+'&includePrePost=false&events=history';
  const j=await fetchAny(url,'json',10000); const z=j?.chart?.result?.[0];
  const ts:any[]=z?.timestamp||[],q=z?.indicators?.quote?.[0]||{};
  const out:any[]=[];
  for(let i=0;i<ts.length;i++){
    const o=num(q.open?.[i]),h=num(q.high?.[i]),l=num(q.low?.[i]),c=num(q.close?.[i]),v=num(q.volume?.[i]);
    if([o,h,l,c,v].some(x=>x===null))continue;
    const p=kst(Number(ts[i])); if(p.time<'09:00'||p.time>'15:35')continue;
    out.push({ts:Number(ts[i]),date:p.date,time:p.time,open:o,high:h,low:l,close:c,volume:v});
  }
  return out;
}
function avg(a:number[]){return a.length?a.reduce((s,x)=>s+x,0)/a.length:0}
function groupSessions(rows:any[]){
  const m=new Map<string,any[]>(); for(const b of rows){if(!m.has(b.date))m.set(b.date,[]);m.get(b.date)!.push(b)}
  return [...m.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,bars])=>({date,bars:bars.sort((a,b)=>a.ts-b.ts)}));
}
function analyzeBars(rows:any[],cfg:any){
  const lookback=Math.round(clamp(cfg.lookbackDays||20,5,20));
  const min5=clamp(cfg.min5x||3,1.5,20), maxMove=clamp(cfg.maxPreMove||3,0.5,10), minScore=clamp(cfg.minScore||60,0,100), noSurge=clamp(cfg.notSurgedPct||5,1,20);
  const sessions=groupSessions(rows); if(sessions.length<7)return {signals:[],sessions:sessions.length};
  const targetStart=Math.max(1,sessions.length-lookback),signals:any[]=[];
  const flat=sessions.flatMap(s=>s.bars);
  for(let d=targetStart;d<sessions.length;d++){
    const cur=sessions[d], prev=sessions.slice(Math.max(0,d-20),d);
    const prevMaps=prev.map(s=>new Map(s.bars.map((b:any)=>[b.time,b])));
    let cumPV=0,cumV=0;
    const ratioAt=(idx:number)=>{
      const b=cur.bars[idx]; if(!b)return 0;
      const vs=prevMaps.map(mp=>Number(mp.get(b.time)?.volume||0)).filter(v=>v>0);
      if(vs.length<5)return 0; const base=avg(vs); return base>0?b.volume/base:0;
    };
    for(let i=0;i<cur.bars.length;i++){
      const b=cur.bars[i]; cumPV+=b.close*b.volume; cumV+=b.volume; const vwap=cumV?cumPV/cumV:b.close;
      const r5=ratioAt(i); if(r5<min5)continue;
      const sessionOpen=cur.bars[0]?.open||b.open, move=(b.close/sessionOpen-1)*100; if(move>maxMove)continue;
      const r1=r5,r2=ratioAt(i+1),r3=ratioAt(i+2),persist=[r1,r2,r3].filter(x=>x>=Math.max(1.5,min5*0.55)).length;
      const actual15=(cur.bars.slice(i,i+3).reduce((s:any,x:any)=>s+x.volume,0));
      const base15s=prevMaps.map(mp=>[cur.bars[i]?.time,cur.bars[i+1]?.time,cur.bars[i+2]?.time].reduce((s:any,t:any)=>s+Number(mp.get(t)?.volume||0),0)).filter(v=>v>0);
      const r15=base15s.length>=5?actual15/avg(base15s):0;
      const prev3=cur.bars.slice(Math.max(0,i-3),i); const risingLow=prev3.length?b.low>=Math.min(...prev3.map((x:any)=>x.low)):false;
      const tradeValue=b.close*b.volume;
      let score=0;
      score+=Math.min(25,25*Math.max(0,(r5-min5)/(Math.max(10,min5+1)-min5)+0.45));
      score+=persist>=3?15:persist===2?10:5;
      score+=Math.min(15,Math.max(0,(r15-1)*7.5));
      score+=move<=0?15:Math.max(0,15*(1-move/maxMove));
      score+=b.close>=vwap?10:0;
      score+=risingLow?5:0;
      score+=tradeValue>=500000000?5:tradeValue>=100000000?3:1;
      const future=flat.filter((x:any)=>x.ts>b.ts),maxHigh=future.length?Math.max(...future.map((x:any)=>x.high)):b.high;
      const runup=(maxHigh/b.close-1)*100;
      score=Math.round(Math.min(90,score)*10)/10;
      if(score>=Math.max(35,minScore-20))signals.push({date:b.date,time:b.time,ts:b.ts,score5m:score,ratio5:r5,ratio15:r15,persist,priceMove:move,vwapAbove:b.close>=vwap,runupAfter:runup,notSurged:runup<noSurge,close:b.close,vwap});
    }
  }
  signals.sort((a,b)=>b.score5m-a.score5m||b.ts-a.ts);
  return {signals:signals.slice(0,40),sessions:sessions.length,lastDate:sessions.at(-1)?.date};
}
async function flow5d(code:string){
  try{
    const b=await fetchAny('https://finance.naver.com/item/frgn.naver?code='+code,'buffer',9000);
    const html=iconv.decode(b,'EUC-KR'),$=cheerio.load(html),rows:any[]=[];
    $('table.type2 tr').each((_,tr)=>{
      const tds=$(tr).find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
      if(tds.length<7||!/^\d{4}\.\d{2}\.\d{2}/.test(tds[0]||''))return;
      const inst=num(tds[5]),foreign=num(tds[6]); if(inst!==null&&foreign!==null)rows.push({inst,foreign});
    });
    const x=rows.slice(0,5),inst=x.reduce((s,r)=>s+r.inst,0),foreign=x.reduce((s,r)=>s+r.foreign,0);
    const bonus=inst>0&&foreign>0?10:(inst>0||foreign>0?6:0);
    return {institution5d:inst,foreign5d:foreign,flowBonus:bonus};
  }catch{return {institution5d:null,foreign5d:null,flowBonus:0}}
}
async function analyzeOne(stock:any,cfg:any,mode:string){
  const rows=await yahooBars(stock.code,stock.market,'5m','60d');
  const a=analyzeBars(rows,cfg); let pool=a.signals||[];
  if(mode==='reverse'){
    const today=a.lastDate; pool=pool.filter((s:any)=>s.date<=today);
  }else{
    const maxCurrent=clamp(cfg.maxCurrentChange??3,-20,10);
    if(Number(stock.changePct??0)>maxCurrent)return {stock,match:false,reason:'CURRENT_MOVE_TOO_HIGH',signals:pool.slice(0,5)};
    pool=pool.filter((s:any)=>s.notSurged);
  }
  if(!pool.length)return {stock,match:false,reason:'NO_PATTERN',signals:(a.signals||[]).slice(0,5)};
  let best=pool.sort((x:any,y:any)=>y.score5m-x.score5m||y.ts-x.ts)[0];
  const flow=await flow5d(stock.code); best={...best,...flow,score:Math.min(100,Math.round((best.score5m+flow.flowBonus)*10)/10)};
  if(best.score<clamp(cfg.minScore||60,0,100))return {stock,match:false,reason:'LOW_SCORE',best};
  return {stock,match:true,best,signals:pool.slice(0,8)};
}
async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>){
  const out:R[]=[]; let idx=0;
  async function worker(){while(true){const i=idx++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch(e:any){out[i]=<any>{error:String(e?.message||e),stock:<any>items[i]}}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker())); return out;
}
function parseNaverMinute(xml:string){
  const out:any[]=[]; const re=/<item\s+data="([^"]+)"\s*\/?\s*>/g; let m:any;
  while((m=re.exec(xml))){const p=m[1].split('|');const stamp=String(p[0]||'').replace(/\D/g,'');if(stamp.length<12)continue;
    const o=num(p[1]),h=num(p[2]),l=num(p[3]),c=num(p[4]),v=num(p[5]);if([o,h,l,c,v].some(x=>x===null))continue;
    out.push({date:stamp.slice(0,4)+'-'+stamp.slice(4,6)+'-'+stamp.slice(6,8),time:stamp.slice(8,10)+':'+stamp.slice(10,12),open:o,high:h,low:l,close:c,volume:v});
  } return out;
}
async function minute1m(code:string,market:string){
  try{const x=await fetchAny('https://fchart.stock.naver.com/sise.nhn?symbol='+code+'&timeframe=minute&count=2200&requestType=0','text',9000);const r=parseNaverMinute(x);if(r.length>100)return r.slice(-1200)}catch{}
  try{return (await yahooBars(code,market,'1m','7d')).slice(-1200)}catch{return []}
}

export async function OPTIONS(){return new NextResponse(null,{status:204,headers:CORS})}

export async function GET(req:Request){
  if(!validToken(reqToken(req)))return unauthorized();
  const u=new URL(req.url),op=u.searchParams.get('op')||'';
  if(op==='ping')return json({ok:true});
  if(op==='universe'){
    try{const rows=await getUniverse(u.searchParams.get('market')||'ALL');return json({ok:true,count:rows.length,rows},{headers:{'Cache-Control':'no-store'}})}
    catch(e:any){return json({error:'UNIVERSE_FAILED',message:String(e?.message||e)},{status:502})}
  }
  if(op==='detail'){
    const code=String(u.searchParams.get('code')||'').replace(/\D/g,'').slice(0,6),market=u.searchParams.get('market')==='KOSDAQ'?'KOSDAQ':'KOSPI';
    if(!/^\d{6}$/.test(code))return json({error:'BAD_CODE'},{status:400});
    try{
      const [m5,m1]=await Promise.all([yahooBars(code,market,'5m','60d'),minute1m(code,market)]);
      const a=analyzeBars(m5,{lookbackDays:20,min5x:3,maxPreMove:3,minScore:50,notSurgedPct:5});
      return json({ok:true,code,market,m5:m5.slice(-1200),m1:m1.slice(-900),signals:a.signals.slice(0,20)},{headers:{'Cache-Control':'no-store'}});
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
    const stocks=Array.isArray(body?.stocks)?body.stocks.slice(0,8):[],mode=body?.mode==='reverse'?'reverse':'candidate',cfg=body?.cfg||{};
    const results=await mapLimit(stocks,4,(s:any)=>analyzeOne(s,cfg,mode));
    return json({ok:true,mode,results},{headers:{'Cache-Control':'no-store'}});
  }
  return json({error:'BAD_OP'},{status:400});
}