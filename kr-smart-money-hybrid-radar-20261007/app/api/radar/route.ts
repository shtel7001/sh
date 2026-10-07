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
  const i=t.lastIndexOf('.');if(i<0)return false;
  const p=t.slice(0,i),s=t.slice(i+1);if(!p.startsWith(SCOPE+'.'))return false;
  const e=sign(p);if(e.length!==s.length)return false;
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
      const text=await r.text();let j:any={};
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
function normalizeDate(v:any){
  const s=String(v??'').replace(/\D/g,'');
  if(s.length<8)return '';
  return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);
}
async function naverDaily(code:string,count=300){
  const url='https://api.stock.naver.com/chart/domestic/item/'+encodeURIComponent(code)+'?periodType=dayCandle&count='+Math.max(20,Math.min(300,count));
  const j=(await fetchJson(url,{},12000)).data;
  const rows=Array.isArray(j?.priceInfos)?j.priceInfos:[];
  return rows.map((p:any)=>({
    date:normalizeDate(p?.localDate),
    open:num(p?.openPrice),high:num(p?.highPrice),low:num(p?.lowPrice),close:num(p?.closePrice),
    volume:num(p?.accumulatedTradingVolume)??0
  })).filter((x:any)=>x.date&&[x.open,x.high,x.low,x.close].every((v:any)=>v!==null))
    .sort((a:any,b:any)=>a.date.localeCompare(b.date));
}

function findDateTime(o:any){
  const raw=o?.localDateTime??o?.dateTime??o?.datetime??o?.businessDateTime??o?.time??o?.date;
  return raw===null||raw===undefined?'':String(raw).replace(/\D/g,'');
}
function maybeBar(o:any){
  if(!o||typeof o!=='object'||Array.isArray(o))return null;
  const dt=findDateTime(o);if(dt.length<12)return null;
  const open=num(o.openPrice??o.open??o.open_pric),high=num(o.highPrice??o.high??o.high_pric),low=num(o.lowPrice??o.low??o.low_pric),
        close=num(o.closePrice??o.currentPrice??o.close??o.cur_prc),volume=num(o.tradingVolume??o.volume??o.trde_qty??o.accumulatedTradingVolume);
  if([open,high,low,close,volume].some(x=>x===null))return null;
  const d=dt.slice(0,8),tm=dt.slice(8,12);
  return {date:d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8),time:tm.slice(0,2)+':'+tm.slice(2,4),open,high,low,close,volume:Number(volume),stamp:dt.slice(0,12)};
}
function extractBars(root:any){
  const out:any[]=[],seen=new Set<string>(),q=[root];let guard=0;
  while(q.length&&guard++<30000){
    const x=q.pop();if(!x||typeof x!=='object')continue;
    if(Array.isArray(x)){for(const y of x)q.push(y);continue}
    const b=maybeBar(x);if(b&&!seen.has(b.stamp)){seen.add(b.stamp);out.push(b)}
    for(const v of Object.values(x))if(v&&typeof v==='object')q.push(v);
  }
  return out.sort((a,b)=>a.stamp.localeCompare(b.stamp));
}
function ymd(s:string){return s.replace(/-/g,'')}
function regular(rows:any[]){return rows.filter(b=>b.time>='09:00'&&b.time<='15:30').sort((a,b)=>a.stamp.localeCompare(b.stamp))}
function normalizeVolume(rows:any[]){
  const a=regular(rows).map(x=>({...x}));
  if(a.length<8)return a;
  let nondec=0;
  for(let i=1;i<a.length;i++)if(Number(a[i].volume)>=Number(a[i-1].volume))nondec++;
  if(nondec/(a.length-1)<0.9)return a;
  let prev=0;
  for(const b of a){const cur=Math.max(0,Number(b.volume)||0);b.volume=Math.max(0,cur-prev);prev=cur}
  return a;
}
async function naver5m(code:string,date:string){
  const d=ymd(date),qs=new URLSearchParams({chartInfoType:'item',reutersCode:code,timeFrame:'minute5',startDateTime:d+'090000',endDateTime:d+'153000'});
  const j=(await fetchJson('https://m.stock.naver.com/front-api/chart/domesticPriceByTime/marketInfo?'+qs.toString(),{},10000)).data;
  return normalizeVolume(extractBars(j)).filter(b=>b.date===date);
}
function aggregateBars(rows:any[],interval:number){
  const src=regular(rows);if(interval<=5)return src;
  const buckets=new Map<string,any[]>();
  for(const b of src){
    const [hh,mm]=b.time.split(':').map(Number),mins=hh*60+mm,start=540+Math.floor((mins-540)/interval)*interval;
    const key=b.date+'-'+start;
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key)!.push(b);
  }
  const out:any[]=[];
  for(const arr of buckets.values()){
    arr.sort((a,b)=>a.stamp.localeCompare(b.stamp));
    const f=arr[0],l=arr[arr.length-1],hh=Math.floor((Number(f.time.slice(0,2))*60+Number(f.time.slice(3,5))-540)/interval)*interval+540;
    const H=Math.floor(hh/60),M=hh%60,time=String(H).padStart(2,'0')+':'+String(M).padStart(2,'0');
    out.push({date:f.date,time,open:f.open,high:Math.max(...arr.map(x=>x.high)),low:Math.min(...arr.map(x=>x.low)),close:l.close,volume:arr.reduce((s,x)=>s+(Number(x.volume)||0),0),stamp:ymd(f.date)+time.replace(':','')});
  }
  return out.sort((a,b)=>a.stamp.localeCompare(b.stamp));
}
function avg(a:number[]){return a.length?a.reduce((s,x)=>s+x,0)/a.length:0}
function feature(rows:any[]){
  const a=regular(rows);if(a.length<5)return null;
  const last=a[a.length-1],last3=a.slice(-3),last6=a.slice(-6),prior=a.slice(Math.max(0,a.length-15),-3);
  const baseVol=Math.max(1,avg((prior.length?prior:a.slice(0,-3)).map(x=>Number(x.volume)||0)));
  const rMain=(Number(last.volume)||0)/baseVol;
  const r3=last3.reduce((s,x)=>s+(Number(x.volume)||0),0)/(baseVol*Math.max(1,last3.length));
  const persist=last3.filter(x=>(Number(x.volume)||0)>=baseVol*1.5).length;
  const sessionMove=(last.close/a[0].open-1)*100;
  const moveRecent=(last.close/last6[0].open-1)*100;
  const hi=Math.max(...last6.map(x=>x.high)),lo=Math.min(...last6.map(x=>x.low));
  const closePos=hi===lo?0.5:(last.close-lo)/(hi-lo);
  const first=last6.slice(0,Math.max(1,Math.floor(last6.length/2))).reduce((s,x)=>s+x.volume,0);
  const tail=last6.slice(Math.max(1,Math.floor(last6.length/2))).reduce((s,x)=>s+x.volume,0);
  const volumeSlope=first>0?tail/first:1;
  return {date:last.date,time:last.time,rMain,r3,persist,sessionMove,moveRecent,closePos,volumeSlope,close:last.close,volume:last.volume,bars:a.length};
}
function sim(a:any,b:any){
  if(!a||!b)return 0;
  const ld=(x:number,y:number)=>Math.min(2.5,Math.abs(Math.log(Math.max(.05,x)/Math.max(.05,y))));
  const d=.30*ld(a.rMain,b.rMain)+.20*ld(a.r3,b.r3)+.12*Math.min(2,Math.abs(a.persist-b.persist)/2)+.16*Math.min(2,Math.abs(a.moveRecent-b.moveRecent)/3)+.12*Math.min(2,Math.abs(a.closePos-b.closePos))+.10*ld(a.volumeSlope,b.volumeSlope);
  return Math.round(100*Math.exp(-d)*10)/10;
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
  for(const x of list){
    const dt=String(x?.cntr_tm||'').replace(/\D/g,'');if(dt.length<12)continue;
    const d=dt.slice(0,8),tm=dt.slice(8,12),b={date:d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8),time:tm.slice(0,2)+':'+tm.slice(2,4),open:absnum(x?.open_pric),high:absnum(x?.high_pric),low:absnum(x?.low_pric),close:absnum(x?.cur_prc),volume:absnum(x?.trde_qty),stamp:dt.slice(0,12)};
    if([b.open,b.high,b.low,b.close,b.volume].some(v=>v===null))continue;
    rows.push(b);
  }
  return regular(rows).filter(b=>b.date===date);
}
let tokenCache:any=null;
async function currentBars(stock:any,interval:number){
  const today=todayKst();
  if(process.env.KIWOOM_APP_KEY&&process.env.KIWOOM_APP_SECRET){
    try{
      if(!tokenCache)tokenCache=await issueKiwoomToken();
      const rows=aggregateBars(await kiwoom5m(stock.code,today,tokenCache),interval);
      if(rows.length)return {rows,source:'KIWOOM_'+interval+'M'};
    }catch{}
  }
  return {rows:aggregateBars(await naver5m(stock.code,today),interval),source:'NAVER_'+interval+'M'};
}

async function historicalOne(stock:any,cfg:any){
  const histDate=String(cfg.histDate||''),spikePct=clamp(cfg.spikePct??5,1,30),interval=[5,15,30].includes(Number(cfg.histInterval))?Number(cfg.histInterval):5;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(histDate))return {stock,match:false,reason:'BAD_DATE'};
  const daily=await naverDaily(stock.code,300);
  const i=daily.findIndex(x=>x.date===histDate);
  if(i<1)return {stock,match:false,reason:'NO_DAILY_DATE'};
  const prev=daily[i-1],cur=daily[i],pct=(cur.close/prev.close-1)*100;
  if(pct<spikePct)return {stock,match:false,reason:'BELOW_SPIKE',spikePct:pct};
  const raw=await naver5m(stock.code,prev.date),bars=aggregateBars(raw,interval),f=feature(bars);
  if(!f)return {stock,match:false,reason:'NO_PRE_BARS',spikePct:pct,preDate:prev.date};
  return {stock,match:true,spikeDate:cur.date,spikePct:pct,preDate:prev.date,timeframe:interval,feature:f};
}

async function candidateOne(stock:any,cfg:any,patterns:any[]){
  const interval=[5,15,30].includes(Number(cfg.todayInterval))?Number(cfg.todayInterval):5;
  const minVol=clamp(cfg.minVol??3,1,20),maxVol=clamp(cfg.maxVol??10,minVol,50),maxCurrent=clamp(cfg.maxCurrentChange??3,-20,20),minScore=clamp(cfg.minScore??60,0,100);
  const cb=await currentBars(stock,interval),cur=feature(cb.rows);
  if(!cur)return {stock,match:false,score:0,reason:'NO_CURRENT_BARS',source:cb.source,current:null};
  const ranked=(patterns||[]).filter(p=>p?.feature).map(p=>({pattern:p,similarity:sim(cur,p.feature)})).sort((a,b)=>b.similarity-a.similarity);
  const best=ranked[0],similarity=best?.similarity||0,volGood=cur.rMain>=minVol&&cur.rMain<=maxVol,persistGood=cur.persist>=1,moveOk=Number(stock.changePct??cur.sessionMove)<=maxCurrent;
  const volScore=volGood?22:(cur.rMain>=Math.max(1.5,minVol*.6)&&cur.rMain<=maxVol*1.5?10:0),persistScore=cur.persist>=3?15:cur.persist===2?10:cur.persist===1?4:0,moveScore=moveOk?10:0,patternScore=best?8:0;
  const score=Math.round(Math.min(100,similarity*.45+volScore+persistScore+moveScore+patternScore)*10)/10;
  const match=!!best&&moveOk&&volGood&&persistGood&&score>=minScore;
  return {stock,match,score,similarity,source:cb.source,current:cur,timeframe:interval,
    matchedPattern:best?{stock:best.pattern.stock,spikeDate:best.pattern.spikeDate,spikePct:best.pattern.spikePct,preDate:best.pattern.preDate,timeframe:best.pattern.timeframe,feature:best.pattern.feature,similarity:best.similarity}:null,
    reason:match?'MATCH':(!best?'NO_HIST_PATTERN':!moveOk?'CURRENT_MOVE_HIGH':!volGood?'VOLUME_RATIO':score<minScore?'LOW_SCORE':'NO_MATCH')};
}
async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>){
  const out:R[]=new Array(items.length);let idx=0;
  async function worker(){while(true){const i=idx++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch(e:any){out[i]=<any>{stock:<any>items[i],match:false,error:String(e?.message||e)}}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));return out;
}

export async function GET(req:Request){
  if(!validToken(reqToken(req)))return unauthorized();
  const u=new URL(req.url),op=u.searchParams.get('op')||'';
  if(op==='ping')return NextResponse.json({ok:true,version:'2026-10-07-two-stage',kiwoomConfigured:Boolean(process.env.KIWOOM_APP_KEY&&process.env.KIWOOM_APP_SECRET)});
  if(op==='universe'){
    try{const rows=await getUniverse(u.searchParams.get('market')||'ALL');return NextResponse.json({ok:true,count:rows.length,rows},{headers:{'Cache-Control':'no-store'}})}
    catch(e:any){return NextResponse.json({error:'UNIVERSE_FAILED',message:String(e?.message||e)},{status:502})}
  }
  if(op==='test'){
    try{
      const date=todayKst(),r5=await naver5m('005930',date);
      return NextResponse.json({ok:true,date,count5:r5.length,count15:aggregateBars(r5,15).length,count30:aggregateBars(r5,30).length,kiwoomConfigured:Boolean(process.env.KIWOOM_APP_KEY&&process.env.KIWOOM_APP_SECRET)},{headers:{'Cache-Control':'no-store'}});
    }catch(e:any){return NextResponse.json({error:'TEST_FAILED',message:String(e?.message||e)},{status:502})}
  }
  return NextResponse.json({error:'BAD_OP'},{status:400});
}

export async function POST(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'',body=await req.json().catch(()=>({}));
  if(op==='login'){
    if(!secret()||!pass())return NextResponse.json({error:'AUTH_NOT_CONFIGURED'},{status:503});
    if(!validPassword(body?.code||body?.password))return NextResponse.json({error:'INVALID_CODE'},{status:401});
    return NextResponse.json({ok:true,token:createToken()},{headers:{'Cache-Control':'no-store'}});
  }
  if(!validToken(reqToken(req)))return unauthorized();

  if(op==='historical-batch'){
    const stocks=Array.isArray(body?.stocks)?body.stocks.slice(0,8):[],cfg=body?.cfg||{};
    if(!stocks.length)return NextResponse.json({error:'NO_STOCKS'},{status:400});
    const results=await mapLimit(stocks,4,(s:any)=>historicalOne(s,cfg));
    return NextResponse.json({ok:true,results},{headers:{'Cache-Control':'no-store'}});
  }

  if(op==='candidate-batch'){
    const stocks=Array.isArray(body?.stocks)?body.stocks.slice(0,8):[],cfg=body?.cfg||{},patterns=Array.isArray(body?.patterns)?body.patterns.slice(0,120):[];
    if(!stocks.length)return NextResponse.json({error:'NO_STOCKS'},{status:400});
    if(!patterns.length)return NextResponse.json({error:'NO_HIST_PATTERNS'},{status:400});
    const results=await mapLimit(stocks,4,(s:any)=>candidateOne(s,cfg,patterns));
    return NextResponse.json({ok:true,results},{headers:{'Cache-Control':'no-store'}});
  }

  return NextResponse.json({error:'BAD_OP'},{status:400});
}
