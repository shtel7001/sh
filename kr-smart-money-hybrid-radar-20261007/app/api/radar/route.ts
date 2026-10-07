// @ts-nocheck
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;

const SCOPE='kr-smart-money-hybrid-radar-20261007-v1';
const UA='Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';
const KIW_REAL='https://api.kiwoom.com';
const KIW_DEMO='https://mockapi.kiwoom.com';

function secret(){return process.env.SESSION_SECRET||''}
function pass(){return process.env.RADAR_PASSWORD||''}
function sign(p:string){return crypto.createHmac('sha256',secret()+':'+SCOPE).update(p).digest('base64url')}
function reqToken(req:Request){return req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||''}
function validToken(t:string){
  if(!t||!secret())return false;
  const i=t.lastIndexOf('.'); if(i<0)return false;
  const p=t.slice(0,i),s=t.slice(i+1); if(!p.startsWith(SCOPE+'.'))return false;
  const e=sign(p); if(e.length!==s.length)return false;
  try{return crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e))}catch{return false}
}
function validPassword(v:any){
  const a=crypto.createHash('sha256').update(String(v||'')).digest();
  const b=crypto.createHash('sha256').update(pass()).digest();
  try{return !!pass()&&crypto.timingSafeEqual(a,b)}catch{return false}
}
function createToken(){const p=SCOPE+'.'+crypto.randomBytes(24).toString('base64url');return p+'.'+sign(p)}
function unauthorized(){return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers:{'Cache-Control':'no-store'}})}
function num(v:any){if(v===null||v===undefined)return null;const n=Number(String(v).replace(/[,%\s]/g,''));return Number.isFinite(n)?n:null}
function absnum(v:any){const n=num(v);return n===null?null:Math.abs(n)}
function clamp(v:any,a:number,b:number){return Math.max(a,Math.min(b,Number(v)||0))}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function fetchJson(url:string,init:any={},timeout=10000){
  let last:any;
  for(let k=0;k<2;k++){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
    try{
      const r=await fetch(url,{...init,signal:c.signal,cache:'no-store',headers:{
        'User-Agent':UA,'Accept':'application/json,text/plain,*/*','Accept-Language':'ko-KR,ko;q=0.9',
        'Referer':'https://m.stock.naver.com/',...(init.headers||{})
      }});
      const text=await r.text(); let j:any={};
      try{j=JSON.parse(text)}catch{j={raw:text}}
      if(!r.ok)throw new Error('HTTP_'+r.status+': '+String(j?.return_msg||j?.message||text).slice(0,180));
      return {data:j,headers:r.headers};
    }catch(e){last=e;if(k===0)await sleep(180)}finally{clearTimeout(t)}
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
  return {code,name,market,currentPrice:num(x?.closePrice??x?.currentPrice??x?.price),
    changePct:num(x?.fluctuationsRatio??x?.changeRate??x?.changePct??x?.rate),
    volume:num(x?.accumulatedTradingVolume??x?.accumulatedVolume??x?.volume),
    tradeValue:num(x?.accumulatedTradingValue??x?.tradeValue??x?.amount),
    marketCap:num(x?.marketValue??x?.marketCap)};
}
async function universeMarket(market:'KOSPI'|'KOSDAQ'){
  const out:any[]=[],seen=new Set<string>();
  for(let page=1;page<=35;page++){
    let rows:any[]=[];
    try{rows=pickArray((await fetchJson('https://m.stock.naver.com/api/stocks/marketValue/'+market+'?page='+page+'&pageSize=100')).data)}catch{break}
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
function kstFromUnix(ts:number){const d=new Date((ts+9*3600)*1000).toISOString();return {date:d.slice(0,10)}}
async function yahooDaily(code:string,market:string){
  const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol(code,market))+'?range=1y&interval=1d&events=history';
  const z=(await fetchJson(url,{},10000)).data?.chart?.result?.[0],ts:any[]=z?.timestamp||[],q=z?.indicators?.quote?.[0]||{},out:any[]=[];
  for(let i=0;i<ts.length;i++){const c=num(q.close?.[i]),o=num(q.open?.[i]),h=num(q.high?.[i]),l=num(q.low?.[i]),v=num(q.volume?.[i]);if([c,o,h,l].some(x=>x===null))continue;out.push({date:kstFromUnix(Number(ts[i])).date,open:o,high:h,low:l,close:c,volume:v||0})}
  return out;
}
function findDateTime(o:any){const raw=o?.localDateTime??o?.dateTime??o?.datetime??o?.businessDateTime??o?.time??o?.date;return raw===null||raw===undefined?'':String(raw).replace(/\D/g,'')}
function maybeBar(o:any){
  if(!o||typeof o!=='object'||Array.isArray(o))return null;
  const dt=findDateTime(o);if(dt.length<12)return null;
  const open=num(o.openPrice??o.open??o.open_pric),high=num(o.highPrice??o.high??o.high_pric),low=num(o.lowPrice??o.low??o.low_pric),
        close=num(o.closePrice??o.currentPrice??o.close??o.cur_prc),volume=num(o.accumulatedTradingVolume??o.tradingVolume??o.volume??o.trde_qty);
  if([open,high,low,close,volume].some(x=>x===null))return null;
  const d=dt.slice(0,8),tm=dt.slice(8,12);
  return {date:d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8),time:tm.slice(0,2)+':'+tm.slice(2,4),open,high,low,close,volume:Number(volume),stamp:dt.slice(0,12)};
}
function extractBars(root:any){
  const out:any[]=[],seen=new Set<string>(),q=[root];let guard=0;
  while(q.length&&guard++<30000){const x=q.pop();if(!x||typeof x!=='object')continue;if(Array.isArray(x)){for(const y of x)q.push(y);continue}const b=maybeBar(x);if(b&&!seen.has(b.stamp)){seen.add(b.stamp);out.push(b)}for(const v of Object.values(x))if(v&&typeof v==='object')q.push(v)}
  return out.sort((a,b)=>a.stamp.localeCompare(b.stamp));
}
function ymd(s:string){return s.replace(/-/g,'')}
function regular(rows:any[]){return rows.filter(b=>b.time>='09:00'&&b.time<='15:30').sort((a,b)=>a.stamp.localeCompare(b.stamp))}
async function naver5m(code:string,date:string){
  const d=ymd(date),qs=new URLSearchParams({chartInfoType:'item',reutersCode:code,timeFrame:'minute5',startDateTime:d+'090000',endDateTime:d+'153000'});
  const j=(await fetchJson('https://m.stock.naver.com/front-api/chart/domesticPriceByTime/marketInfo?'+qs.toString(),{},10000)).data;
  return regular(extractBars(j)).filter(b=>b.date===date);
}
function avg(a:number[]){return a.length?a.reduce((s,x)=>s+x,0)/a.length:0}
function feature(rows:any[]){
  const a=regular(rows);if(a.length<6)return null;
  const last=a[a.length-1],last3=a.slice(-3),last6=a.slice(-6),prior=a.slice(Math.max(0,a.length-15),-3);
  const baseVol=Math.max(1,avg((prior.length?prior:a.slice(0,-3)).map(x=>Number(x.volume)||0)));
  const r5=(Number(last.volume)||0)/baseVol,r15=last3.reduce((s,x)=>s+(Number(x.volume)||0),0)/(baseVol*3),persist=last3.filter(x=>(Number(x.volume)||0)>=baseVol*1.5).length;
  const sessionMove=(last.close/a[0].open-1)*100,move30=(last.close/last6[0].open-1)*100,hi=Math.max(...last6.map(x=>x.high)),lo=Math.min(...last6.map(x=>x.low));
  const closePos=hi===lo ? 0.5 : (last.close-lo)/(hi-lo),first3=last6.slice(0,3).reduce((s,x)=>s+x.volume,0),tail3=last3.reduce((s,x)=>s+x.volume,0),volumeSlope=first3>0?tail3/first3:1;
  return {date:last.date,time:last.time,r5,r15,persist,sessionMove,move30,closePos,volumeSlope,close:last.close,volume:last.volume,bars:a.length};
}
function sim(a:any,b:any){
  if(!a||!b)return 0;const ld=(x:number,y:number)=>Math.min(2.5,Math.abs(Math.log(Math.max(.05,x)/Math.max(.05,y))));
  const d=.26*ld(a.r5,b.r5)+.22*ld(a.r15,b.r15)+.12*Math.min(2,Math.abs(a.persist-b.persist)/2)+.16*Math.min(2,Math.abs(a.move30-b.move30)/3)+.12*Math.min(2,Math.abs(a.closePos-b.closePos))+.12*ld(a.volumeSlope,b.volumeSlope);
  return Math.round(100*Math.exp(-d)*10)/10;
}
function spikePatterns(daily:any[],spikePct:number,lookback:number){
  const out:any[]=[],start=Math.max(1,daily.length-lookback-1);
  for(let i=start;i<daily.length;i++){const prev=daily[i-1],cur=daily[i];if(!prev?.close||!cur?.close)continue;const pct=(cur.close/prev.close-1)*100;if(pct>=spikePct)out.push({spikeDate:cur.date,spikePct:pct,preDate:prev.date})}
  return out.reverse().slice(0,3);
}
function todayKst(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}

async function issueKiwoomToken(){
  const appKey=process.env.KIWOOM_APP_KEY||'',appSecret=process.env.KIWOOM_APP_SECRET||'',mode=(process.env.KIWOOM_MODE==='demo'?'demo':'real');
  if(!appKey||!appSecret)return null;
  const base=mode==='demo'?KIW_DEMO:KIW_REAL;
  const {data}=await fetchJson(base+'/oauth2/token',{method:'POST',headers:{'Content-Type':'application/json;charset=UTF-8','Referer':''},body:JSON.stringify({grant_type:'client_credentials',appkey:appKey,secretkey:appSecret})},15000);
  if(data?.return_code!==undefined&&Number(data.return_code)!==0)throw new Error(String(data.return_msg||'KIWOOM_TOKEN_FAILED'));
  return data?.token?{token:data.token,mode,expiresDt:data.expires_dt||''}:null;
}
async function kiwoom5m(code:string,date:string,auth:any){
  if(!auth?.token)return [];
  const base=auth.mode==='demo'?KIW_DEMO:KIW_REAL;
  const {data}=await fetchJson(base+'/api/dostk/chart',{method:'POST',headers:{'Content-Type':'application/json;charset=UTF-8','api-id':'ka10080','authorization':'Bearer '+auth.token,'Referer':''},body:JSON.stringify({stk_cd:code,tic_scope:'5',upd_stkpc_tp:'1',base_dt:ymd(date)})},15000);
  if(data?.return_code!==undefined&&Number(data.return_code)!==0)throw new Error(String(data.return_msg||'KIWOOM_QUERY_FAILED'));
  const list=Array.isArray(data?.stk_min_pole_chart_qry)?data.stk_min_pole_chart_qry:[],rows:any[]=[];
  for(const x of list){const dt=String(x?.cntr_tm||'').replace(/\D/g,'');if(dt.length<12)continue;const d=dt.slice(0,8),tm=dt.slice(8,12),b={date:d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8),time:tm.slice(0,2)+':'+tm.slice(2,4),open:absnum(x?.open_pric),high:absnum(x?.high_pric),low:absnum(x?.low_pric),close:absnum(x?.cur_prc),volume:absnum(x?.trde_qty),stamp:dt.slice(0,12)};if([b.open,b.high,b.low,b.close,b.volume].some(v=>v===null))continue;rows.push(b)}
  return regular(rows).filter(b=>b.date===date);
}
let tokenCache:any=null;
async function currentBars(stock:any){
  const today=todayKst();
  if(process.env.KIWOOM_APP_KEY&&process.env.KIWOOM_APP_SECRET){
    try{if(!tokenCache)tokenCache=await issueKiwoomToken();const rows=await kiwoom5m(stock.code,today,tokenCache);if(rows.length)return {rows,source:'KIWOOM_5M'}}catch{}
  }
  return {rows:await naver5m(stock.code,today),source:'NAVER_5M'};
}
async function analyzeOne(stock:any,cfg:any){
  const spikePct=clamp(cfg.spikePct??5,1,30),lookback=Math.round(clamp(cfg.lookbackDays??120,10,240)),minVol=clamp(cfg.minVol??3,1,20),maxVol=clamp(cfg.maxVol??10,minVol,50),maxCurrent=clamp(cfg.maxCurrentChange??3,-20,20);
  const daily=await yahooDaily(stock.code,stock.market),pats=spikePatterns(daily,spikePct,lookback),hist:any[]=[];
  for(const p of pats.slice(0,2)){try{const f=feature(await naver5m(stock.code,p.preDate));if(f)hist.push({...p,feature:f})}catch{}}
  const cb=await currentBars(stock),cur=feature(cb.rows);
  if(!cur)return {stock,match:false,score:0,reason:'NO_CURRENT_5M',source:cb.source,historical:hist};
  const sims=hist.map(h=>({spikeDate:h.spikeDate,preDate:h.preDate,spikePct:h.spikePct,similarity:sim(cur,h.feature),feature:h.feature})).sort((a,b)=>b.similarity-a.similarity),similarity=sims[0]?.similarity||0;
  const volGood=cur.r5>=minVol&&cur.r5<=maxVol,persistGood=cur.persist>=1,moveOk=Number(stock.changePct??cur.sessionMove)<=maxCurrent;
  const volScore=volGood?20:(cur.r5>=Math.max(1.5,minVol*.6)&&cur.r5<=maxVol*1.5?10:0),persistScore=cur.persist>=3?15:cur.persist===2?10:cur.persist===1?4:0,moveScore=moveOk?10:0,histScore=hist.length>=2?8:hist.length?5:0;
  const score=Math.round(Math.min(100,similarity*.47+volScore+persistScore+moveScore+histScore)*10)/10,match=hist.length>0&&moveOk&&volGood&&persistGood&&score>=clamp(cfg.minScore??60,0,100);
  return {stock,match,score,similarity,source:cb.source,current:cur,historical:sims,reason:match?'MATCH':(!hist.length?'NO_HIST_SPIKE':!moveOk?'CURRENT_MOVE_HIGH':!volGood?'VOLUME_RATIO':score<(cfg.minScore??60)?'LOW_SCORE':'NO_MATCH')};
}
async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>){const out:R[]=new Array(items.length);let idx=0;async function worker(){while(true){const i=idx++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch(e:any){out[i]=<any>{stock:<any>items[i],match:false,score:0,error:String(e?.message||e)}}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));return out}

export async function GET(req:Request){
  if(!validToken(reqToken(req)))return unauthorized();
  const u=new URL(req.url),op=u.searchParams.get('op')||'';
  if(op==='ping')return NextResponse.json({ok:true,version:'2026-10-07-hybrid',kiwoomConfigured:Boolean(process.env.KIWOOM_APP_KEY&&process.env.KIWOOM_APP_SECRET)});
  if(op==='universe'){try{const rows=await getUniverse(u.searchParams.get('market')||'ALL');return NextResponse.json({ok:true,count:rows.length,rows},{headers:{'Cache-Control':'no-store'}})}catch(e:any){return NextResponse.json({error:'UNIVERSE_FAILED',message:String(e?.message||e)},{status:502})}}
  if(op==='test'){try{const rows=await naver5m('005930',todayKst());return NextResponse.json({ok:true,naver5m:rows.length,latest:rows.slice(-5),kiwoomConfigured:Boolean(process.env.KIWOOM_APP_KEY&&process.env.KIWOOM_APP_SECRET)},{headers:{'Cache-Control':'no-store'}})}catch(e:any){return NextResponse.json({error:'TEST_FAILED',message:String(e?.message||e)},{status:502})}}
  return NextResponse.json({error:'BAD_OP'},{status:400});
}
export async function POST(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'',body=await req.json().catch(()=>({}));
  if(op==='login'){if(!secret()||!pass())return NextResponse.json({error:'AUTH_NOT_CONFIGURED'},{status:503});if(!validPassword(body?.code||body?.password))return NextResponse.json({error:'INVALID_CODE'},{status:401});return NextResponse.json({ok:true,token:createToken()},{headers:{'Cache-Control':'no-store'}})}
  if(!validToken(reqToken(req)))return unauthorized();
  if(op==='analyze-batch'){const stocks=Array.isArray(body?.stocks)?body.stocks.slice(0,6):[],cfg=body?.cfg||{};if(!stocks.length)return NextResponse.json({error:'NO_STOCKS'},{status:400});const started=Date.now(),results=await mapLimit(stocks,3,(s:any)=>analyzeOne(s,cfg));return NextResponse.json({ok:true,elapsedMs:Date.now()-started,results},{headers:{'Cache-Control':'no-store'}})}
  return NextResponse.json({error:'BAD_OP'},{status:400});
}
