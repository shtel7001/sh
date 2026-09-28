// @ts-nocheck
import { createHash, timingSafeEqual } from 'crypto';
import { load } from 'cheerio';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const ACCESS_HASH = '0421d7067c7573fa6ff26138c1186a05d2514708f814b2549e65c2185277f6bc'; // 17382171
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Mobile Safari/537.36';
const MARKET_CACHE_MS = 6 * 60 * 60 * 1000;
const NEWS_CACHE_MS = 10 * 60 * 1000;
const ARTICLE_CACHE_MS = 30 * 60 * 1000;
const MAX_NAVER_ARTICLES = 620;

let universeCache:any = { at: 0, rows: [] };
const searchCache = new Map<string,{at:number,items:any[]}>();
const articleCache = new Map<string,{at:number,item:any}>();

const EVENT_QUERIES = [
  { theme:'FDA·허가', q:'FDA PDUFA 승인 예정일 국내 제약 바이오' },
  { theme:'FDA·허가', q:'FDA 허가 결정일 품목허가 예정 국내 기업' },
  { theme:'FDA·허가', q:'식약처 품목허가 승인 예정일 제약 바이오' },
  { theme:'임상·학회', q:'임상 3상 결과 발표 예정 국내 제약 바이오' },
  { theme:'임상·학회', q:'ASCO ESMO AACR SITC 발표 예정 국내 기업' },
  { theme:'실적·IR', q:'실적 발표 예정 기업설명회 IR NDR 국내 상장사' },
  { theme:'주총·배당·증자', q:'주주총회 배당기준일 유상증자 납입일 신주상장 예정' },
  { theme:'정부정책·입찰', q:'정부 정책 발표 예정 입찰 선정 공고 국내 기업' },
  { theme:'방산·조선', q:'방산 조선 수주 입찰 선정 발표 예정 국내 기업' },
  { theme:'원전·에너지', q:'원전 SMR 전력망 ESS 입찰 수주 발표 예정 국내 기업' },
  { theme:'반도체·AI·로봇', q:'반도체 HBM AI 로봇 양산 출시 공급 예정 국내 기업' },
  { theme:'2차전지·자동차', q:'2차전지 전고체 배터리 자율주행 양산 출시 예정 국내 기업' },
  { theme:'우주·항공', q:'위성 발사 우주 항공 시험 발사 예정 국내 기업' },
  { theme:'전시회·정상회의', q:'CES MWC SEMICON 전시회 참가 발표 예정 국내 기업' },
  { theme:'M&A·계약', q:'M&A 인수 합병 공개매수 공급계약 마감 예정 국내 상장사' },
  { theme:'지수·시장제도', q:'MSCI 코스피200 코스닥150 편입 리밸런싱 예정 종목' },
  { theme:'법원·특허·규제', q:'판결 선고 특허 소송 결정일 예정 상장사' },
  { theme:'제품·서비스 출시', q:'신제품 출시 공개 상용화 양산 예정 국내 상장사' },
] as const;

const EVENT_CUES = /예정|일정|목표일|목표 날짜|PDUFA|시한|기한|승인|허가|결정|심사|발표|공개|개최|학회|임상|탑라인|주주총회|배당기준일|권리락|납입일|상장일|보호예수|입찰|선정|계약|수주|인도|진수|착공|준공|양산|출시|상용화|발사|시험|마감|편입|편출|리밸런싱|시행|선고|공청회|청문회|MOU|사절단|행사|전시회/i;
const FORWARD_CUES = /예정|계획|목표|목표일|시한|기한|PDUFA|결정일|발표할|발표 예정|공개 예정|개최 예정|상장 예정|납입 예정|선고 예정|발사 예정|출시 예정|양산 예정|착공 예정|준공 예정|통보 시한|심사 기한|마감|적용일|시행일|기준일/i;
const OFFICIAL_KEYS = ['식품의약품안전처','금융위원회','금융감독원','한국거래소','KIND','DART','산업통상자원부','과학기술정보통신부','국토교통부','방위사업청','기획재정부','대통령실','보건복지부','미국 식품의약국','FDA','EMA','NASA','SEC','정부24'];
const PUBLISHER_BONUS:any = {'연합뉴스':8,'Reuters':10,'로이터':10,'Bloomberg':9,'블룸버그':9,'한국경제':6,'매일경제':6,'이데일리':6,'뉴스핌':5,'머니투데이':5,'서울경제':5,'전자신문':5,'ZDNet Korea':5,'파이낸셜뉴스':4,'아시아경제':4,'헤럴드경제':4,'조선비즈':5,'한국경제TV':4};

function verify(code:string|null){ if(!code)return false; const got=createHash('sha256').update(code.trim()).digest(); const exp=Buffer.from(ACCESS_HASH,'hex'); return got.length===exp.length&&timingSafeEqual(got,exp); }
function authorized(req:Request){ return verify(req.headers.get('x-access-code')||req.headers.get('x-radar-key')); }
function json(data:any,status=200){ return Response.json(data,{status,headers:{'Cache-Control':'no-store'}}); }
function num(v:any){ const n=Number(String(v??'').replace(/,/g,'').replace(/[^0-9.+-]/g,'')); return Number.isFinite(n)?n:null; }
function capEok(v:any){ const s=String(v??'').replace(/,/g,''); let t=0,f=false; const a=s.match(/([0-9.]+)조/); if(a){t+=Number(a[1])*10000;f=true} const b=s.match(/([0-9.]+)억/); if(b){t+=Number(b[1]);f=true} return f?t:num(s); }
function clean(s=''){ return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
function safeIso(pub=''){ try{ const d=new Date(pub); if(Number.isFinite(d.getTime())) return d.toISOString(); }catch{} return new Date().toISOString(); }
async function fetchText(url:string,headers:any={},timeout=8000){ const r=await fetch(url,{cache:'no-store',redirect:'follow',headers:{'User-Agent':UA,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.7',...headers},signal:AbortSignal.timeout(timeout)}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); }
async function fetchJson(url:string,headers:any={}){ const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':UA,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.7',...headers},signal:AbortSignal.timeout(10000)}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
function pickArray(j:any){ if(Array.isArray(j))return j; for(const k of ['stocks','items','data','stockList','result'])if(Array.isArray(j?.[k]))return j[k]; if(Array.isArray(j?.result?.stocks))return j.result.stocks; if(Array.isArray(j?.result?.items))return j.result.items; return []; }

async function loadMarket(market:'KOSPI'|'KOSDAQ'){
  const pageSize=100; const first=await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=1&pageSize=${pageSize}`,{Referer:'https://m.stock.naver.com/'}); const rows1=pickArray(first);
  const count=Number(first?.totalCount??first?.result?.totalCount??first?.totalElements??first?.result?.totalElements??0); const pageCount=count?Math.min(35,Math.ceil(count/pageSize)):30; const pages:any[]=[{p:1,rows:rows1}];
  for(let start=2;start<=pageCount;start+=8){ const batch=[]; for(let p=start;p<Math.min(start+8,pageCount+1);p++) batch.push(fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${p}&pageSize=${pageSize}`,{Referer:'https://m.stock.naver.com/'}).then(j=>({p,rows:pickArray(j)})).catch(()=>({p,rows:[]}))); pages.push(...await Promise.all(batch)); }
  const out:any[]=[]; const seen=new Set<string>();
  for(const pg of pages.sort((a,b)=>a.p-b.p)) for(const x of pg.rows){ const code=String(x?.itemCode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||''; const name=String(x?.stockName??x?.name??x?.itemName??'').trim(); if(!code||!name||seen.has(code))continue; seen.add(code); out.push({code,name,market,price:num(x?.closePrice??x?.currentPrice),changePct:num(x?.fluctuationsRatio??x?.changeRate),marketCapEok:capEok(x?.marketValue??x?.marketCap),naver:`https://finance.naver.com/item/main.naver?code=${code}`,news:`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(name)}`}); }
  return out;
}
async function universe(){ if(Date.now()-universeCache.at<MARKET_CACHE_MS&&universeCache.rows?.length>1000)return universeCache.rows; const [a,b]=await Promise.all([loadMarket('KOSPI'),loadMarket('KOSDAQ')]); const rows=[...a,...b]; universeCache={at:Date.now(),rows}; return rows; }

function monthNum(m:string){ const x:any={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12}; return x[m.toLowerCase()]||0; }
function validDate(y:number,m:number,d:number){ const x=new Date(Date.UTC(y,m-1,d)); return x.getUTCFullYear()===y&&x.getUTCMonth()===m-1&&x.getUTCDate()===d?x:null; }
function inferYear(m:number,d:number,ref=new Date()){ let y=ref.getUTCFullYear(); const c=validDate(y,m,d); if(c&&(c.getTime()-ref.getTime())/86400000<-45)y++; return y; }
function extractEventDates(text:string,refDate:string){
  const ref=new Date(refDate||Date.now()),found:any[]=[]; const add=(y:number,m:number,d:number,raw='',inferred=false)=>{const x=validDate(y,m,d);if(x)found.push({date:x.toISOString().slice(0,10),raw,inferred})}; let m:any;
  const fullKr=/(20\d{2})\s*[년.\/-]\s*(1[0-2]|0?\d)\s*[월.\/-]\s*([0-3]?\d)\s*일?/g; while((m=fullKr.exec(text)))add(+m[1],+m[2],+m[3],m[0],false);
  const numeric=/(20\d{2})[-\/.](1[0-2]|0?\d)[-\/.]([0-3]?\d)/g; while((m=numeric.exec(text)))add(+m[1],+m[2],+m[3],m[0],false);
  const range=/(?<!\d)(1[0-2]|0?\d)\s*월\s*([0-3]?\d)\s*(?:~|～|-|부터)\s*([0-3]?\d)\s*일/g; while((m=range.exec(text))){const y=inferYear(+m[1],+m[2],ref);add(y,+m[1],+m[2],m[0],true);add(y,+m[1],+m[3],m[0],true)}
  const kr=/(?<!\d)(1[0-2]|0?\d)\s*월\s*([0-3]?\d)\s*일/g; while((m=kr.exec(text)))add(inferYear(+m[1],+m[2],ref),+m[1],+m[2],m[0],true);
  const thisMonth=/이달\s*([0-3]?\d)\s*일/g; while((m=thisMonth.exec(text)))add(ref.getUTCFullYear(),ref.getUTCMonth()+1,+m[1],m[0],true);
  const coming=/(?:오는)\s*([0-3]?\d)\s*일/g; while((m=coming.exec(text))){let y=ref.getUTCFullYear(),mm=ref.getUTCMonth()+1,dd=+m[1];const c=validDate(y,mm,dd);if(c&&(c.getTime()-ref.getTime())/86400000<-2){mm++;if(mm===13){mm=1;y++}}add(y,mm,dd,m[0],true)}
  const nextMonth=/내달\s*([0-3]?\d)\s*일/g; while((m=nextMonth.exec(text))){let y=ref.getUTCFullYear(),mm=ref.getUTCMonth()+2;if(mm>12){mm-=12;y++}add(y,mm,+m[1],m[0],true)}
  const eng=/\b(January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+([0-3]?\d)(?:,\s*(20\d{2}))?/gi; while((m=eng.exec(text))){const mm=monthNum(m[1]),dd=+m[2],y=m[3]?+m[3]:inferYear(mm,dd,ref);add(y,mm,dd,m[0],!m[3])}
  const out:any[]=[];const seen=new Set<string>();for(const x of found){const k=`${x.date}|${x.raw}`;if(!seen.has(k)){seen.add(k);out.push(x)}}return out;
}
function contextAround(text:string,raw:string){ const i=raw?text.indexOf(raw):-1; if(i<0)return text.slice(0,520); return text.slice(Math.max(0,i-260),Math.min(text.length,i+raw.length+320)); }
function isOfficial(sourceName:string,sourceUrl:string){ const h=`${sourceName} ${sourceUrl}`.toLowerCase(); return OFFICIAL_KEYS.some(k=>h.includes(k.toLowerCase()))||/\.go\.kr|\.gov\b|kind\.krx|dart\.fss/.test(h); }
function publisherBonus(name:string){ for(const [k,v] of Object.entries(PUBLISHER_BONUS))if(name.includes(k))return v as number; return 0; }
function daysUntil(date:string){ const a=new Date(date+'T00:00:00+09:00').getTime(); const now=new Date(); const k=new Date(now.toLocaleString('en-US',{timeZone:'Asia/Seoul'})); k.setHours(0,0,0,0); return Math.round((a-k.getTime())/86400000); }
function classifyTheme(ctx:string,fallback:string){ const t=ctx.toLowerCase(); if(/pdufa|\bfda\b|식약처|ema|품목허가|허가심사|신약허가|승인 심사/.test(t))return 'FDA·허가'; if(/임상|1상|2상|3상|탑라인|asco|esmo|aacr|sitc|학회|초록|데이터 발표/.test(t))return '임상·학회'; if(/실적|기업설명회|\bir\b|\bndr\b|컨퍼런스콜|투자자 미팅/.test(t))return '실적·IR'; if(/주주총회|배당기준일|권리락|유상증자|무상증자|신주상장|보호예수|전환사채|\bcb\b|\bbw\b/.test(t))return '주총·배당·증자'; if(/방산|함정|잠수함|군함|mro|방사청|무기체계/.test(t))return '방산·조선'; if(/원전|smr|전력망|ess|수소|lng|태양광/.test(t))return '원전·에너지'; if(/반도체|hbm|cxl|ai칩|데이터센터|로봇/.test(t))return '반도체·AI·로봇'; if(/2차전지|배터리|전고체|전기차|자율주행/.test(t))return '2차전지·자동차'; if(/우주|위성|발사체|uam|항공우주/.test(t))return '우주·항공'; if(/ces|mwc|semicon|인터배터리|apec|g20|전시회|박람회|경제사절단/.test(t))return '전시회·정상회의'; if(/m&a|인수|합병|분할|매각|공개매수|공급계약|수주/.test(t))return 'M&A·계약'; if(/msci|코스피200|코스닥150|지수편입|리밸런싱|편입|편출/.test(t))return '지수·시장제도'; if(/판결|소송|특허|가처분|공청회|청문회|선고/.test(t))return '법원·특허·규제'; if(/신제품|출시|서비스 개시|상용화|양산/.test(t))return '제품·서비스 출시'; if(/정부|산업부|과기정통부|국토부|환경부|금융위|기재부|보조금|정책|로드맵/.test(t))return '정부정책·입찰'; return fallback; }
function eventScore(a:any){ let s=38+(a.bodyRead?12:0)+(a.official?18:0)+publisherBonus(a.source||'')+(a.inTitle?10:5); if(a.theme==='FDA·허가')s+=10;else if(a.theme==='임상·학회')s+=7; const d=daysUntil(a.eventDate);if(d>=0&&d<=7)s+=8;else if(d<=30)s+=5;else if(d<=90)s+=2;if(FORWARD_CUES.test(a.context||''))s+=9;else if(EVENT_CUES.test(a.context||''))s+=4;return Math.min(100,s); }
function escRe(s:string){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function asciiMention(text:string,name:string){return new RegExp(`(^|[^A-Za-z0-9가-힣])${escRe(name)}(?=$|[^A-Za-z0-9가-힣])`,'i').test(text)}
function koreanMention(text:string,name:string){return new RegExp(`(^|[^가-힣A-Za-z0-9])${escRe(name)}(?=$|[^가-힣A-Za-z0-9]|은|는|이|가|의|을|를|과|와|도|에|서|로|으로|측|사|그룹|㈜)`,'i').test(text)}
function matchedCompanies(text:string,stocks:any[],marketSet:Set<string>){ const out:any[]=[]; for(const s of stocks){if(!marketSet.has(s.market))continue; const n=String(s.name||'').trim();if(!n)continue;let hit=false;if(n==='NAVER')hit=koreanMention(text,'네이버')||asciiMention(text,'NAVER');else if(/^[A-Za-z0-9&. -]{2,}$/.test(n))hit=asciiMention(text,n);else if(n.length<=2)hit=koreanMention(text,n);else hit=koreanMention(text,n);if(hit)out.push(s);if(out.length>=12)break}return out; }

function canonicalNaver(oid:string,aid:string){ return /^\d{3,4}$/.test(oid)&&/^\d{7,12}$/.test(aid)?`https://n.news.naver.com/article/${oid}/${aid}`:''; }
function normalizeNaverUrl(href:string){
  if(!href)return ''; let h=String(href).replace(/&amp;/g,'&').replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/');
  try{if(/^https?%3A/i.test(h))h=decodeURIComponent(h)}catch{}
  try{const u=new URL(h); if(/n\.news\.naver\.com$/i.test(u.hostname)){const m=u.pathname.match(/\/(?:mnews\/)?article\/(\d+)\/(\d+)/);if(m)return canonicalNaver(m[1],m[2])} if(/news\.naver\.com$/i.test(u.hostname)){const oid=u.searchParams.get('oid')||'',aid=u.searchParams.get('aid')||'';return canonicalNaver(oid,aid)}}catch{}
  return '';
}
function extractNaverLinks(html:string){
  const set=new Set<string>(); const add=(u:string)=>{const x=normalizeNaverUrl(u);if(x)set.add(x)}; const decoded=html.replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/').replace(/&amp;/g,'&');
  const p1=/https?:\/\/n\.news\.naver\.com\/(?:mnews\/)?article\/(\d+)\/(\d+)/gi; let m:any;while((m=p1.exec(decoded)))set.add(canonicalNaver(m[1],m[2]));
  const p2=/https?:\/\/news\.naver\.com\/main\/read\.naver\?[^"'<>\s]*?oid=(\d+)[^"'<>\s]*?aid=(\d+)/gi;while((m=p2.exec(decoded)))set.add(canonicalNaver(m[1],m[2]));
  const p3=/https%3A%2F%2Fn\.news\.naver\.com%2F(?:mnews%2F)?article%2F(\d+)%2F(\d+)/gi;while((m=p3.exec(html)))set.add(canonicalNaver(m[1],m[2]));
  const $=load(html);$('a[href]').each((_:any,e:any)=>add(String($(e).attr('href')||''))); return [...set].filter(Boolean);
}
function ymdKst(d:Date){return d.toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}).replace(/-/g,'.')}
async function naverSearch(theme:string,q:string,lookback:number){
  const key=`nv2|${theme}|${q}|${lookback}`;const c=searchCache.get(key);if(c&&Date.now()-c.at<NEWS_CACHE_MS)return c.items;const items:any[]=[];const seen=new Set<string>();const end=new Date(),startDate=new Date(Date.now()-lookback*86400000);const ds=ymdKst(startDate),de=ymdKst(end);
  for(const start of [1,11,21,31]){try{const url=`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(q)}&sort=1&photo=0&field=0&pd=3&ds=${encodeURIComponent(ds)}&de=${encodeURIComponent(de)}&start=${start}`;const html=await fetchText(url,{Referer:'https://search.naver.com/'},6500);for(const link of extractNaverLinks(html)){if(seen.has(link))continue;seen.add(link);items.push({theme,title:'',desc:'',link,source:'네이버뉴스 검색'})}}catch{}}
  searchCache.set(key,{at:Date.now(),items});return items;
}
async function googleFallback(theme:string,q:string,lookback:number){
  const key=`gg2|${theme}|${q}|${lookback}`;const c=searchCache.get(key);if(c&&Date.now()-c.at<NEWS_CACHE_MS)return c.items;const out:any[]=[];
  try{const xml=await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${lookback}d`)}&hl=ko&gl=KR&ceid=KR:ko`,{},6500);const blocks=xml.match(/<item>[\s\S]*?<\/item>/g)||[];for(const b of blocks.slice(0,90)){const get=(n:string)=>{const m=b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`,'i'));return m?clean(m[1]):''};const sm=b.match(/<source[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/source>/i);const title=get('title'),link=get('link');if(title&&link)out.push({theme,title,desc:get('description'),link,publishedAt:safeIso(get('pubDate')),source:sm?clean(sm[2]):'Google News',sourceUrl:sm?.[1]||'',body:'',bodyRead:false})}}catch{}searchCache.set(key,{at:Date.now(),items:out});return out;
}
async function readNaverArticle(seed:any){
  const c=articleCache.get(seed.link);if(c&&Date.now()-c.at<ARTICLE_CACHE_MS)return {...seed,...c.item};
  try{const html=await fetchText(seed.link,{Referer:'https://search.naver.com/'},6500);const $=load(html);const title=clean($('#title_area').first().text())||clean($('.media_end_head_headline').first().text())||clean($('meta[property="og:title"]').attr('content')||'')||seed.title;let body='';for(const sel of ['#dic_area','.go_trans._article_content','#newsct_article']){const node=$(sel).first();if(!node.length)continue;const clone=node.clone();clone.find('script,style,figure,iframe,.end_photo_org,.img_desc,.article_byline,.copyright,.media_end_linked_more,.media_end_categorize,[class*="recommend"],[class*="related"],[class*="promotion"],[class*="ranking"],[class*="subscription"]').remove();const t=clean(clone.text());if(t.length>80){body=t;break}}body=body.slice(0,26000);const source=clean($('.media_end_head_top_logo img').attr('alt')||'')||clean($('.media_end_head_top_logo').text())||seed.source||'네이버뉴스';const pub=$('.media_end_head_info_datestamp_time').first().attr('data-date-time')||$('meta[property="article:published_time"]').attr('content')||'';const item={title,body,source,publishedAt:safeIso(pub||Date.now().toString()),sourceUrl:seed.link,bodyRead:body.length>80};articleCache.set(seed.link,{at:Date.now(),item});return {...seed,...item};}catch{return {...seed,body:'',bodyRead:false,publishedAt:safeIso(''),source:seed.source||'네이버뉴스'}}
}
async function mapConcurrent<T,R>(xs:T[],limit:number,fn:(x:T)=>Promise<R>){const out:R[]=[];for(let i=0;i<xs.length;i+=limit){out.push(...await Promise.all(xs.slice(i,i+limit).map(fn)))}return out}

export async function GET(req:Request){
  if(!authorized(req))return json({ok:false,error:'UNAUTHORIZED'},401);const u=new URL(req.url);if(u.searchParams.get('mode')==='ping')return json({ok:true,auth:'valid'});
  const lookback=Math.max(7,Math.min(180,Number(u.searchParams.get('lookback')||120))),horizon=Math.max(1,Math.min(365,Number(u.searchParams.get('horizon')||120))),marketParam=(u.searchParams.get('market')||'ALL').toUpperCase();const marketSet=new Set(marketParam==='KOSPI'?['KOSPI']:marketParam==='KOSDAQ'?['KOSDAQ']:['KOSPI','KOSDAQ']);
  const started=Date.now(),stocks=await universe();const [naverGroups,googleGroups]=await Promise.all([Promise.all(EVENT_QUERIES.map(x=>naverSearch(x.theme,x.q,lookback))),Promise.all(EVENT_QUERIES.map(x=>googleFallback(x.theme,x.q,lookback)))]);
  const seedMap=new Map<string,any>();for(const x of naverGroups.flat()){const prev=seedMap.get(x.link);if(!prev)seedMap.set(x.link,x)}const naverSeeds=[...seedMap.values()].slice(0,MAX_NAVER_ARTICLES);const naverArticles=await mapConcurrent(naverSeeds,24,readNaverArticle),googleArticles=googleGroups.flat(),articles=[...naverArticles,...googleArticles],events:any[]=[];const now=Date.now(),minT=now-2*86400000,maxT=now+horizon*86400000;
  for(const a of articles){const text=`${a.title||''} ${a.desc||''} ${a.body||''}`;if(!EVENT_CUES.test(text))continue;const dates=extractEventDates(text,a.publishedAt);if(!dates.length)continue;const official=isOfficial(a.source||'',a.sourceUrl||a.link||'');for(const d of dates){const t=new Date(d.date+'T00:00:00+09:00').getTime();if(t<minT||t>maxT)continue;const ctx=contextAround(text,d.raw);if(!EVENT_CUES.test(ctx))continue;if(d.inferred&&!FORWARD_CUES.test(ctx))continue;let companies=matchedCompanies(ctx,stocks,marketSet);if(!companies.length)companies=matchedCompanies(a.title||'',stocks,marketSet);if(!companies.length)continue;const theme=classifyTheme(ctx,a.theme);for(const c of companies){const inTitle=/^[A-Za-z0-9&. -]{2,}$/.test(c.name)?asciiMention(a.title||'',c.name):koreanMention(a.title||'',c.name);const score=eventScore({bodyRead:a.bodyRead,official,source:a.source,inTitle,theme,eventDate:d.date,context:ctx});events.push({id:createHash('sha1').update(`${c.code}|${theme}|${d.date}|${a.title}`).digest('hex').slice(0,18),company:c.name,code:c.code,market:c.market,price:c.price,changePct:c.changePct,marketCapEok:c.marketCapEok,eventDate:d.date,dDay:daysUntil(d.date),theme,score,title:(a.title||'').replace(/\s+-\s+[^-]+$/,'').trim(),source:a.source||'뉴스',official,publishedAt:a.publishedAt,url:a.link,naver:c.naver,news:c.news,dateText:d.raw,bodyRead:!!a.bodyRead,bodyEvidence:clean(ctx).slice(0,360)});}}
  }
  const seen=new Set<string>();const unique=events.filter(x=>{const k=`${x.code}|${x.theme}|${x.eventDate}|${x.title.toLowerCase().replace(/\s+/g,' ').slice(0,100)}`;if(seen.has(k))return false;seen.add(k);return true});unique.sort((a,b)=>a.dDay-b.dDay||b.score-a.score||new Date(b.publishedAt).getTime()-new Date(a.publishedAt).getTime());const counts:any={};for(const x of unique)counts[x.theme]=(counts[x.theme]||0)+1;
  return json({ok:true,generatedAt:new Date().toISOString(),elapsedMs:Date.now()-started,universeCount:stocks.filter((s:any)=>marketSet.has(s.market)).length,articleCount:articles.length,naverSearchCount:naverSeeds.length,bodyReadCount:naverArticles.filter(x=>x.bodyRead).length,bodyEventCount:unique.filter(x=>x.bodyRead).length,eventCount:unique.length,counts,events:unique.slice(0,1800),notes:['네이버 뉴스 검색 페이지에서 직접·구형·인코딩 링크를 모두 복원한 뒤 기사 본문을 읽습니다.','각 날짜의 앞뒤 문장 안에서 종목명을 다시 매칭해 한 기사에 언급된 다른 종목이 잘못 붙는 현상을 줄였습니다.','일정은 변경될 수 있으므로 원문·KIND/DART·회사 IR·공식기관에서 최종 확인하세요.']});
}
