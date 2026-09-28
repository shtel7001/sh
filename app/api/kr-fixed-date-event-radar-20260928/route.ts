// @ts-nocheck
import { createHash, timingSafeEqual } from 'crypto';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const ACCESS_HASH = '0421d7067c7573fa6ff26138c1186a05d2514708f814b2549e65c2185277f6bc'; // 17382171
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';
const MARKET_CACHE_MS = 6 * 60 * 60 * 1000;
const NEWS_CACHE_MS = 10 * 60 * 1000;

let universeCache:any = { at: 0, rows: [] };
const newsCache = new Map<string,{at:number,items:any[]}>();

const EVENT_QUERIES = [
  { theme:'FDA·허가', q:'(FDA OR PDUFA OR 식약처 OR EMA OR 품목허가 OR 허가심사 OR 자문위원회) (승인 OR 결정 OR 심사 OR 일정 OR 예정)' },
  { theme:'임상·학회', q:'(임상 OR 3상 OR 2상 OR 탑라인 OR ASCO OR ESMO OR AACR OR SITC OR 학회) (결과 OR 발표 OR 초록 OR 데이터 OR 일정 OR 예정)' },
  { theme:'실적·IR', q:'("실적 발표" OR "기업설명회" OR IR OR NDR OR 컨퍼런스콜 OR "투자자 미팅") (예정 OR 개최 OR 일정 OR 발표)' },
  { theme:'주총·배당·증자', q:'(주주총회 OR 배당기준일 OR 권리락 OR 유상증자 OR 무상증자 OR 신주상장 OR 보호예수 OR 전환사채 OR CB OR BW) (예정 OR 일정 OR 해제 OR 상장 OR 납입)' },
  { theme:'정부정책·입찰', q:'(정부 OR 산업부 OR 과기정통부 OR 국토부 OR 방사청 OR 환경부 OR 금융위 OR 기재부) (발표 OR 선정 OR 공고 OR 입찰 OR 정책 OR 로드맵 OR 보조금 OR 예산 OR 일정)' },
  { theme:'방산·조선', q:'(방산 OR K방산 OR 함정 OR 잠수함 OR 조선 OR MRO OR 군함) (선정 OR 계약 OR 발표 OR 인도 OR 진수 OR 착공 OR 입찰 OR 일정)' },
  { theme:'원전·에너지', q:'(원전 OR SMR OR 전력망 OR ESS OR 수소 OR LNG OR 태양광) (입찰 OR 수주 OR 허가 OR 착공 OR 준공 OR 발표 OR 일정)' },
  { theme:'반도체·AI·로봇', q:'(반도체 OR HBM OR CXL OR AI칩 OR 데이터센터 OR 로봇) (양산 OR 출시 OR 공개 OR 공급 OR 납품 OR 가동 OR 일정)' },
  { theme:'2차전지·자동차', q:'(2차전지 OR 배터리 OR 전고체 OR 전기차 OR 자율주행 OR 자동차) (양산 OR 출시 OR 공개 OR 공급 OR 납품 OR 공장 OR 일정)' },
  { theme:'우주·항공', q:'(우주 OR 위성 OR 발사체 OR UAM OR 항공우주) (발사 OR 시험 OR 수주 OR 선정 OR 계약 OR 일정)' },
  { theme:'전시회·정상회의', q:'(CES OR MWC OR SEMICON OR 인터배터리 OR APEC OR G20 OR 모터쇼 OR 박람회 OR 전시회 OR 경제사절단) (참가 OR 발표 OR 공개 OR 개최 OR 일정)' },
  { theme:'M&A·계약', q:'(M&A OR 인수 OR 합병 OR 분할 OR 매각 OR 공개매수 OR 공급계약 OR 수주) (종료 OR 마감 OR 주총 OR 계약 OR 예정 OR 일정)' },
  { theme:'지수·시장제도', q:'(MSCI OR 코스피200 OR 코스닥150 OR 지수편입 OR 리밸런싱 OR 공매도) (편입 OR 편출 OR 적용 OR 시행 OR 일정 OR 예정)' },
  { theme:'법원·특허·규제', q:'(판결 OR 소송 OR 특허 OR 가처분 OR 규제 OR 공청회 OR 청문회) (선고 OR 결정 OR 일정 OR 예정)' },
  { theme:'제품·서비스 출시', q:'(신제품 OR 출시 OR 공개 OR 서비스 개시 OR 상용화 OR 양산) (예정 OR 일정 OR 발표 OR 공개)' },
] as const;

const OFFICIAL_KEYS = [
  '식품의약품안전처','금융위원회','금융감독원','한국거래소','KIND','DART','산업통상자원부','과학기술정보통신부',
  '국토교통부','방위사업청','기획재정부','대통령실','보건복지부','미국 식품의약국','FDA','EMA','NASA','SEC','정부24'
];

const PUBLISHER_BONUS:any = {
  '연합뉴스': 8, 'Reuters': 10, '로이터': 10, 'Bloomberg': 9, '블룸버그': 9, '한국경제': 6,
  '매일경제': 6, '이데일리': 6, '뉴스핌': 5, '머니투데이': 5, '서울경제': 5, '전자신문': 5, 'ZDNet Korea': 5
};

function verify(code:string|null) {
  if (!code) return false;
  const got = createHash('sha256').update(code.trim()).digest();
  const exp = Buffer.from(ACCESS_HASH,'hex');
  return got.length === exp.length && timingSafeEqual(got,exp);
}
function authorized(req:Request){ return verify(req.headers.get('x-access-code') || req.headers.get('x-radar-key')); }
function json(data:any,status=200){ return Response.json(data,{status,headers:{'Cache-Control':'no-store'}}); }
function num(v:any){ const n=Number(String(v??'').replace(/,/g,'').replace(/[^0-9.+-]/g,'')); return Number.isFinite(n)?n:null; }
function capEok(v:any){
  const s=String(v??'').replace(/,/g,''); let t=0,found=false;
  const a=s.match(/([0-9.]+)조/); if(a){ t+=Number(a[1])*10000; found=true; }
  const b=s.match(/([0-9.]+)억/); if(b){ t+=Number(b[1]); found=true; }
  return found?t:num(s);
}
function clean(s=''){
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
function tag(block:string,name:string){ const m=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,'i')); return m?clean(m[1]):''; }
function sourceTag(block:string){ const m=block.match(/<source[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/source>/i); return m?{url:m[1],name:clean(m[2])}:{url:'',name:''}; }
function safeIso(pub=''){ try { const d=new Date(pub); if(Number.isFinite(d.getTime())) return d.toISOString(); } catch {} return new Date().toISOString(); }
async function fetchJson(url:string,headers:any={}){
  const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':UA,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.7',...headers},signal:AbortSignal.timeout(12000)});
  if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json();
}
async function fetchText(url:string,headers:any={}){
  const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':UA,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.7',...headers},signal:AbortSignal.timeout(12000)});
  if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text();
}
function pickArray(j:any){
  if(Array.isArray(j)) return j;
  for(const k of ['stocks','items','data','stockList','result']) if(Array.isArray(j?.[k])) return j[k];
  if(Array.isArray(j?.result?.stocks)) return j.result.stocks;
  if(Array.isArray(j?.result?.items)) return j.result.items;
  return [];
}

async function loadMarket(market:'KOSPI'|'KOSDAQ'){
  const pageSize=100;
  const first=await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=1&pageSize=${pageSize}`,{Referer:'https://m.stock.naver.com/'});
  const rows1=pickArray(first);
  const count=Number(first?.totalCount ?? first?.result?.totalCount ?? first?.totalElements ?? first?.result?.totalElements ?? 0);
  let pageCount=count?Math.min(35,Math.ceil(count/pageSize)):0;
  const pages:any[]=[{p:1,rows:rows1}];
  if(pageCount>1){
    for(let start=2;start<=pageCount;start+=8){
      const batch=[];
      for(let p=start;p<Math.min(start+8,pageCount+1);p++) batch.push(fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${p}&pageSize=${pageSize}`,{Referer:'https://m.stock.naver.com/'}).then(j=>({p,rows:pickArray(j)})).catch(()=>({p,rows:[]})));
      pages.push(...await Promise.all(batch));
    }
  } else {
    for(let p=2;p<=30;p++){
      const j=await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${p}&pageSize=${pageSize}`,{Referer:'https://m.stock.naver.com/'}).catch(()=>null);
      const rows=j?pickArray(j):[]; pages.push({p,rows}); if(!rows.length || rows.length<pageSize) break;
    }
  }
  const out:any[]=[]; const seen=new Set<string>();
  for(const pg of pages.sort((a,b)=>a.p-b.p)) for(const x of pg.rows){
    const code=String(x?.itemCode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||'';
    const name=String(x?.stockName??x?.name??x?.itemName??'').trim();
    if(!code||!name||seen.has(code)) continue;
    seen.add(code);
    out.push({
      code,name,market,
      price:num(x?.closePrice??x?.currentPrice),
      changePct:num(x?.fluctuationsRatio??x?.changeRate),
      marketCapEok:capEok(x?.marketValue??x?.marketCap),
      naver:`https://finance.naver.com/item/main.naver?code=${code}`,
      news:`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(name)}`
    });
  }
  return out;
}

async function universe(){
  if(Date.now()-universeCache.at<MARKET_CACHE_MS && universeCache.rows?.length>1000) return universeCache.rows;
  const [a,b]=await Promise.all([loadMarket('KOSPI'),loadMarket('KOSDAQ')]);
  const rows=[...a,...b];
  universeCache={at:Date.now(),rows};
  return rows;
}

function monthNum(m:string){
  const months:any={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
  return months[m.toLowerCase()]||0;
}
function validDate(y:number,m:number,d:number){ const x=new Date(Date.UTC(y,m-1,d,0,0,0)); return x.getUTCFullYear()===y&&x.getUTCMonth()===m-1&&x.getUTCDate()===d?x:null; }
function inferYear(m:number,d:number,ref=new Date()){
  let y=ref.getUTCFullYear(); const cand=validDate(y,m,d); if(!cand) return y;
  const diff=(cand.getTime()-ref.getTime())/86400000;
  if(diff<-45) y+=1; return y;
}
function extractEventDates(text:string,refDate:string){
  const ref=new Date(refDate||Date.now()); const found:any[]=[];
  const add=(y:number,m:number,d:number,precision='day',raw='')=>{ const x=validDate(y,m,d); if(x) found.push({date:x.toISOString().slice(0,10),precision,raw}); };
  let m:any;
  const fullKr=/(20\d{2})\s*[년.\/-]\s*(1[0-2]|0?\d)\s*[월.\/-]\s*([0-3]?\d)\s*일?/g;
  while((m=fullKr.exec(text))) add(+m[1],+m[2],+m[3],'day',m[0]);
  const numeric=/(20\d{2})[-\/.](1[0-2]|0?\d)[-\/.]([0-3]?\d)/g;
  while((m=numeric.exec(text))) add(+m[1],+m[2],+m[3],'day',m[0]);
  const kr=/(?<!\d)(1[0-2]|0?\d)\s*월\s*([0-3]?\d)\s*일/g;
  while((m=kr.exec(text))) add(inferYear(+m[1],+m[2],ref),+m[1],+m[2],'day',m[0]);
  const eng1=/\b(January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+([0-3]?\d)(?:,\s*(20\d{2}))?/gi;
  while((m=eng1.exec(text))){ const mm=monthNum(m[1]),dd=+m[2],yy=m[3]?+m[3]:inferYear(mm,dd,ref); add(yy,mm,dd,'day',m[0]); }
  const eng2=/\b([0-3]?\d)\s+(January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+(20\d{2}))?/gi;
  while((m=eng2.exec(text))){ const mm=monthNum(m[2]),dd=+m[1],yy=m[3]?+m[3]:inferYear(mm,dd,ref); add(yy,mm,dd,'day',m[0]); }
  const out:any[]=[]; const seen=new Set<string>();
  for(const x of found){ if(seen.has(x.date)) continue; seen.add(x.date); out.push(x); }
  return out;
}

function isOfficial(sourceName:string,sourceUrl:string){
  const hay=`${sourceName} ${sourceUrl}`.toLowerCase();
  return OFFICIAL_KEYS.some(k=>hay.includes(k.toLowerCase())) || /\.go\.kr|\.gov\b|kind\.krx|dart\.fss/.test(hay);
}
function publisherBonus(name:string){ for(const [k,v] of Object.entries(PUBLISHER_BONUS)) if(name.includes(k)) return v as number; return 0; }
function eventScore(args:any){
  let s=42;
  if(args.official) s+=20;
  s+=publisherBonus(args.source||'');
  if(args.inTitle) s+=12; else s+=4;
  if(args.theme==='FDA·허가') s+=12;
  else if(args.theme==='임상·학회') s+=9;
  else if(['정부정책·입찰','방산·조선','원전·에너지','M&A·계약'].includes(args.theme)) s+=7;
  const d=(new Date(args.eventDate).getTime()-Date.now())/86400000;
  if(d>=0&&d<=7)s+=9; else if(d<=30)s+=5; else if(d<=90)s+=2;
  if(/예정|목표일|PDUFA|결정일|발표일|개최일|상장일|기준일|마감일|선고일|발사일|출시일|양산|착공|준공|납입일|주주총회/.test(args.text)) s+=6;
  return Math.max(0,Math.min(100,s));
}
function daysUntil(date:string){ const a=new Date(date+'T00:00:00+09:00').getTime(); const b=new Date(); const kst=new Date(b.toLocaleString('en-US',{timeZone:'Asia/Seoul'})); kst.setHours(0,0,0,0); return Math.round((a-kst.getTime())/86400000); }

async function queryNews(theme:string,q:string,lookback:number){
  const cacheKey=`${theme}|${q}|${lookback}`;
  const c=newsCache.get(cacheKey); if(c && Date.now()-c.at<NEWS_CACHE_MS) return c.items;
  const url=`https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${lookback}d`)}&hl=ko&gl=KR&ceid=KR:ko`;
  try{
    const xml=await fetchText(url);
    const blocks=xml.match(/<item>[\s\S]*?<\/item>/g)||[]; const items:any[]=[];
    for(const block of blocks.slice(0,100)){
      const title=tag(block,'title'); const desc=tag(block,'description'); const link=tag(block,'link'); const pub=tag(block,'pubDate'); const st=sourceTag(block);
      if(!title||!link) continue;
      items.push({theme,title,desc,link,publishedAt:safeIso(pub),source:st.name||'Google News',sourceUrl:st.url||''});
    }
    newsCache.set(cacheKey,{at:Date.now(),items}); return items;
  } catch { return []; }
}

function normalizedName(s:string){ return s.replace(/[()\[\]{}㈜주식회사\s]/g,'').toLowerCase(); }
function matchedCompanies(text:string,stocks:any[],marketSet:Set<string>){
  const low=text.toLowerCase(); const norm=normalizedName(text); const out:any[]=[];
  for(const s of stocks){
    if(!marketSet.has(s.market)) continue;
    const n=s.name; if(!n) continue;
    let hit=false;
    if(/^[A-Za-z0-9&. -]{2,}$/.test(n)){
      const esc=n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      hit=new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`,'i').test(text);
    } else if(n.length>=3) hit=low.includes(n.toLowerCase()) || norm.includes(normalizedName(n));
    if(hit) out.push(s);
    if(out.length>=12) break;
  }
  return out;
}

export async function GET(req:Request){
  if(!authorized(req)) return json({ok:false,error:'UNAUTHORIZED'},401);
  const u=new URL(req.url);
  if(u.searchParams.get('mode')==='ping') return json({ok:true,auth:'valid'});
  const lookback=Math.max(1,Math.min(60,Number(u.searchParams.get('lookback')||30)));
  const horizon=Math.max(1,Math.min(365,Number(u.searchParams.get('horizon')||120)));
  const marketParam=(u.searchParams.get('market')||'ALL').toUpperCase();
  const marketSet=new Set(marketParam==='KOSPI'?['KOSPI']:marketParam==='KOSDAQ'?['KOSDAQ']:['KOSPI','KOSDAQ']);
  const today=new Date(); const minDate=new Date(today.getTime()-2*86400000); minDate.setUTCHours(0,0,0,0); const maxDate=new Date(today.getTime()+horizon*86400000);

  const started=Date.now();
  const stocks=await universe();
  const feeds=await Promise.all(EVENT_QUERIES.map(x=>queryNews(x.theme,x.q,lookback)));
  const articles=feeds.flat(); const events:any[]=[];

  for(const a of articles){
    const text=`${a.title} ${a.desc}`;
    const dates=extractEventDates(text,a.publishedAt);
    if(!dates.length) continue;
    const companies=matchedCompanies(text,stocks,marketSet);
    if(!companies.length) continue;
    const official=isOfficial(a.source,a.sourceUrl);
    for(const d of dates){
      const ed=new Date(d.date+'T00:00:00Z'); if(ed<minDate||ed>maxDate) continue;
      for(const c of companies){
        const inTitle=a.title.toLowerCase().includes(c.name.toLowerCase()) || normalizedName(a.title).includes(normalizedName(c.name));
        const score=eventScore({official,source:a.source,inTitle,theme:a.theme,eventDate:d.date,text});
        events.push({
          id:createHash('sha1').update(`${c.code}|${a.theme}|${d.date}|${a.title}`).digest('hex').slice(0,18),
          company:c.name,code:c.code,market:c.market,price:c.price,changePct:c.changePct,marketCapEok:c.marketCapEok,
          eventDate:d.date,dDay:daysUntil(d.date),theme:a.theme,score,
          title:a.title.replace(/\s+-\s+[^-]+$/,'').trim(),source:a.source,official,
          publishedAt:a.publishedAt,url:a.link,naver:c.naver,news:c.news,dateText:d.raw
        });
      }
    }
  }

  const seen=new Set<string>();
  const unique=events.filter(x=>{ const k=`${x.code}|${x.theme}|${x.eventDate}|${x.title.toLowerCase().replace(/\s+/g,' ').slice(0,90)}`; if(seen.has(k)) return false; seen.add(k); return true; });
  unique.sort((a,b)=> (a.dDay-b.dDay) || (b.score-a.score) || (new Date(b.publishedAt).getTime()-new Date(a.publishedAt).getTime()));

  const counts:any={}; for(const x of unique) counts[x.theme]=(counts[x.theme]||0)+1;
  return json({
    ok:true,generatedAt:new Date().toISOString(),elapsedMs:Date.now()-started,
    universeCount:stocks.filter((s:any)=>marketSet.has(s.market)).length,articleCount:articles.length,eventCount:unique.length,
    counts,events:unique.slice(0,1200),
    notes:[
      '코스피·코스닥 전종목 명칭을 네이버 모바일 시가총액 목록에서 구성합니다.',
      '날짜가 명시된 기사·공식자료 후보만 남기며, 출처 신뢰도·종목명 제목 포함 여부·이벤트 임박도를 점수에 반영합니다.',
      '일정은 변경될 수 있으므로 매수 전 원문·공시·회사 IR에서 최종 확인이 필요합니다.'
    ]
  });
}
