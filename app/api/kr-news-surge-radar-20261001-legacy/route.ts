import { NextRequest, NextResponse } from 'next/server';
import { estimatedPage, jfetch, num } from '@/lib/historical-spike-naver';
import { isHistoricalAuthed } from '@/lib/historical-spike-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const UA = 'Mozilla/5.0 (Linux; Android 16; Mobile) AppleWebKit/537.36 Chrome/140 Safari/537.36';

type Market = 'KOSPI' | 'KOSDAQ';
type Stock = { code:string; name:string; market:Market; rank?:number; currentPrice?:number|null; currentChange?:number|null };
type Cfg = { asOf:string; spikeFrom:number; spikeTo:number; spikeMin:number; spikeMax:number; recentDays:number; preNewsDays:number; minSignalScore:number; maxNewsItems:number };

function clamp(n:number,a:number,b:number){ return Math.max(a,Math.min(b,n)); }
function dstr(d:Date){ return d.toISOString().slice(0,10); }
function addDays(s:string,n:number){ const d=new Date(`${s}T12:00:00+09:00`); d.setDate(d.getDate()+n); return dstr(d); }
function isDate(s:string){ return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(new Date(`${s}T12:00:00+09:00`).getTime()); }
function withinCalendarDays(s:string,days=370){ if(!isDate(s)) return false; const t=new Date(`${s}T12:00:00+09:00`).getTime(); const diff=(Date.now()-t)/86400000; return diff>=-2 && diff<=days; }
function avg(a:number[]){ return a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0; }
function pct(a:number,b:number){ return b ? (a/b-1)*100 : 0; }
function n(v:any,d=0){ const x=num(v); return x==null?d:x; }
function spacName(name:string){ return /스팩|기업인수목적|SPAC/i.test(name); }
function cfgNum(v:any,d:number){ const x=Number(v); return Number.isFinite(x)?x:d; }

function pickRows(data:any):any[]{
  if(Array.isArray(data)) return data;
  for(const k of ['stocks','stockList','items','data','result']) if(Array.isArray(data?.[k])) return data[k];
  if(Array.isArray(data?.result?.stocks)) return data.result.stocks;
  if(Array.isArray(data?.result?.items)) return data.result.items;
  return [];
}
async function marketPage(market:Market,page:number){
  try { return pickRows(await jfetch(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`,12000)); }
  catch { return pickRows(await jfetch(`https://m.stock.naver.com/api/stock/domestic/stockList?sortType=marketValue&category=${market}&page=${page}&pageSize=100`,12000)); }
}
function normalizeStock(r:any,market:Market,rank:number):Stock|null{
  const code=String(r?.itemCode??r?.itemcode??r?.stockCode??r?.code??'').match(/\d{6}/)?.[0]||'';
  const name=String(r?.stockName??r?.name??r?.itemName??'').trim();
  if(!code||!name||spacName(name)) return null;
  return {code,name,market,rank,currentPrice:num(r?.closePrice??r?.currentPrice??r?.nv),currentChange:num(r?.fluctuationsRatio??r?.changeRate??r?.cr)};
}
async function pool<T,R>(items:T[],limit:number,fn:(x:T,i:number)=>Promise<R>):Promise<R[]>{
  const out=new Array<R>(items.length); let p=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const i=p++;if(i>=items.length)break;out[i]=await fn(items[i],i);}}));
  return out;
}
async function fetchMarketAll(market:Market){
  const maxPages=market==='KOSPI'?18:28;
  const pages=Array.from({length:maxPages},(_,i)=>i+1);
  const groups=await pool(pages,7,async p=>{try{return await marketPage(market,p)}catch{return []}});
  const out:Stock[]=[]; const seen=new Set<string>();
  groups.forEach(rows=>rows.forEach(r=>{const x=normalizeStock(r,market,out.length+1);if(x&&!seen.has(x.code)){seen.add(x.code);out.push(x);}}));
  const minimum=market==='KOSPI'?650:900;
  if(out.length<minimum) throw new Error(`${market} 전종목 목록 수집이 불완전합니다. (${out.length}종목)`);
  return out.map((x,i)=>({...x,rank:i+1}));
}

async function priceBars(code:string,asOf:string){
  const pageSize=100;
  const guess=estimatedPage(asOf,pageSize);
  const candidates=[guess,guess+1,Math.max(1,guess-1)];
  const pages:any[][]=[];
  for(const p of [...new Set(candidates)]){
    try{
      const arr=await jfetch(`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/price?pageSize=${pageSize}&page=${p}`,12000);
      if(Array.isArray(arr)&&arr.length) pages.push(arr);
      const flat=pages.flat();
      const usable=flat.filter((x:any)=>String(x?.localTradedAt||'')<=asOf);
      if(usable.length>=60) break;
    }catch{}
  }
  const map=new Map<string,any>();
  pages.flat().forEach((b:any)=>{const dt=String(b?.localTradedAt||'');if(dt&&!map.has(dt))map.set(dt,b);});
  return Array.from(map.values()).filter((b:any)=>String(b?.localTradedAt||'')<=asOf).sort((a:any,b:any)=>String(b.localTradedAt).localeCompare(String(a.localTradedAt)));
}
function barObj(b:any){return {date:String(b?.localTradedAt||''),open:n(b?.openPrice),high:n(b?.highPrice),low:n(b?.lowPrice),close:n(b?.closePrice),change:n(b?.fluctuationsRatio),volume:n(b?.accumulatedTradingVolume)};}

async function scanOne(s:Stock,cfg:Cfg){
  try{
    const raw=await priceBars(s.code,cfg.asOf); const bars=raw.map(barObj);
    if(bars.length<Math.max(cfg.spikeTo+22,35)) return null;
    const from=clamp(Math.min(cfg.spikeFrom,cfg.spikeTo),1,30),to=clamp(Math.max(cfg.spikeFrom,cfg.spikeTo),1,30);
    const lo=Math.min(cfg.spikeMin,cfg.spikeMax),hi=Math.max(cfg.spikeMin,cfg.spikeMax);
    const spikes=[] as any[];
    for(let off=from;off<=to&&off<bars.length;off++){
      const b=bars[off]; if(b.change<lo||b.change>hi) continue;
      const prevVol=bars.slice(off+1,off+21).map(x=>x.volume).filter(x=>x>0);
      const volRatio=avg(prevVol)>0?b.volume/avg(prevVol):0;
      spikes.push({...b,offset:off,volRatio});
    }
    if(!spikes.length) return null;
    spikes.sort((a,b)=>(b.change+Math.min(10,b.volRatio*2))-(a.change+Math.min(10,a.volRatio*2)) || a.offset-b.offset);
    const sp=spikes[0], cur=bars[0];
    const rd=clamp(cfg.recentDays,1,20);
    const recent=bars.slice(0,rd); const recentOld=recent[recent.length-1]||cur;
    const v5=avg(bars.slice(0,Math.min(5,bars.length)).map(x=>x.volume));
    const v20=avg(bars.slice(0,Math.min(20,bars.length)).map(x=>x.volume));
    const ma5=avg(bars.slice(0,5).map(x=>x.close)),ma20=avg(bars.slice(0,20).map(x=>x.close));
    const retRecent=pct(cur.close,recentOld.close);
    const volRatioRecent=v20>0?v5/v20:0;
    const ma5Pct=pct(cur.close,ma5),ma20Pct=pct(cur.close,ma20);
    const lows20=bars.slice(0,20).map(x=>x.low).filter(x=>x>0);
    const closePos20=lows20.length?pct(cur.close,Math.min(...lows20)):0;
    let tech=36;
    tech+=clamp((sp.change-lo)/(Math.max(1,hi-lo))*18,0,18);
    tech+=clamp(sp.volRatio*4,0,14);
    tech+=clamp((retRecent+6)*1.4,0,18);
    tech+=clamp(volRatioRecent*5,0,10);
    if(ma5Pct>=-3&&ma5Pct<=8) tech+=5;
    if(ma20Pct>=-8&&ma20Pct<=12) tech+=5;
    tech-=clamp(Math.max(0,closePos20-35)/4,0,10);
    tech=clamp(Math.round(tech),0,100);
    return {
      code:s.code,name:s.name,market:s.market,asOf:cur.date,currentPrice:cur.close,currentChange:cur.change,
      spikeDate:sp.date,spikePct:sp.change,spikeOffset:sp.offset,spikeVolumeRatio:Number(sp.volRatio.toFixed(2)),
      recentFrom:recentOld.date,recentDays:rd,recentReturnPct:Number(retRecent.toFixed(2)),recentVolumeRatio:Number(volRatioRecent.toFixed(2)),
      ma5Pct:Number(ma5Pct.toFixed(2)),ma20Pct:Number(ma20Pct.toFixed(2)),technicalScore:tech,
      naver:`https://finance.naver.com/item/main.naver?code=${s.code}`,
      naverNews:`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(s.name+' 주식')}`
    };
  }catch{return null;}
}

const TOPICS:{name:string;words:string[]}[]=[
  {name:'수주·계약',words:['수주','계약','공급계약','공급','납품','mou','업무협약','파트너십','장기계약']},
  {name:'실적·흑자',words:['실적','영업이익','흑자','매출','어닝','가이던스','최대 실적','턴어라운드']},
  {name:'바이오·FDA',words:['fda','임상','허가','승인','ind','신약','기술수출','기술이전','lo','품목허가']},
  {name:'AI·반도체',words:['ai','인공지능','hbm','반도체','데이터센터','gpu','cxl','lpddr','pim','패키징']},
  {name:'로봇·자동화',words:['로봇','휴머노이드','자동화','스마트팩토리','협동로봇']},
  {name:'방산·우주',words:['방산','국방','미사일','우주','위성','드론','항공우주']},
  {name:'원전·전력',words:['원전','smr','전력망','변압기','전선','송전','배전','ess','전력기기']},
  {name:'2차전지',words:['2차전지','배터리','양극재','음극재','전해액','리튬','전고체']},
  {name:'정책·정부',words:['정부','정책','지원','국책','예산','규제완화','산업부','보조금']},
  {name:'주주환원',words:['자사주','배당','소각','주주환원','무상증자']},
  {name:'M&A·지분',words:['인수','합병','m&a','지분','투자유치','최대주주','경영권']}
];
function decodeXml(s:string){return s.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function tag(block:string,name:string){const m=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));return m?decodeXml(m[1].trim()):'';}
function pubKstDate(s:string){const d=new Date(s);if(!Number.isFinite(d.getTime()))return '';return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
async function rssNews(name:string,from:string,to:string,maxItems:number){
  const q=encodeURIComponent(`\"${name}\" 주식 after:${from} before:${addDays(to,1)}`);
  const r=await fetch(`https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`,{headers:{'user-agent':UA},cache:'no-store'});
  if(!r.ok) throw new Error(`NEWS_HTTP_${r.status}`);
  const xml=await r.text(),items:any[]=[];
  for(const block of xml.match(/<item>[\s\S]*?<\/item>/gi)||[]){
    const title=tag(block,'title').replace(/\s+-\s+[^-]+$/,'').trim(); const link=tag(block,'link'),pubDate=tag(block,'pubDate'),source=tag(block,'source');
    if(title&&link){items.push({title,link,pubDate,date:pubKstDate(pubDate),source});if(items.length>=maxItems)break;}
  }
  return items;
}
function topicHits(items:any[]){
  const hit=new Map<string,number>();
  items.forEach(it=>{const t=String(it.title||'').toLowerCase();TOPICS.forEach(g=>{if(g.words.some(w=>t.includes(w.toLowerCase())))hit.set(g.name,(hit.get(g.name)||0)+1);});});
  return Array.from(hit.entries()).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count}));
}
async function enrichOne(r:any,cfg:Cfg){
  try{
    const preFrom=addDays(r.spikeDate,-clamp(cfg.preNewsDays,1,60));
    const recentFrom=r.recentFrom||addDays(r.asOf,-10);
    const allFrom=preFrom<recentFrom?preFrom:recentFrom;
    const items=await rssNews(r.name,allFrom,r.asOf,clamp(cfg.maxNewsItems,5,30));
    const historical=items.filter(x=>x.date&&x.date>=preFrom&&x.date<=r.spikeDate);
    const recent=items.filter(x=>x.date&&x.date>=recentFrom&&x.date<=r.asOf);
    const hTopics=topicHits(historical),rTopics=topicHits(recent);
    const hSet=new Set(hTopics.map(x=>x.name)),rSet=new Set(rTopics.map(x=>x.name));
    const overlap=Array.from(rSet).filter(x=>hSet.has(x));
    const recentTopicCount=rTopics.reduce((a,x)=>a+x.count,0);
    let newsScore=20 + Math.min(20,recent.length*3) + Math.min(30,overlap.length*10) + Math.min(20,recentTopicCount*2);
    if(!recent.length) newsScore=10;
    newsScore=clamp(Math.round(newsScore),0,100);
    const finalScore=clamp(Math.round((Number(r.technicalScore)||0)*0.58+newsScore*0.42),0,100);
    const reasons:string[]=[];
    if(overlap.length) reasons.push(`과거 급등 전·최근 뉴스 재점화: ${overlap.join(', ')}`);
    if(recent.length>=3) reasons.push(`최근 뉴스 ${recent.length}건`);
    if((r.recentVolumeRatio||0)>=1.2) reasons.push(`최근 거래량 ${r.recentVolumeRatio}배`);
    if((r.recentReturnPct||0)>0) reasons.push(`최근 ${r.recentDays}거래일 +${r.recentReturnPct}%`);
    if((r.spikeVolumeRatio||0)>=2) reasons.push(`과거 급등 거래량 ${r.spikeVolumeRatio}배`);
    return {...r,preNewsFrom:preFrom,recentNewsFrom:recentFrom,historicalNews:historical.slice(0,10),recentNews:recent.slice(0,10),historicalTopics:hTopics,recentTopics:rTopics,overlapTopics:overlap,newsScore,finalScore,candidate:finalScore>=cfg.minSignalScore,reasons};
  }catch(e:any){
    const finalScore=clamp(Math.round((Number(r.technicalScore)||0)*0.58),0,100);
    return {...r,preNewsFrom:addDays(r.spikeDate,-cfg.preNewsDays),recentNewsFrom:r.recentFrom,historicalNews:[],recentNews:[],historicalTopics:[],recentTopics:[],overlapTopics:[],newsScore:0,finalScore,candidate:finalScore>=cfg.minSignalScore,reasons:['뉴스 수집 실패'],newsError:String(e?.message||e)};
  }
}

function parseCfg(v:any):Cfg{
  const asOf=String(v?.asOf||'');
  return {
    asOf,
    spikeFrom:clamp(cfgNum(v?.spikeFrom,1),1,30),spikeTo:clamp(cfgNum(v?.spikeTo,30),1,30),
    spikeMin:clamp(cfgNum(v?.spikeMin,3),0.1,30),spikeMax:clamp(cfgNum(v?.spikeMax,30),0.1,30),
    recentDays:clamp(cfgNum(v?.recentDays,5),1,20),preNewsDays:clamp(cfgNum(v?.preNewsDays,20),1,60),
    minSignalScore:clamp(cfgNum(v?.minSignalScore,55),0,100),maxNewsItems:clamp(cfgNum(v?.maxNewsItems,24),5,30)
  };
}

export async function GET(req:NextRequest){
  const op=req.nextUrl.searchParams.get('op')||'auth';
  if(op==='auth') return NextResponse.json({ok:true,authenticated:isHistoricalAuthed(req)});
  if(!isHistoricalAuthed(req)) return NextResponse.json({ok:false,error:'AUTH_REQUIRED'},{status:401});
  if(op==='universe'){
    try{
      const market=String(req.nextUrl.searchParams.get('market')||'ALL').toUpperCase();
      let kospi:Stock[]=[],kosdaq:Stock[]=[];
      if(market==='KOSPI') kospi=await fetchMarketAll('KOSPI');
      else if(market==='KOSDAQ') kosdaq=await fetchMarketAll('KOSDAQ');
      else [kospi,kosdaq]=await Promise.all([fetchMarketAll('KOSPI'),fetchMarketAll('KOSDAQ')]);
      return NextResponse.json({ok:true,kospi,kosdaq,counts:{kospi:kospi.length,kosdaq:kosdaq.length},excluded:'SPAC'},{headers:{'Cache-Control':'private, max-age=1200'}});
    }catch(e:any){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500});}
  }
  return NextResponse.json({ok:false,error:'BAD_OP'},{status:400});
}

export async function POST(req:NextRequest){
  const op=req.nextUrl.searchParams.get('op')||'';
  if(!isHistoricalAuthed(req)) return NextResponse.json({ok:false,error:'AUTH_REQUIRED'},{status:401});
  const body=await req.json().catch(()=>({})); const cfg=parseCfg(body?.cfg||{});
  if(!withinCalendarDays(cfg.asOf,370)) return NextResponse.json({ok:false,error:'BAD_DATE'},{status:400});
  if(op==='scan'){
    const stocks:Stock[]=(Array.isArray(body?.stocks)?body.stocks:[]).slice(0,70).map((s:any)=>({code:String(s.code||''),name:String(s.name||''),market:String(s.market||'KOSDAQ') as Market})).filter((s:Stock)=>/^\d{6}$/.test(s.code)&&s.name&&!spacName(s.name));
    if(!stocks.length) return NextResponse.json({ok:false,error:'NO_STOCKS'},{status:400});
    const rows=(await pool(stocks,12,s=>scanOne(s,cfg))).filter(Boolean);
    return NextResponse.json({ok:true,rows});
  }
  if(op==='enrich'){
    const rows=(Array.isArray(body?.rows)?body.rows:[]).slice(0,12);
    if(!rows.length) return NextResponse.json({ok:false,error:'NO_ROWS'},{status:400});
    const enriched=await pool(rows,5,r=>enrichOne(r,cfg));
    return NextResponse.json({ok:true,rows:enriched});
  }
  return NextResponse.json({ok:false,error:'BAD_OP'},{status:400});
}
