// @ts-nocheck
import crypto from 'crypto';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const SCOPE='gc-flow-accumulation-radar-20261002-v1';
const ACCESS_CODE_HASH='696db21cbff09ada1a61dce8499bd5de35f5f8a7f68a90ac294e091a131ca70f';
const UA='Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';
let yahooSession={cookie:'',crumb:'',expiresAt:0};
let spCache={rows:[],expiresAt:0,source:''};
let ndCache={rows:[],expiresAt:0,source:''};

function json(data:any,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
function secret(){return process.env.SESSION_SECRET||'';}
function sign(payload:string){return crypto.createHmac('sha256',`${secret()}:${SCOPE}`).update(payload).digest('base64url');}
function createToken(){const p=`${SCOPE}.${crypto.randomBytes(24).toString('base64url')}`;return `${p}.${sign(p)}`;}
function requestToken(req:Request){return req.headers.get('x-auth-token')||(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');}
function validToken(token?:string|null){
  if(!token||!secret())return false;const i=token.lastIndexOf('.');if(i<0)return false;
  const p=token.slice(0,i),s=token.slice(i+1);if(!p.startsWith(`${SCOPE}.`))return false;
  const e=sign(p);if(s.length!==e.length)return false;try{return crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e));}catch{return false;}
}
function validPassword(v:string){
  const actual=crypto.createHash('sha256').update(String(v||'').trim()).digest();
  try{return actual.length===32&&crypto.timingSafeEqual(actual,Buffer.from(ACCESS_CODE_HASH,'hex'));}catch{return false;}
}
function parseCookieHeader(raw:string|null){
  if(!raw)return '';const found:string[]=[];for(const name of ['A1','A3','A1S','GUC','GUCS']){
    const m=raw.match(new RegExp(`(?:^|[,;]\\s*)${name}=([^;,]+)`));if(m)found.push(`${name}=${m[1]}`);
  }return found.join('; ');
}
function mergeCookies(...parts:string[]){
  const m=new Map<string,string>();for(const part of parts)for(const item of (part||'').split(/;\s*/).filter(Boolean)){const i=item.indexOf('=');if(i>0)m.set(item.slice(0,i),item.slice(i+1));}
  return [...m.entries()].map(([k,v])=>`${k}=${v}`).join('; ');
}
async function getYahooSession(force=false){
  if(!force&&yahooSession.crumb&&Date.now()<yahooSession.expiresAt)return yahooSession;let cookie='';
  try{const r=await fetch('https://fc.yahoo.com/',{headers:{'User-Agent':UA,Accept:'*/*'},redirect:'manual',cache:'no-store'});cookie=mergeCookies(cookie,parseCookieHeader(r.headers.get('set-cookie')));}catch{}
  const cr=await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb',{headers:{'User-Agent':UA,Accept:'text/plain,*/*',...(cookie?{Cookie:cookie}:{})},cache:'no-store'});
  cookie=mergeCookies(cookie,parseCookieHeader(cr.headers.get('set-cookie')));const crumb=(await cr.text()).trim();
  if(!cr.ok||!crumb||/unauthorized|too many requests/i.test(crumb))throw new Error(`YAHOO_SESSION_${cr.status}`);
  yahooSession={cookie,crumb,expiresAt:Date.now()+20*60*1000};return yahooSession;
}
async function yahooFetch(url:string,opts:RequestInit={},retry=true){
  const s=await getYahooSession(false),h=new Headers(opts.headers||{});h.set('User-Agent',UA);h.set('Accept','application/json,text/plain,*/*');if(s.cookie)h.set('Cookie',s.cookie);
  const join=url.includes('?')?'&':'?';const r=await fetch(`${url}${join}crumb=${encodeURIComponent(s.crumb)}`,{...opts,headers:h,cache:'no-store'});
  if((r.status===401||r.status===403)&&retry){await getYahooSession(true);return yahooFetch(url,opts,false);}return r;
}
function parseCsv(text:string){
  const rows:string[][]=[];let row:string[]=[],field='',q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(q){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')q=false;else field+=ch;}else{if(ch==='"')q=true;else if(ch===','){row.push(field);field='';}else if(ch==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=ch;}}
  if(field.length||row.length){row.push(field);rows.push(row);}const head=rows.shift()||[];return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]??''])));
}
function normalizeSymbol(s:any){return String(s||'').trim().replace('.','-');}
async function sp500(){
  if(spCache.rows.length>450&&Date.now()<spCache.expiresAt)return spCache;
  const r=await fetch('https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv',{headers:{'User-Agent':UA},cache:'no-store'});
  if(!r.ok)throw new Error(`SP500_UNIVERSE_${r.status}`);
  const rows=parseCsv(await r.text()).map((x:any)=>({symbol:normalizeSymbol(x.Symbol),name:x.Security||x.Symbol,exchange:'US',marketCapB:null,universe:'S&P500',sector:x['GICS Sector']||'',industry:x['GICS Sub-Industry']||''})).filter((x:any)=>x.symbol);
  if(rows.length<450)throw new Error(`SP500_SHORT_${rows.length}`);spCache={rows,source:'Current S&P500 constituents',expiresAt:Date.now()+6*3600e3};return spCache;
}
async function screenerPage(offset:number,size:number){
  const payload={offset,size,sortField:'intradaymarketcap',sortType:'DESC',quoteType:'EQUITY',query:{operator:'AND',operands:[{operator:'EQ',operands:['region','us']},{operator:'EQ',operands:['exchange','NMS']}]},userId:'',userIdType:'guid'};
  const url='https://query1.finance.yahoo.com/v1/finance/screener?formatted=false&lang=en-US&region=US&corsDomain=finance.yahoo.com';
  const r=await yahooFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!r.ok)throw new Error(`NASDAQ_SCREENER_${r.status}`);
  const j=await r.json(),q=j?.finance?.result?.[0]?.quotes;if(!Array.isArray(q))throw new Error('NASDAQ_SCREENER_FORMAT');return q;
}
async function nasdaq500(){
  if(ndCache.rows.length>=480&&Date.now()<ndCache.expiresAt)return ndCache;
  try{
    const [allRes,listRes]=await Promise.all([
      fetch('https://raw.githubusercontent.com/zyhe16/top-us-stock-tickers/main/tickers/all.csv',{headers:{'User-Agent':UA},cache:'no-store'}),
      fetch('https://raw.githubusercontent.com/datasets/nasdaq-listings/main/data/nasdaq-listed.csv',{headers:{'User-Agent':UA},cache:'no-store'})
    ]);
    if(!allRes.ok||!listRes.ok)throw new Error(`GITHUB_NASDAQ_${allRes.status}_${listRes.status}`);
    const allRows=parseCsv(await allRes.text()),listed=new Set(parseCsv(await listRes.text()).map((x:any)=>normalizeSymbol(x.Symbol)).filter(Boolean));
    const parsed=allRows.map((q:any)=>{const symbol=normalizeSymbol(q.symbol),cap=Number(String(q.marketCap??'').replace(/[$,]/g,'')),name=String(q.name||symbol);return {symbol,name,exchange:'NASDAQ',marketCapB:Number.isFinite(cap)&&cap>0?cap/1e9:null,universe:'NASDAQ500',sector:q.industry||'',industry:q.industry||''};})
      .filter((x:any)=>x.symbol&&listed.has(x.symbol)&&Number(x.marketCapB)>0&&!/(warrant|rights?\b|units?\b|preferred|etf|fund)/i.test(x.name))
      .sort((a:any,b:any)=>Number(b.marketCapB)-Number(a.marketCapB)).slice(0,500);
    if(parsed.length<450)throw new Error(`GITHUB_NASDAQ_SHORT_${parsed.length}`);
    ndCache={rows:parsed,source:'Daily GitHub Nasdaq screener snapshot + Nasdaq listing directory',expiresAt:Date.now()+60*60e3};return ndCache;
  }catch(gitErr:any){
    try{
      const url='https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=5000&offset=0&exchange=nasdaq&download=true';
      const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json,text/plain,*/*','Accept-Language':'en-US,en;q=0.9','Origin':'https://www.nasdaq.com','Referer':'https://www.nasdaq.com/market-activity/stocks/screener'},cache:'no-store'});
      if(!r.ok)throw new Error(`NASDAQ_API_${r.status}`);const j=await r.json(),rawRows=j?.data?.table?.rows||j?.data?.rows;if(!Array.isArray(rawRows))throw new Error('NASDAQ_API_FORMAT');
      const parsed=rawRows.map((q:any)=>{const symbol=normalizeSymbol(q.symbol),cap=Number(String(q.marketCap??q.marketcap??'').replace(/[$,]/g,''));return {symbol,name:q.name||symbol,exchange:'NASDAQ',marketCapB:Number.isFinite(cap)&&cap>0?cap/1e9:null,universe:'NASDAQ500',sector:q.sector||'',industry:q.industry||''};}).filter((x:any)=>x.symbol&&Number(x.marketCapB)>0).sort((a:any,b:any)=>Number(b.marketCapB)-Number(a.marketCapB)).slice(0,500);
      if(parsed.length<450)throw new Error(`NASDAQ_API_SHORT_${parsed.length}`);ndCache={rows:parsed,source:'Nasdaq official screener market-cap ranking',expiresAt:Date.now()+60*60e3};return ndCache;
    }catch(apiErr:any){
      try{
        const quotes=[...(await screenerPage(0,250)),...(await screenerPage(250,250))],seen=new Set<string>(),rows:any[]=[];
        for(const q of quotes){const symbol=normalizeSymbol(q.symbol);if(!symbol||seen.has(symbol))continue;seen.add(symbol);rows.push({symbol,name:q.longName||q.shortName||q.displayName||symbol,exchange:q.exchange||'NMS',marketCapB:typeof q.marketCap==='number'?q.marketCap/1e9:null,universe:'NASDAQ500',sector:'',industry:''});if(rows.length>=500)break;}
        if(rows.length<450)throw new Error(`YAHOO_NASDAQ_SHORT_${rows.length}`);ndCache={rows,source:'Yahoo NASDAQ market-cap ranking',expiresAt:Date.now()+60*60e3};return ndCache;
      }catch(yahooErr:any){throw new Error(`NASDAQ_UNIVERSE_FAILED: ${gitErr?.message}; ${apiErr?.message}; ${yahooErr?.message}`);}
    }
  }
}
async function universe(kind:string){
  if(kind==='SP500')return (await sp500()).rows;
  if(kind==='NASDAQ500')return (await nasdaq500()).rows;
  const [a,b]=await Promise.all([sp500(),nasdaq500()]);const map=new Map<string,any>();
  for(const x of a.rows)map.set(x.symbol,x);
  for(const x of b.rows){const old=map.get(x.symbol);map.set(x.symbol,old?{...x,name:old.name||x.name,universe:'S&P500+NASDAQ500',sector:old.sector||'',industry:old.industry||''}:x);}
  return [...map.values()];
}
function dayStart(s:string){return Math.floor(Date.parse(s+'T00:00:00Z')/1000);}
function addDays(s:string,n:number){return Math.floor((Date.parse(s+'T00:00:00Z')+n*86400000)/1000);}
function fmtDate(ts:number){return new Date(ts*1000).toISOString().slice(0,10);}
function avg(a:number[]){return a.length?a.reduce((s,x)=>s+x,0)/a.length:0;}
function round(v:number,p=2){const m=10**p;return Math.round(v*m)/m;}
function clamp(v:number,a:number,b:number){return Math.max(a,Math.min(b,v));}

type Bar={date:string;open:number;high:number;low:number;close:number;volume:number};
async function googleFinanceRpcHistory(symbol:string,startDate:string,endDate:string){
  const endpoint='https://www.google.com/finance/_/GoogleFinanceUi/data/batchexecute',wantStart=addDays(startDate,-70),wantEnd=addDays(endDate,2);
  let best:Bar[]=[];
  const spanDays=Math.max(1,Math.ceil((Date.parse(endDate)-Date.parse(startDate))/86400000)+1);
  const mode=spanDays<=35?3:spanDays<=185?4:spanDays<=275?5:6;
  for(const exchange of ['NASDAQ','NYSE']){
    try{
      const googleSymbol=symbol.replace(/-/g,'.'),ticker=`${googleSymbol}:${exchange}`,t=[null,[googleSymbol,exchange]],req=[[t],mode];
      const arr=[['AiCwsd',JSON.stringify(req),null,'1']];
      const body='f.req='+encodeURIComponent(JSON.stringify([arr]));
      const url=`${endpoint}?rpcids=AiCwsd&source-path=${encodeURIComponent('/finance/quote/'+ticker)}&hl=en&gl=us&rt=c`;
      const r=await fetch(url,{method:'POST',headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9','Accept-Encoding':'identity','Cookie':'CONSENT=YES+','Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body,cache:'no-store'});
      if(!r.ok)continue;const raw=await r.text(),stripped=raw.replace(/^\)\]\}'\n\n?/,'').split('\n');let data:any=null;
      for(let i=0;i<stripped.length-1;i++){
        if(!/^[0-9 a-f A-F]+$/.test(stripped[i].trim()))continue;
        try{for(const entry of JSON.parse(stripped[i+1]))if(entry?.[0]==='wrb.fr'&&entry?.[1]==='AiCwsd'){data=JSON.parse(entry[2]);break;}}catch{}
        if(data)break;
      }
      const chartRaw=data?.[0]?.[0],out:Bar[]=[];
      for(const period of chartRaw?.[3]||[])for(const pt of period?.[1]||[]){
        if(!Array.isArray(pt?.[0])||!Array.isArray(pt?.[1]))continue;
        const y=Number(pt[0][0]),mo=Number(pt[0][1]),d=Number(pt[0][2]),close=Number(pt[1][0]),volume=Number(pt[2]??0);
        if(!Number.isFinite(y)||!Number.isFinite(mo)||!Number.isFinite(d)||!Number.isFinite(close)||close<=0)continue;
        const date=`${String(y).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`,ts=dayStart(date);
        if(ts<wantStart||ts>wantEnd)continue;
        out.push({date,open:close,high:close,low:close,close,volume:Number.isFinite(volume)&&volume>0?volume:0});
      }
      const uniq=[...new Map(out.map(x=>[x.date,x])).values()].sort((a,b)=>a.date.localeCompare(b.date));
      if(uniq.length>best.length&&uniq.filter(x=>x.volume>0).length>=Math.max(2,Math.floor(uniq.length*.5)))best=uniq;
      if(best.length>=Math.min(200,Math.max(20,Math.ceil((Date.parse(endDate)-Date.parse(startDate))/86400000*.55))))break;
    }catch{}
  }
  if(best.length<3)throw new Error('GOOGLE_FINANCE_RPC_HISTORY_SHORT');
  return {bars:best,meta:{symbol},source:'Google Finance chart RPC'};
}
async function googleFinanceHistory(symbol:string,startDate:string,endDate:string){
  const googleSymbol=symbol.replace(/-/g,'.'),candidates=[`${googleSymbol}:NASDAQ`,`${googleSymbol}:NYSE`],wantStart=addDays(startDate,-70),wantEnd=addDays(endDate,2);
  let best:Bar[]=[];
  for(const gs of candidates){
    try{
      const r=await fetch(`https://www.google.com/finance/quote/${encodeURIComponent(gs)}`,{headers:{'User-Agent':UA,'Accept':'text/html,*/*','Accept-Language':'en-US,en;q=0.9'},cache:'no-store'});
      if(!r.ok)continue;const html=await r.text(),re=/\[\[\[\d{4},\d{1,2},\d{1,2}/g;let m;
      while((m=re.exec(html))){
        const payload=extractBalancedArray(html,m.index);if(!payload)continue;
        try{
          const data=JSON.parse(payload);if(!Array.isArray(data)||data.length<3)continue;const out:Bar[]=[];
          for(const pt of data){
            if(!Array.isArray(pt)||!Array.isArray(pt[0])||!Array.isArray(pt[1]))continue;
            const y=Number(pt[0][0]),mo=Number(pt[0][1]),d=Number(pt[0][2]),close=Number(pt[1][0]),volume=Number(pt[2]??0);
            if(!Number.isFinite(y)||!Number.isFinite(mo)||!Number.isFinite(d)||!Number.isFinite(close)||close<=0)continue;
            const date=`${String(y).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const ts=dayStart(date);if(ts<wantStart||ts>wantEnd)continue;
            out.push({date,open:close,high:close,low:close,close,volume:Number.isFinite(volume)&&volume>0?volume:0});
          }
          const uniq=[...new Map(out.map(x=>[x.date,x])).values()].sort((a,b)=>a.date.localeCompare(b.date));
          const withVol=uniq.filter(x=>x.volume>0).length;
          if(uniq.length>best.length&&withVol>=Math.max(2,Math.floor(uniq.length*.5)))best=uniq;
        }catch{}
      }
      if(best.length>=3)break;
    }catch{}
  }
  if(best.length<3)throw new Error('GOOGLE_FINANCE_HISTORY_SHORT');
  return {bars:best,meta:{symbol},source:'Google Finance page timeline'};
}
async function history(symbol:string,startDate:string,endDate:string){
  try{return await googleFinanceRpcHistory(symbol,startDate,endDate);}catch{}
  const spanDays=Math.max(1,Math.ceil((Date.parse(endDate)-Date.parse(startDate))/86400000)+1);
  if(spanDays<=35){try{return await googleFinanceHistory(symbol,startDate,endDate);}catch{}}
  const p1=addDays(startDate,-70),p2=addDays(endDate,2),parseYahoo=async(host:string)=>{
    const url=`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
    const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json,text/plain,*/*','Referer':'https://finance.yahoo.com/'},cache:'no-store'});
    if(!r.ok)throw new Error(`YAHOO_CHART_${r.status}`);const j=await r.json(),root=j?.chart?.result?.[0];if(!root)throw new Error(j?.chart?.error?.description||'YAHOO_CHART_EMPTY');
    const ts=root.timestamp||[],q=root.indicators?.quote?.[0]||{},adj=root.indicators?.adjclose?.[0]?.adjclose||[],out:Bar[]=[];
    for(let i=0;i<ts.length;i++){const close=Number(adj[i]??q.close?.[i]);if(!Number.isFinite(close)||close<=0)continue;out.push({date:fmtDate(ts[i]),open:Number(q.open?.[i])||close,high:Number(q.high?.[i])||close,low:Number(q.low?.[i])||close,close,volume:Number(q.volume?.[i])||0});}
    if(out.length<3)throw new Error('YAHOO_HISTORY_SHORT');return {bars:out,meta:root.meta||{},source:'Yahoo Finance chart'};
  };
  try{return await parseYahoo('query2.finance.yahoo.com');}catch{}
  try{return await parseYahoo('query1.finance.yahoo.com');}catch{}
  try{
    const iso1=fmtDate(p1),iso2=fmtDate(p2),toUS=(iso:string)=>{const [y,m,d]=iso.split('-');return `${m}/${d}/${y}`;};
    const url=`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=stocks&fromdate=${encodeURIComponent(toUS(iso1))}&todate=${encodeURIComponent(toUS(iso2))}&limit=5000`;
    const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json,text/plain,*/*','Accept-Language':'en-US,en;q=0.9','Origin':'https://www.nasdaq.com','Referer':`https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(symbol.toLowerCase())}/historical`},cache:'no-store'});
    if(!r.ok)throw new Error(`NASDAQ_HISTORY_${r.status}`);const j=await r.json(),rows=j?.data?.tradesTable?.rows;
    if(!Array.isArray(rows))throw new Error('NASDAQ_HISTORY_FORMAT');const num=(v:any)=>Number(String(v??'').replace(/[$,]/g,'')),out:Bar[]=[];
    for(const x of rows){const md=String(x.date||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!md)continue;const date=`${md[3]}-${md[1].padStart(2,'0')}-${md[2].padStart(2,'0')}`,close=num(x.close);if(!Number.isFinite(close)||close<=0)continue;out.push({date,open:num(x.open)||close,high:num(x.high)||close,low:num(x.low)||close,close,volume:num(x.volume)||0});}
    out.sort((a,b)=>a.date.localeCompare(b.date));if(out.length<3)throw new Error('NASDAQ_HISTORY_SHORT');return {bars:out,meta:{symbol},source:'Nasdaq historical'};
  }catch{}
  const d1=fmtDate(p1).replace(/-/g,''),d2=fmtDate(p2).replace(/-/g,''),stooq=String(symbol).toLowerCase().replace(/\//g,'-')+'.us';
  const sr=await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(stooq)}&d1=${d1}&d2=${d2}&i=d`,{headers:{'User-Agent':UA,'Accept':'text/csv,text/plain,*/*'},cache:'no-store'});
  if(!sr.ok)throw new Error(`HISTORY_ALL_SOURCES_FAILED_STOOQ_${sr.status}`);const tx=await sr.text(),lines=tx.trim().split(/\r?\n/),out:Bar[]=[];
  for(let i=1;i<lines.length;i++){const [date,o,h,l,c,v]=lines[i].split(','),close=Number(c);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(close)||close<=0)continue;out.push({date,open:Number(o)||close,high:Number(h)||close,low:Number(l)||close,close,volume:Number(v)||0});}
  if(out.length<3)throw new Error('HISTORY_SHORT_ALL_SOURCES');return {bars:out,meta:{symbol},source:'Stooq daily fallback'};
}
function analyze(all:Bar[],startDate:string,endDate:string,cfg:any){
  const sy=startDate,ey=endDate,inRange=all.filter(x=>x.date>=sy&&x.date<=ey);if(inRange.length<3)return {pass:false,reason:'RANGE_SHORT',tradingDays:inRange.length};
  const firstIndex=all.findIndex(x=>x.date===inRange[0].date),lastIndex=all.findIndex(x=>x.date===inRange[inRange.length-1].date);
  let upVol=0,downVol=0,flatVol=0,obv=0,obvStart=0,acc=0,dist=0,spikeUp=0;const cmfParts:any[]=[];
  for(let i=Math.max(1,firstIndex);i<=lastIndex;i++){
    const b=all[i],p=all[i-1],chg=(b.close/p.close-1)*100;
    if(i===firstIndex)obvStart=obv;
    if(b.close>p.close){obv+=b.volume;upVol+=b.volume;}else if(b.close<p.close){obv-=b.volume;downVol+=b.volume;}else flatVol+=b.volume;
    const prev20=all.slice(Math.max(0,i-20),i).map(x=>x.volume).filter(Boolean),av20=avg(prev20)||b.volume;
    if(chg>=1&&b.volume>=p.volume*1.05)acc++;
    if(chg<=-1&&b.volume>=p.volume*1.05)dist++;
    if(chg>0&&b.volume>=av20*1.5)spikeUp++;
    const pressure=p.close?((b.close/p.close-1)*100)*b.volume:0;cmfParts.push({mf:pressure,v:b.volume});
  }
  const totalVol=upVol+downVol+flatVol,upShare=totalVol?upVol/totalVol*100:0,obvBalance=totalVol?(obv-obvStart)/totalVol*100:0;
  const cmfDen=cmfParts.reduce((s,x)=>s+x.v,0),cmf=cmfDen?cmfParts.reduce((s,x)=>s+x.mf,0)/cmfDen:0;
  const vols=inRange.map(x=>x.volume),last5=vols.slice(-Math.min(5,vols.length)),prior=vols.slice(Math.max(0,vols.length-25),Math.max(0,vols.length-5)),volRatio=avg(last5)/(avg(prior)||avg(vols)||1);
  const vwapDen=inRange.reduce((s,x)=>s+x.volume,0),vwap=vwapDen?inRange.reduce((s,x)=>s+((x.high+x.low+x.close)/3)*x.volume,0)/vwapDen:inRange[inRange.length-1].close;
  const first=inRange[0],last=inRange[inRange.length-1],ret=(last.close/first.close-1)*100,vsVwap=(last.close/vwap-1)*100,minLow=Math.min(...inRange.map(x=>x.low)),maxHigh=Math.max(...inRange.map(x=>x.high)),rangePos=maxHigh>minLow?(last.close-minLow)/(maxHigh-minLow)*100:50;
  let score=0;score+=clamp((upShare-45)*0.8,0,20);score+=clamp((obvBalance+5)*0.75,0,15);score+=clamp((cmf+5)*0.75,0,15);score+=clamp((volRatio-.8)*20,0,15);score+=clamp((acc-dist+2)*2.5,0,15);score+=clamp((vsVwap+3)*1.5,0,10);score+=clamp((rangePos-40)*0.25,0,10);
  const checks={upShare:upShare>=cfg.minUpVolumeShare,obv:obvBalance>=cfg.minObvBalance,cmf:cmf>=cfg.minCmf,acc:acc>=cfg.minAccumDays,dist:dist<=cfg.maxDistributionDays,volRatio:volRatio>=cfg.minVolumeRatio,vsVwap:vsVwap>=cfg.minPriceVsVwap};
  const pass=Object.values(checks).every(Boolean);
  let mode='혼합/중립';if(upShare>=62&&obvBalance>=10&&cmf>=5)mode='강한 매집';else if(volRatio>=1.5&&ret>=3)mode='거래량 돌파';else if(obvBalance>=8&&acc>dist)mode='OBV 매집';else if(upShare>=55&&vsVwap>=0)mode='완만 매집';
  return {pass,score:round(score,1),mode,checks,startDate:first.date,endDate:last.date,tradingDays:inRange.length,startPrice:round(first.close,2),endPrice:round(last.close,2),returnPct:round(ret,2),upVolumeSharePct:round(upShare,2),obvBalancePct:round(obvBalance,2),cmfPct:round(cmf,2),recentVolumeRatio:round(volRatio,2),accumulationDays:acc,distributionDays:dist,highVolumeUpDays:spikeUp,priceVsVwapPct:round(vsVwap,2),rangePositionPct:round(rangePos,1),vwap:round(vwap,2),recent:inRange.slice(-20).reverse().map((x,i)=>({date:x.date,close:round(x.close,2),volume:x.volume}))};
}
async function scanOne(s:any,startDate:string,endDate:string,cfg:any){
  const {bars,meta,source}=await history(s.symbol,startDate,endDate),flow=analyze(bars,startDate,endDate,cfg);
  return {...s,name:s.name||meta.longName||meta.shortName||s.symbol,exchange:s.exchange||meta.exchangeName||meta.exchange||'',priceSource:source||'US daily',flow,totalScore:flow.score,pass:flow.pass,yahoo:`https://finance.yahoo.com/quote/${encodeURIComponent(s.symbol)}/`,chart:`https://finance.yahoo.com/quote/${encodeURIComponent(s.symbol)}/chart/`,news:`https://finance.yahoo.com/quote/${encodeURIComponent(s.symbol)}/news/`};
}


function extractBalancedArray(text:string,start:number){
  let depth=0,inString=false,escape=false;
  for(let i=start;i<text.length;i++){const ch=text[i];if(inString){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')inString=false;continue;}if(ch==='"')inString=true;else if(ch==='[')depth++;else if(ch===']'){depth--;if(depth===0)return text.slice(start,i+1);}}
  return null;
}
function googleSeriesProbe(html:string){
  const out:any[]=[],re=/\[\[\[\d{4},\d{1,2},\d{1,2}/g;let m;
  while((m=re.exec(html))&&out.length<12){const p=extractBalancedArray(html,m.index);if(!p)continue;try{const d=JSON.parse(p);if(Array.isArray(d)&&d.length>=2)out.push({len:d.length,first:d[0],second:d[1]});}catch{}}
  return out;
}

async function googleRpcModeProbe(symbol:string,exchange:string){
  const endpoint='https://www.google.com/finance/_/GoogleFinanceUi/data/batchexecute',ticker=`${symbol}:${exchange}`,t=[null,[symbol,exchange]],out:any[]=[];
  for(let mode=0;mode<=12;mode++){
    try{
      const arr=[['AiCwsd',JSON.stringify([[t],mode]),null,'1']],body='f.req='+encodeURIComponent(JSON.stringify([arr]));
      const url=`${endpoint}?rpcids=AiCwsd&source-path=${encodeURIComponent('/finance/quote/'+ticker)}&hl=en&gl=us&rt=c`;
      const r=await fetch(url,{method:'POST',headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9','Accept-Encoding':'identity','Cookie':'CONSENT=YES+','Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body,cache:'no-store'});
      const raw=await r.text(),lines=raw.replace(/^\)\]\}'\n\n?/,'').split('\n');let data:any=null;
      for(let i=0;i<lines.length-1;i++){if(!/^[0-9 a-f A-F]+$/.test(lines[i].trim()))continue;try{for(const entry of JSON.parse(lines[i+1]))if(entry?.[0]==='wrb.fr'&&entry?.[1]==='AiCwsd'){data=JSON.parse(entry[2]);break;}}catch{}if(data)break;}
      const pts:any[]=[];for(const period of data?.[0]?.[0]?.[3]||[])for(const pt of period?.[1]||[]){if(Array.isArray(pt?.[0])&&Array.isArray(pt?.[1]))pts.push(pt);}
      const dates=pts.map(pt=>`${pt[0][0]}-${String(pt[0][1]).padStart(2,'0')}-${String(pt[0][2]).padStart(2,'0')}`).sort();
      out.push({mode,status:r.status,count:pts.length,first:dates[0]||null,last:dates[dates.length-1]||null,volumePoints:pts.filter(pt=>Number(pt?.[2])>0).length});
    }catch(e:any){out.push({mode,error:String(e?.message||e)});}
  }
  return out;
}

export async function GET(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'';
  if(op==='health'){
    try{const symbol=String(u.searchParams.get('symbol')||'MSFT').toUpperCase(),start=String(u.searchParams.get('start')||'2026-08-01'),end=String(u.searchParams.get('end')||'2026-10-01');const r=await scanOne({symbol,name:symbol,universe:'HEALTH'},start,end,{minUpVolumeShare:0,minObvBalance:-100,minCmf:-100,minAccumDays:0,maxDistributionDays:999,minVolumeRatio:0,minPriceVsVwap:-100});return json({ok:true,result:r});}catch(e:any){return json({ok:false,error:String(e?.message||e)},502);}
  }
  if(op==='healthUniverse'){
    try{const kind=String(u.searchParams.get('kind')||'NASDAQ500').toUpperCase(),rows=await universe(kind);return json({ok:true,kind,count:rows.length,sample:rows.slice(0,5)});}catch(e:any){return json({ok:false,error:String(e?.message||e)},502);}
  }
  if(!validToken(requestToken(req)))return json({error:'UNAUTHORIZED'},401);
  if(op==='universe'){
    try{const kind=String(u.searchParams.get('kind')||'SP500').toUpperCase();const rows=await universe(kind);return json({ok:true,kind,count:rows.length,rows});}catch(e:any){return json({ok:false,error:String(e?.message||e)},502);}
  }
  return json({error:'BAD_OP'},400);
}
export async function POST(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'',body:any=await req.json().catch(()=>({}));
  if(op==='login'){
    if(!secret())return json({error:'AUTH_NOT_CONFIGURED'},503);if(!validPassword(String(body?.code||body?.password||'')))return json({error:'INVALID_CODE'},401);return json({ok:true,token:createToken()});
  }
  if(!validToken(requestToken(req)))return json({error:'UNAUTHORIZED'},401);
  if(op==='scan'){
    const stocks=Array.isArray(body.stocks)?body.stocks.slice(0,12):[],b=body.cfg||{},startDate=String(b.startDate||''),endDate=String(b.endDate||'');
    if(!stocks.length)return json({error:'NO_STOCKS'},400);if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||startDate>endDate)return json({error:'BAD_DATE_RANGE'},400);
    const cfg={minUpVolumeShare:clamp(Number(b.minUpVolumeShare??55),0,100),minObvBalance:clamp(Number(b.minObvBalance??0),-100,100),minCmf:clamp(Number(b.minCmf??0),-100,100),minAccumDays:clamp(Number(b.minAccumDays??2),0,200),maxDistributionDays:clamp(Number(b.maxDistributionDays??6),0,200),minVolumeRatio:clamp(Number(b.minVolumeRatio??0.8),0,10),minPriceVsVwap:clamp(Number(b.minPriceVsVwap??-3),-100,100)};
    const results:any[]=[],errors:any[]=[];
    for(let i=0;i<stocks.length;i+=4){const rr=await Promise.all(stocks.slice(i,i+4).map(async(s:any)=>{try{return await scanOne(s,startDate,endDate,cfg);}catch(e:any){return {...s,scanError:String(e?.message||e)};}}));for(const x of rr){if(x.scanError)errors.push(x);else results.push(x);}}
    results.sort((a,b)=>Number(b.totalScore||0)-Number(a.totalScore||0));return json({ok:true,results,errors,count:results.length});
  }
  return json({error:'BAD_OP'},400);
}