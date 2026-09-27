// @ts-nocheck
import { createHash, timingSafeEqual } from 'crypto';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const ACCESS_HASH = '0632cdd85a02adb50a6a86ee775a18478ad66d3b04cc5024779285ed6826e2d2';
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';

const sourceRules = [
  ['KIND', '공시·IR', ['kind.krx.co.kr']],
  ['DART', '공시', ['dart.fss.or.kr','opendart.fss.or.kr']],
  ['대한상의', '행사 주관기관', ['kcci.or.kr']],
  ['한국경제인협회', '행사 주관기관', ['fki.or.kr']],
  ['한국무역협회', '행사 주관기관', ['kita.net']],
  ['KOTRA', '행사 주관기관', ['kotra.or.kr']],
  ['산업통상자원부', '정부', ['motie.go.kr']],
  ['금융위원회', '정부', ['fsc.go.kr']],
  ['대통령실', '정부', ['president.go.kr']],
  ['외교부', '정부', ['mofa.go.kr']],
  ['기획재정부', '정부', ['moef.go.kr']],
] as const;

const officialDomains = sourceRules.flatMap(x => x[2]);

const foreignSources = [
  { name:'Reuters', tier:1, keys:['reuters'] },
  { name:'Bloomberg', tier:1, keys:['bloomberg'] },
  { name:'Financial Times', tier:1, keys:['financial times','ft.com'] },
  { name:'The Wall Street Journal', tier:1, keys:['wall street journal','wsj'] },
  { name:'Nikkei Asia', tier:1, keys:['nikkei asia','asia.nikkei'] },
  { name:'Associated Press', tier:1, keys:['associated press','ap news','apnews'] },
  { name:'CNBC', tier:2, keys:['cnbc'] },
  { name:'BBC', tier:2, keys:['bbc'] },
  { name:'CNN', tier:2, keys:['cnn'] },
  { name:'MarketWatch', tier:2, keys:['marketwatch'] },
  { name:"Barron's", tier:2, keys:["barron's",'barrons'] },
  { name:'Forbes', tier:2, keys:['forbes'] },
  { name:'Fortune', tier:2, keys:['fortune'] },
  { name:'The Verge', tier:2, keys:['the verge','theverge'] },
  { name:'TechCrunch', tier:2, keys:['techcrunch'] },
] as const;

const stageRules = [
  ['참가모집', ['참가기업 모집','참가 신청','참가신청','모집 공고','delegation application','registration open','call for participants']],
  ['프로그램 공개', ['프로그램','agenda','program','schedule','세션']],
  ['연사 공개', ['연사','speaker','panelist','keynote','발표자']],
  ['참석 확정', ['참석','참가한다','참가 예정','참석 예정','delegation','attend','participate','participant','business roundtable','라운드테이블']],
  ['IR/NDR', ['기업설명회','investor relations',' ir ','ndr','기관투자자','conference call']],
  ['MOU·협력', ['mou','업무협약','양해각서','파트너십','partnership','협력','joint venture','협약']],
  ['수주·계약', ['단일판매','공급계약','수주','계약 체결','contract','award','procurement']],
] as const;

const englishNameCache = new Map<string,string>();

function verify(code: string | null) {
  if (!code) return false;
  const got = createHash('sha256').update(code.trim()).digest();
  const exp = Buffer.from(ACCESS_HASH, 'hex');
  return got.length === exp.length && timingSafeEqual(got, exp);
}
function auth(req: Request) { return verify(req.headers.get('x-access-code') || req.headers.get('x-radar-key')); }
function json(data: unknown, status = 200) { return Response.json(data,{status,headers:{'Cache-Control':'no-store'}}); }
function clean(s='') { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
function tag(block:string,name:string){ const m=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,'i')); return m?clean(m[1]):''; }
function sourceTag(block:string){ const m=block.match(/<source[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/source>/i); return m?{url:m[1],name:clean(m[2])}:{url:'',name:''}; }

async function fetchJson(url:string, headers:any={}) {
  const r = await fetch(url,{cache:'no-store',headers:{'User-Agent':UA,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.7',...headers},signal:AbortSignal.timeout(12000)});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}
async function fetchText(url:string, headers:any={}) {
  const r = await fetch(url,{cache:'no-store',headers:{'User-Agent':UA,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.7',...headers},signal:AbortSignal.timeout(12000)});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}
function pickArray(j:any){ if(Array.isArray(j)) return j; for(const k of ['stocks','items','data','stockList','result']) if(Array.isArray(j?.[k])) return j[k]; if(Array.isArray(j?.result?.stocks)) return j.result.stocks; if(Array.isArray(j?.result?.items)) return j.result.items; return []; }
function num(v:any){ const n=Number(String(v??'').replace(/,/g,'').replace(/[^0-9.+-]/g,'')); return Number.isFinite(n)?n:null; }
function capEok(v:any){ const s=String(v??'').replace(/,/g,''); let t=0,f=false; const a=s.match(/([0-9.]+)조/); if(a){t+=Number(a[1])*10000;f=true;} const b=s.match(/([0-9.]+)억/); if(b){t+=Number(b[1]);f=true;} return f?t:num(s); }

async function universe(){
  const out:any[]=[]; const seen=new Set<string>();
  for(let p=1;p<=6;p++){
    const j=await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=${p}&pageSize=100`,{Referer:'https://m.stock.naver.com/'});
    const rows=pickArray(j); if(!rows.length) break;
    for(const x of rows){
      const code=String(x?.itemCode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||'';
      const name=String(x?.stockName??x?.name??x?.itemName??'').trim();
      if(!code||!name||seen.has(code)) continue;
      seen.add(code);
      out.push({rank:out.length+1,code,name,price:num(x?.closePrice??x?.currentPrice),changePct:num(x?.fluctuationsRatio??x?.changeRate),marketCapEok:capEok(x?.marketValue??x?.marketCap)});
      if(out.length>=500) break;
    }
    if(out.length>=500) break;
  }
  return out.slice(0,500);
}

function classifySource(url:string,sourceName:string){
  const u=(url||'').toLowerCase();
  for(const [name,type,domains] of sourceRules) if(domains.some(d=>u.includes(d))) return {name,type,official:true};
  if(/\.gov\b|\.go\.[a-z]{2}\b|government|embassy|chamber|commerce|trade|ministry|economic development|investment agency/.test(`${u} ${sourceName}`.toLowerCase())) return {name:sourceName||'해외 공식기관',type:'해외정부·상공회의소',official:true};
  return {name:sourceName||'뉴스/기업자료',type:'뉴스·기업자료',official:false};
}
function stages(text:string){ const l=` ${text.toLowerCase()} `; const out:string[]=[]; for(const [label,words] of stageRules) if(words.some(w=>l.includes(w.toLowerCase()))) out.push(label); return out; }
function score(src:any,ss:string[],date:string){
  let s=src.official?35:12;
  if(src.type==='공시'||src.type==='공시·IR') s+=15;
  if(ss.includes('참석 확정'))s+=18;
  if(ss.includes('IR/NDR'))s+=15;
  if(ss.includes('MOU·협력'))s+=17;
  if(ss.includes('수주·계약'))s+=20;
  if(ss.includes('연사 공개'))s+=12;
  if(ss.includes('프로그램 공개'))s+=8;
  if(ss.includes('참가모집'))s+=6;
  const age=Math.max(0,(Date.now()-new Date(date).getTime())/86400000);
  if(age<=2)s+=10; else if(age<=7)s+=6;
  return Math.min(100,s);
}
function safeDate(pub:string){ try{ if(pub){ const d=new Date(pub); if(Number.isFinite(d.getTime())) return d.toISOString(); } }catch{} return new Date().toISOString(); }
function makeItem(c:any,title:string,desc:string,link:string,pub:string,sourceName:string){
  const src=classifySource(link,sourceName);
  let ss=stages(`${title} ${desc}`);
  if(!ss.length && (src.name==='KIND'||src.name==='DART')) ss=['공시'];
  if(!ss.length) return null;
  const date=safeDate(pub);
  return {id:createHash('sha1').update(`${c.code}|${link}|${title}`).digest('hex').slice(0,18),company:c.name,code:c.code,rank:c.rank,date,title:title.replace(/\s+-\s+[^-]+$/,'').trim(),url:link,source:src.name,sourceType:src.type,official:src.official,stages:ss,score:score(src,ss,date)};
}

function foreignSource(url:string,sourceName:string){
  const hay=`${url||''} ${sourceName||''}`.toLowerCase();
  for(const s of foreignSources) if(s.keys.some(k=>hay.includes(k))) return s;
  return null;
}
function foreignScore(tier:number,date:string){
  let s=tier===1?58:50;
  const age=Math.max(0,(Date.now()-new Date(date).getTime())/86400000);
  if(age<=2)s+=12; else if(age<=7)s+=8; else if(age<=30)s+=3;
  return Math.min(100,s);
}
async function englishNameForCompany(c:any){
  const cached=englishNameCache.get(c.code); if(cached) return cached;
  try{
    const u=`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(c.code+'.KS')}&quotesCount=5&newsCount=0`;
    const j=await fetchJson(u,{'Accept-Language':'en-US,en;q=0.9'});
    const q=(j?.quotes||[]).find((x:any)=>String(x?.symbol||'').toUpperCase()===`${c.code}.KS`) || (j?.quotes||[])[0];
    const n=String(q?.longname||q?.shortname||'').trim();
    if(n){ englishNameCache.set(c.code,n); return n; }
  }catch{}
  englishNameCache.set(c.code,c.name);
  return c.name;
}
async function foreignNewsForCompany(c:any,days:number){
  try{
    const englishName=await englishNameForCompany(c);
    const names=englishName && englishName!==c.name ? `("${englishName}" OR "${c.name}")` : `"${c.name}"`;
    const q=`${names} when:${days}d`;
    const url=`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const xml=await fetchText(url,{'Accept-Language':'en-US,en;q=0.9'});
    const blocks=xml.match(/<item>[\s\S]*?<\/item>/g)||[]; const out:any[]=[]; const seen=new Set<string>();
    for(const item of blocks.slice(0,50)){
      const title=tag(item,'title'), desc=tag(item,'description'), link=tag(item,'link'), pub=tag(item,'pubDate'); const st=sourceTag(item);
      const media=foreignSource(st.url,st.name); if(!media) continue;
      const date=safeDate(pub); const key=title.toLowerCase().replace(/\W+/g,' ').trim(); if(!key||seen.has(key)) continue; seen.add(key);
      out.push({id:createHash('sha1').update(`foreign|${c.code}|${title}`).digest('hex').slice(0,18),company:c.name,englishName,code:c.code,rank:c.rank,date,title:title.replace(/\s+-\s+[^-]+$/,'').trim(),url:link,source:media.name,sourceType:'외신 주요뉴스',official:false,stages:['외신 주요뉴스'],score:foreignScore(media.tier,date)});
      if(out.length>=5) break;
    }
    return out;
  }catch{return [];}
}

async function googleNewsForCompany(c:any,days:number){
  const event='(참석 OR 참가 OR 기업설명회 OR IR OR NDR OR MOU OR 협력 OR 계약 OR 컨퍼런스 OR 라운드테이블 OR 포럼 OR 프로그램 OR 연사 OR speaker OR delegation OR conference OR partnership)';
  const q=`"${c.name}" ${event} when:${days}d`;
  const url=`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
  try{
    const xml=await fetchText(url);
    const blocks=xml.match(/<item>[\s\S]*?<\/item>/g)||[]; const out:any[]=[];
    for(const item of blocks.slice(0,20)){
      const title=tag(item,'title'), desc=tag(item,'description'), link=tag(item,'link'), pub=tag(item,'pubDate'); const st=sourceTag(item);
      const x=makeItem(c,title,desc,link,pub,st.name); if(x) out.push(x);
    }
    return out;
  }catch{return [];}
}

async function officialWebForCompany(c:any,days:number){
  const sitePart=officialDomains.map(d=>`site:${d}`).join(' OR ');
  const event='참석 참가 기업설명회 IR NDR MOU 협력 계약 컨퍼런스 라운드테이블 포럼 프로그램 연사 speaker delegation conference partnership';
  const queries=[
    `"${c.name}" (${event}) (${sitePart})`,
    `"${c.name}" (speaker OR participant OR delegation OR conference OR MOU OR partnership OR contract) (government OR ministry OR embassy OR chamber OR commerce OR investment agency)`
  ];
  const out:any[]=[];
  await Promise.all(queries.map(async q=>{
    try{
      const rss=await fetchText(`https://www.bing.com/search?format=rss&count=20&q=${encodeURIComponent(q)}`,{'Accept':'application/rss+xml,text/xml,*/*'});
      const blocks=rss.match(/<item>[\s\S]*?<\/item>/g)||[];
      for(const item of blocks.slice(0,20)){
        const title=tag(item,'title'), desc=tag(item,'description'), link=tag(item,'link'), pub=tag(item,'pubDate');
        const src=classifySource(link,'공식 웹검색');
        if(!src.official && !officialDomains.some(d=>link.toLowerCase().includes(d))) continue;
        const x=makeItem(c,title,desc,link,pub,src.name); if(x) out.push(x);
      }
    }catch{}
  }));
  return out;
}

async function dartRecent(names:string[],days:number,key:string){
  if(!key) return {enabled:false,items:[]};
  const bgn=new Date(Date.now()-days*86400000).toISOString().slice(0,10).replace(/-/g,'');
  const end=new Date().toISOString().slice(0,10).replace(/-/g,'');
  const want=new Set(names.map(x=>x.replace(/\s+/g,''))); const items:any[]=[];
  try{
    for(let page=1;page<=4;page++){
      const u=new URL('https://opendart.fss.or.kr/api/list.json');
      u.searchParams.set('crtfc_key',key); u.searchParams.set('bgn_de',bgn); u.searchParams.set('end_de',end); u.searchParams.set('page_no',String(page)); u.searchParams.set('page_count','100'); u.searchParams.set('sort','date'); u.searchParams.set('sort_mth','desc');
      const j=await fetchJson(u.toString());
      if(j?.status && j.status!=='000' && j.status!=='013') break;
      const rows=j?.list||[];
      for(const d of rows){
        const n=String(d.corp_name||'').replace(/\s+/g,''); if(!want.has(n)) continue;
        let ss=stages(`${d.report_nm||''}`); if(!ss.length) ss=['공시'];
        const date=String(d.rcept_dt||''); const iso=date.length===8?`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T00:00:00+09:00`:new Date().toISOString();
        items.push({id:`dart-${d.rcept_no}`,company:d.corp_name,code:d.stock_code||'',rank:null,date:iso,title:d.report_nm,url:`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${d.rcept_no}`,source:'DART',sourceType:'공시',official:true,stages:ss,score:Math.min(100,55+(ss.length*8))});
      }
      if(rows.length<100) break;
    }
  }catch(e:any){ return {enabled:true,error:e?.message||String(e),items}; }
  return {enabled:true,items};
}

export async function GET(req:Request){
  if(!auth(req)) return json({error:'unauthorized'},401);
  const u=new URL(req.url); const action=u.searchParams.get('action')||'universe';
  if(action==='auth') return json({ok:true});
  if(action==='universe') {
    try{return json({generatedAt:new Date().toISOString(),stocks:await universe()});}
    catch(e:any){return json({error:e?.message||String(e)},502);}
  }
  if(action==='scan'){
    const days=Math.min(90,Math.max(1,Number(u.searchParams.get('days')||30)));
    const raw=u.searchParams.get('companies')||'';
    const arr=raw.split('|').map(x=>{const [rank,code,...rest]=x.split(':'); return {rank:Number(rank),code,name:rest.join(':')};}).filter(x=>x.code&&x.name).slice(0,10);
    const dartKey=req.headers.get('x-dart-key')||'';
    const [companyParts,dart]=await Promise.all([
      Promise.all(arr.map(async c=>{
        const [general,official,foreign]=await Promise.all([googleNewsForCompany(c,days),officialWebForCompany(c,days),foreignNewsForCompany(c,days)]);
        return [...official,...general,...foreign];
      })),
      dartRecent(arr.map(x=>x.name),days,dartKey)
    ]);
    const items=[...companyParts.flat(),...(dart.items||[])];
    const dedup=new Map<string,any>();
    for(const x of items){
      const k=`${x.company}|${x.title}`.toLowerCase().replace(/\W+/g,' ').slice(0,180);
      const old=dedup.get(k); if(!old||x.score>old.score) dedup.set(k,x);
    }
    return json({generatedAt:new Date().toISOString(),days,count:dedup.size,items:[...dedup.values()].sort((a,b)=>b.score-a.score||+new Date(b.date)-+new Date(a.date)),dart:{enabled:dart.enabled,error:dart.error||null},sourceRules:sourceRules.map(x=>({name:x[0],type:x[1],domains:x[2]})),foreignSources:foreignSources.map(x=>x.name),modes:['Google News 일반 신호','Bing 공식도메인 직접검색','주요 외신 영문뉴스','OpenDART API(키 입력 시)']});
  }
  return json({error:'bad action'},400);
}
