// @ts-nocheck
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

const SCOPE='kr-smart-money-pre-spike-20261005-v1';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization, X-Auth-Token','Access-Control-Allow-Methods':'POST, OPTIONS'};
const KIS='https://openapi.koreainvestment.com:9443';
const UA='Mozilla/5.0 SmartMoneyRadar/2.0';

function json(data:any,init:any={}){return NextResponse.json(data,{...init,headers:{...CORS,...(init.headers||{})}})}
function secret(){return process.env.SESSION_SECRET||''}
function sign(p:string){return crypto.createHmac('sha256',secret()+':'+SCOPE).update(p).digest('base64url')}
function reqToken(req:Request){return req.headers.get('x-auth-token')||(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'')}
function validToken(t:string){
  if(!t||!secret())return false;const i=t.lastIndexOf('.');if(i<0)return false;
  const p=t.slice(0,i),s=t.slice(i+1);if(!p.startsWith(SCOPE+'.'))return false;
  const e=sign(p);if(s.length!==e.length)return false;
  try{return crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e))}catch{return false}
}
function unauthorized(){return json({error:'UNAUTHORIZED'},{status:401})}
function num(v:any){const n=Number(String(v??'').replace(/[,\s]/g,''));return Number.isFinite(n)?n:null}
function clamp(v:any,a:number,b:number){return Math.max(a,Math.min(b,Number(v)||0))}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function ymd(s:any){return String(s||'').replace(/\D/g,'').slice(0,8)}
function dash(s:any){const x=ymd(s);return x.length===8?x.slice(0,4)+'-'+x.slice(4,6)+'-'+x.slice(6,8):String(s||'')}
function median(a:number[]){if(!a.length)return 0;const b=a.slice().sort((x,y)=>x-y),m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2}
function avg(a:number[]){return a.length?a.reduce((s,x)=>s+x,0)/a.length:0}

async function fetchText(url:string,timeout=12000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(url,{signal:c.signal,cache:'no-store',headers:{'User-Agent':UA,'Accept':'application/json,text/plain,*/*'}});if(!r.ok)throw new Error('HTTP_'+r.status);return await r.text()}finally{clearTimeout(t)}
}
function parseNaverDay(xml:string){
  const out:any[]=[];const re=/<item\s+data="([^"]+)"\s*\/?\s*>/g;let m:any;
  while((m=re.exec(xml))){const p=m[1].split('|'),date=dash(p[0]),open=num(p[1]),high=num(p[2]),low=num(p[3]),close=num(p[4]),volume=num(p[5]);if([open,high,low,close,volume].some(x=>x===null))continue;out.push({date,open,high,low,close,volume})}
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}
async function daily(code:string,count=220){
  const x=await fetchText('https://fchart.stock.naver.com/sise.nhn?symbol='+encodeURIComponent(code)+'&timeframe=day&count='+count+'&requestType=0');
  const r=parseNaverDay(x);if(r.length<45)throw new Error('DAILY_HISTORY_SHORT');return r;
}
function asOfIndex(rows:any[],asOf:string){let idx=-1;for(let i=0;i<rows.length;i++){if(rows[i].date<=asOf)idx=i;else break}return idx}

async function kisToken(appKey:string,appSecret:string){
  const r=await fetch(KIS+'/oauth2/tokenP',{method:'POST',cache:'no-store',headers:{'content-type':'application/json','User-Agent':UA},body:JSON.stringify({grant_type:'client_credentials',appkey:appKey,appsecret:appSecret})});
  const j=await r.json().catch(()=>({}));if(!r.ok||!j.access_token)throw new Error('KIS_TOKEN_'+(j.msg1||j.error_description||r.status));
  return {accessToken:j.access_token,expires:j.access_token_token_expired||null,tokenType:j.token_type||'Bearer'};
}
async function kisSlice(appKey:string,appSecret:string,accessToken:string,code:string,date:string,hour:string){
  const qs=new URLSearchParams({
    FID_COND_MRKT_DIV_CODE:'J',
    FID_INPUT_ISCD:code,
    FID_INPUT_HOUR_1:hour,
    FID_INPUT_DATE_1:ymd(date),
    FID_PW_DATA_INCU_YN:'N',
    FID_FAKE_TICK_INCU_YN:''
  });
  let last:any;
  for(let k=0;k<4;k++){
    try{
      const r=await fetch(KIS+'/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice?'+qs.toString(),{
        cache:'no-store',headers:{
          'content-type':'application/json','accept':'text/plain','authorization':'Bearer '+accessToken,
          'appkey':appKey,'appsecret':appSecret,'tr_id':'FHKST03010230','custtype':'P','User-Agent':UA
        }
      });
      const j=await r.json().catch(()=>({}));
      if(r.ok&&String(j.rt_cd)==='0'&&Array.isArray(j.output2)){
        return j.output2.map((x:any)=>({
          date:dash(x.stck_bsop_date||date),time:String(x.stck_cntg_hour||'').padStart(6,'0').slice(0,6),
          close:num(x.stck_prpr),open:num(x.stck_oprc),high:num(x.stck_hgpr),low:num(x.stck_lwpr),volume:num(x.cntg_vol)
        })).filter((x:any)=>x.time&&[x.close,x.open,x.high,x.low,x.volume].every((v:any)=>v!==null));
      }
      const msg=String(j.msg1||j.msg_cd||r.status);
      if(/초당|rate|EGW00123|429/i.test(msg)||r.status===429){last=new Error('KIS_RATE_LIMIT_'+msg);await sleep(350*(k+1));continue}
      throw new Error('KIS_MINUTE_'+msg);
    }catch(e:any){last=e;if(k<3){await sleep(300*(k+1));continue}}
  }
  throw last||new Error('KIS_MINUTE_FAILED');
}
async function kisDay(appKey:string,appSecret:string,accessToken:string,code:string,date:string){
  const hours=['153000','133000','113000','093000'];const all:any[]=[];
  for(const h of hours){const rows=await kisSlice(appKey,appSecret,accessToken,code,date,h);all.push(...rows);await sleep(80)}
  const seen=new Map<string,any>();for(const b of all){const k=b.date+'-'+b.time;if(!seen.has(k))seen.set(k,b)}
  return [...seen.values()].filter((b:any)=>b.date===date&&b.time>='090000'&&b.time<='153000').sort((a:any,b:any)=>a.time.localeCompare(b.time));
}
function bucket(time:string,minutes:number){
  const hh=Number(time.slice(0,2)),mm=Number(time.slice(2,4)),x=hh*60+mm,start=9*60;
  const k=Math.floor(Math.max(0,x-start)/minutes),t=start+k*minutes;
  return String(Math.floor(t/60)).padStart(2,'0')+String(t%60).padStart(2,'0')+'00';
}
function aggregate(rows:any[],minutes:number){
  const m=new Map<string,any>();
  for(const b of rows){const k=b.date+'-'+bucket(b.time,minutes);if(!m.has(k))m.set(k,{date:b.date,time:bucket(b.time,minutes),open:b.open,high:b.high,low:b.low,close:b.close,volume:0});const x=m.get(k);x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.volume+=b.volume}
  return [...m.values()].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
}
function group(rows:any[]){const m=new Map<string,any[]>();for(const b of rows){if(!m.has(b.date))m.set(b.date,[]);m.get(b.date).push(b)}return m}
function findDayBar(days:any[],date:string){return days.find(x=>x.date===date)}
function maxDailyRunup(days:any[],signalDate:string,baseDate:string,signalClose:number){
  const xs=days.filter(x=>x.date>signalDate&&x.date<=baseDate);if(!xs.length)return 0;return (Math.max(...xs.map(x=>x.high))/signalClose-1)*100;
}

function analyzeMinute(raw1:any[],days:any[],baseDate:string,cfg:any){
  const one=raw1.slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)),five=aggregate(one,5),fifteen=aggregate(one,15);
  const g1=group(one),g5=group(five),g15=group(fifteen);
  const dates=[...new Set(one.map(x=>x.date))].sort(),basePos=dates.indexOf(baseDate);
  const sigDates=dates.slice(Math.max(0,basePos-clamp(cfg.lookbackDays||20,5,20)),basePos);
  const min5=clamp(cfg.min5x||3,1.2,20),maxMove=clamp(cfg.maxPreMove||3,.5,10),noSurge=clamp(cfg.notSurgedPct||5,1,30);
  const signals:any[]=[];
  for(const date of sigDates){
    const p=dates.indexOf(date),prevDates=dates.slice(Math.max(0,p-20),p);if(prevDates.length<5)continue;
    const bars5=g5.get(date)||[],bars1=g1.get(date)||[],bars15=g15.get(date)||[],dayOpen=bars1[0]?.open||bars5[0]?.open;
    let cumPV=0,cumV=0;
    for(let i=0;i<bars5.length;i++){
      const b=bars5[i],same5=prevDates.map(d=>(g5.get(d)||[]).find(x=>x.time===b.time)?.volume).filter((v:any)=>Number(v)>0).map(Number);
      if(same5.length<5)continue;const base5=median(same5)||avg(same5),r5=base5?b.volume/base5:0;if(r5<min5)continue;
      const move=(b.close/dayOpen-1)*100;if(move>maxMove)continue;
      const slice1=bars1.filter(x=>x.time>=b.time&&x.time<bucket(String(Number(b.time.slice(0,2))*10000+Number(b.time.slice(2,4))*100+500).padStart(6,'0'),5));
      let r1=0;
      for(const m1 of slice1){
        const vals=prevDates.map(d=>(g1.get(d)||[]).find(x=>x.time===m1.time)?.volume).filter((v:any)=>Number(v)>0).map(Number);
        if(vals.length>=5){const z=median(vals)||avg(vals);if(z)r1=Math.max(r1,m1.volume/z)}
      }
      const b15=bars15.find(x=>x.time===bucket(b.time,15));let r15=0;
      if(b15){const vals=prevDates.map(d=>(g15.get(d)||[]).find(x=>x.time===b15.time)?.volume).filter((v:any)=>Number(v)>0).map(Number);if(vals.length>=5){const z=median(vals)||avg(vals);if(z)r15=b15.volume/z}}
      const n1=bars5[i+1],n2=bars5[i+2];const rs=[b,n1,n2].filter(Boolean).map(x=>{const vals=prevDates.map(d=>(g5.get(d)||[]).find(y=>y.time===x.time)?.volume).filter((v:any)=>Number(v)>0).map(Number);const z=vals.length?median(vals):0;return z?x.volume/z:0});const persist=rs.filter(x=>x>=Math.max(1.5,min5*.55)).length;
      cumPV+=b.close*b.volume;cumV+=b.volume;const vwap=cumV?cumPV/cumV:b.close;
      const prev3=bars5.slice(Math.max(0,i-3),i),risingLow=prev3.length?b.low>=Math.min(...prev3.map(x=>x.low)):false;
      const runup=maxDailyRunup(days,date,baseDate,b.close);
      let score=0;score+=Math.min(15,Math.max(0,(r1-1)*4));score+=Math.min(25,12+Math.max(0,r5-min5)*5);score+=Math.min(15,Math.max(0,(r15-1)*7.5));score+=persist>=3?10:persist===2?6:2;score+=move<=0?15:Math.max(0,15*(1-move/maxMove));score+=b.close>=vwap?10:0;score+=risingLow?5:0;
      score=Math.min(100,Math.round(score*10)/10);
      signals.push({date,time:b.time.slice(0,2)+':'+b.time.slice(2,4),score,ratio1:r1,ratio5:r5,ratio15:r15,persist,priceMove:move,vwapAbove:b.close>=vwap,runupAfter:runup,notSurged:runup<noSurge,close:b.close});
    }
  }
  return {one,five,fifteen,signals:signals.sort((a,b)=>b.score-a.score)};
}
async function collectWindow(appKey:string,appSecret:string,accessToken:string,code:string,tradeDates:string[]){
  const all:any[]=[];let done=0;
  for(const d of tradeDates){
    const rows=await kisDay(appKey,appSecret,accessToken,code,d);all.push(...rows);done++;
  }
  return all;
}

export async function OPTIONS(){return new NextResponse(null,{status:204,headers:CORS})}
export async function POST(req:Request){
  if(!validToken(reqToken(req)))return unauthorized();
  const u=new URL(req.url),op=u.searchParams.get('op')||'',body=await req.json().catch(()=>({}));
  const appKey=String(body?.kis?.appKey||''),appSecret=String(body?.kis?.appSecret||''),accessToken=String(body?.kis?.accessToken||'');
  if(op==='token'){
    if(!appKey||!appSecret)return json({error:'KIS_KEYS_REQUIRED'},{status:400});
    try{return json({ok:true,...await kisToken(appKey,appSecret)})}catch(e:any){return json({error:'KIS_TOKEN_FAILED',message:String(e?.message||e)},{status:502})}
  }
  if(op==='test'){
    if(!appKey||!appSecret||!accessToken)return json({error:'KIS_TOKEN_REQUIRED'},{status:400});
    try{
      const d=await daily('005930',30),date=d.at(-1)?.date,rows=await kisDay(appKey,appSecret,accessToken,'005930',date);
      return json({ok:true,date,count1m:rows.length,count5m:aggregate(rows,5).length,count15m:aggregate(rows,15).length,first:rows[0]||null,last:rows.at(-1)||null});
    }catch(e:any){return json({error:'KIS_TEST_FAILED',message:String(e?.message||e)},{status:502})}
  }
  if(op==='screen'){
    const stocks=Array.isArray(body?.stocks)?body.stocks.slice(0,50):[],cfg=body?.cfg||{},mode=body?.mode==='reverse'?'reverse':'candidate';
    const spikePct=clamp(cfg.spikePct||5,1,30),maxCurrent=clamp(cfg.maxCurrentChange??3,-20,20);
    const out:any[]=[];let idx=0;
    async function worker(){while(true){const i=idx++;if(i>=stocks.length)return;const stock=stocks[i];try{
      const days=await daily(stock.code,220),baseIdx=asOfIndex(days,String(cfg.asOf||days.at(-1)?.date));
      if(baseIdx<1){out[i]={stock,error:'HISTORY_SHORT'};continue}
      const baseDate=days[baseIdx].date,prev=days[baseIdx-1],cur=days[baseIdx],baseChange=(cur.close/prev.close-1)*100;
      const eligible=mode==='reverse'?baseChange>=spikePct:baseChange<=maxCurrent;
      out[i]={stock:{...stock,baseDate,changePct:baseChange,currentPrice:cur.close},baseDate,baseChange,eligible};
    }catch(e:any){out[i]={stock,error:String(e?.message||e)}}}}
    await Promise.all(Array.from({length:Math.min(8,stocks.length)},()=>worker()));
    return json({ok:true,mode,results:out});
  }
  if(op==='analyze'){
    const stock=body?.stock||{},cfg=body?.cfg||{};
    if(!appKey||!appSecret||!accessToken)return json({error:'KIS_TOKEN_REQUIRED'},{status:400});
    if(!/^\d{6}$/.test(String(stock.code||'')))return json({error:'BAD_STOCK'},{status:400});
    try{
      const days=await daily(stock.code,220),baseIdx=asOfIndex(days,String(cfg.asOf||days.at(-1)?.date)),baseDate=days[baseIdx]?.date;
      if(baseIdx<45)return json({error:'HISTORY_SHORT',code:stock.code},{status:422});
      const signalDays=Math.round(clamp(cfg.lookbackDays||20,5,20)),baselineDays=20;
      const tradeDates=days.slice(Math.max(0,baseIdx-signalDays-baselineDays),baseIdx+1).map(x=>x.date);
      const raw=await collectWindow(appKey,appSecret,accessToken,stock.code,tradeDates);
      const a=analyzeMinute(raw,days,baseDate,cfg),mode=body?.mode==='reverse'?'reverse':'candidate';
      let pool=a.signals;
      if(mode==='candidate')pool=pool.filter((x:any)=>x.notSurged);
      const best=pool[0]||null,baseDay=findDayBar(days,baseDate),prev=days[baseIdx-1],baseChange=prev&&baseDay?(baseDay.close/prev.close-1)*100:0;
      const spikePct=clamp(cfg.spikePct||5,1,30),maxCurrent=clamp(cfg.maxCurrentChange??3,-20,20);
      if(mode==='reverse'&&baseChange<spikePct)return json({ok:true,match:false,reason:'NOT_SPIKE_ON_BASE_DATE',stock:{...stock,baseDate,changePct:baseChange},baseDate,baseChange,stats:{days:tradeDates.length,one:a.one.length}});
      if(mode==='candidate'&&baseChange>maxCurrent)return json({ok:true,match:false,reason:'CURRENT_MOVE_TOO_HIGH',stock:{...stock,baseDate,changePct:baseChange},baseDate,baseChange,stats:{days:tradeDates.length,one:a.one.length}});
      const minScore=clamp(cfg.minScore||60,0,100),match=!!best&&best.score>=minScore;
      return json({ok:true,match,reason:match?'MATCH':best?'LOW_SCORE':'NO_PATTERN',stock:{...stock,baseDate,changePct:baseChange,currentPrice:baseDay?.close},baseDate,baseChange,best,dataSource:'KIS_1M_5M_15M',stats:{tradeDays:tradeDates.length,oneMin:a.one.length,fiveMin:a.five.length,fifteenMin:a.fifteen.length,signals:a.signals.length}});
    }catch(e:any){return json({error:'KIS_ANALYZE_FAILED',code:stock.code,message:String(e?.message||e)},{status:502})}
  }
  if(op==='detail'){
    const stock=body?.stock||{},cfg=body?.cfg||{};if(!appKey||!appSecret||!accessToken)return json({error:'KIS_TOKEN_REQUIRED'},{status:400});
    try{
      const days=await daily(stock.code,220),baseIdx=asOfIndex(days,String(cfg.asOf||days.at(-1)?.date)),baseDate=days[baseIdx]?.date,tradeDates=days.slice(Math.max(0,baseIdx-40),baseIdx+1).map(x=>x.date);
      const raw=await collectWindow(appKey,appSecret,accessToken,stock.code,tradeDates),a=analyzeMinute(raw,days,baseDate,cfg);
      return json({ok:true,baseDate,one:a.one.slice(-4500),five:a.five.slice(-1200),fifteen:a.fifteen.slice(-500),signals:a.signals.slice(0,30)});
    }catch(e:any){return json({error:'KIS_DETAIL_FAILED',message:String(e?.message||e)},{status:502})}
  }
  return json({error:'BAD_OP'},{status:400});
}