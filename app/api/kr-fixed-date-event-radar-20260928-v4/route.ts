import { createHash, timingSafeEqual } from 'crypto';
import { load } from 'cheerio';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const ACCESS_HASH = '0421d7067c7573fa6ff26138c1186a05d2514708f814b2549e65c2185277f6bc';
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Mobile Safari/537.36';
const MARKET_CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_ARTICLES_PER_PACK = 360;
let universeCache = { at: 0, rows: [] };

const THEME_BASKETS = {
  '우주·항공': ['한화에어로스페이스','한국항공우주','쎄트렉아이','인텔리안테크','AP위성','컨텍','제노코','켄코아에어로스페이스','한화시스템'],
  '반도체·AI·로봇': ['삼성전자','SK하이닉스','한미반도체','이수페타시스','테크윙','HPSP','주성엔지니어링','ISC','리노공업','레인보우로보틱스','두산로보틱스','로보티즈'],
  '2차전지·자동차': ['LG에너지솔루션','삼성SDI','포스코퓨처엠','에코프로비엠','엘앤에프','대주전자재료','현대차','기아','현대모비스','HL만도','퓨런티어','넥스트칩'],
  '원전·에너지': ['두산에너빌리티','한전기술','한전KPS','비에이치아이','우리기술','우진','보성파워텍','HD현대일렉트릭','효성중공업','LS ELECTRIC'],
  '방산·조선': ['한화에어로스페이스','LIG넥스원','현대로템','한화시스템','한국항공우주','한화오션','HD현대중공업','HD한국조선해양','삼성중공업'],
  '제품·서비스 출시': ['LG이노텍','비에이치','삼성전기','덕산네오룩스','PI첨단소재','자화전자','나무가','뉴프렉스'],
  '임상·학회': ['유한양행','한미약품','HLB','에이비엘바이오','알테오젠','리가켐바이오','에스티팜','보로노이'],
  'FDA·허가': ['HLB','유한양행','한미약품','에이비엘바이오','알테오젠','리가켐바이오','에스티팜','보로노이'],
  '지수·시장제도': [], '실적·IR': [], '주총·배당·증자': [], 'M&A·계약': [], '정부정책·입찰': [], '법원·특허·규제': [], '전시회·정상회의': []
};

const PACKS = {
  bio: [
    ['FDA·허가','FDA PDUFA 목표일 예정 국내 바이오'],['FDA·허가','FDA 승인 결정 예정일 한국 제약'],['FDA·허가','FDA 재신청 통보 시한 국내 바이오'],['FDA·허가','식약처 품목허가 예정 승인 심사 국내 제약'],['FDA·허가','EMA CHMP 의견 예정 한국 바이오'],['임상·학회','임상 3상 탑라인 결과 발표 예정 국내 바이오'],['임상·학회','임상 2상 결과 발표 예정 국내 제약'],['임상·학회','ASCO 발표 예정 국내 바이오'],['임상·학회','ESMO 발표 예정 국내 바이오'],['임상·학회','AACR 발표 예정 국내 바이오'],['임상·학회','SITC 발표 예정 국내 바이오'],['임상·학회','학회 초록 공개 예정 국내 바이오']
  ],
  corporate: [
    ['실적·IR','실적 발표 예정일 상장사'],['실적·IR','기업설명회 개최 예정 상장사'],['실적·IR','IR NDR 컨퍼런스콜 예정 상장사'],['주총·배당·증자','임시주주총회 개최 예정 상장사'],['주총·배당·증자','배당 기준일 예정 상장사'],['주총·배당·증자','유상증자 납입 예정일 상장사'],['주총·배당·증자','무상증자 신주 상장 예정일'],['주총·배당·증자','보호예수 해제 예정 종목'],['주총·배당·증자','전환사채 전환청구 신주상장 예정'],['M&A·계약','공개매수 마감 예정 상장사'],['M&A·계약','합병 분할 주주총회 예정 상장사'],['M&A·계약','인수 매각 본계약 체결 예정 상장사']
  ],
  space: [
    ['우주·항공','스페이스X 발사 예정 일정'],['우주·항공','SpaceX launch schedule 예정'],['우주·항공','스타십 시험비행 예정 일정'],['우주·항공','팰컨9 발사 예정 스타링크'],['우주·항공','스타링크 발사 일정 예정'],['우주·항공','NASA 아르테미스 발사 예정 일정'],['우주·항공','블루오리진 발사 예정 일정'],['우주·항공','누리호 발사 예정 일정'],['우주·항공','국내 위성 발사 예정 일정'],['우주·항공','우주청 발사 계획 예정 국내 기업'],['우주·항공','위성통신 서비스 출시 예정 스타링크 한국'],['우주·항공','저궤도 위성 사업 선정 발표 예정']
  ],
  tech: [
    ['반도체·AI·로봇','엔비디아 GTC 일정 예정'],['반도체·AI·로봇','NVIDIA 실적 발표 예정일'],['반도체·AI·로봇','TSMC 실적 발표 예정일'],['반도체·AI·로봇','마이크론 실적 발표 예정일 HBM'],['반도체·AI·로봇','ASML 실적 발표 예정일 EUV'],['반도체·AI·로봇','AMD 신제품 발표 예정 일정 AI'],['반도체·AI·로봇','HBM 양산 공급 예정 국내 기업'],['반도체·AI·로봇','AI 데이터센터 구축 발표 예정 국내 기업'],['반도체·AI·로봇','휴머노이드 로봇 공개 예정 일정'],['반도체·AI·로봇','Figure AI 로봇 행사 예정'],['제품·서비스 출시','애플 신제품 발표 일정 예정'],['제품·서비스 출시','폴더블 아이폰 출시 예정 일정'],['제품·서비스 출시','Meta 스마트글라스 공개 예정 일정']
  ],
  energy: [
    ['원전·에너지','SMR 프로젝트 선정 발표 예정 일정'],['원전·에너지','미국 SMR 원전 프로젝트 발표 예정'],['원전·에너지','체코 원전 계약 일정 예정 한국'],['원전·에너지','원전 우선협상대상자 발표 예정'],['원전·에너지','전력망 투자 계획 발표 예정 국내 기업'],['원전·에너지','ESS 수주 입찰 발표 예정 국내 기업'],['원전·에너지','LNG 발전 프로젝트 선정 예정'],['원전·에너지','수소 프로젝트 입찰 선정 발표 예정'],['원전·에너지','해상풍력 사업자 선정 예정'],['원전·에너지','태양광 보조금 정책 발표 예정'],['정부정책·입찰','에너지 정책 로드맵 발표 예정 정부'],['정부정책·입찰','전력 설비 입찰 결과 발표 예정']
  ],
  mobility: [
    ['2차전지·자동차','테슬라 로보택시 일정 예정'],['2차전지·자동차','Tesla FSD 행사 예정 일정'],['2차전지·자동차','테슬라 옵티머스 공개 예정 일정'],['2차전지·자동차','전고체 배터리 양산 예정 일정'],['2차전지·자동차','배터리 공장 가동 예정 국내 기업'],['2차전지·자동차','인터배터리 신제품 공개 예정'],['2차전지·자동차','자율주행 상용화 예정 국내 기업'],['2차전지·자동차','현대차 신차 공개 예정 일정'],['2차전지·자동차','기아 신차 출시 예정 일정'],['2차전지·자동차','전기차 보조금 발표 예정'],['반도체·AI·로봇','로봇 양산 예정 국내 기업'],['반도체·AI·로봇','휴머노이드 양산 일정 예정']
  ],
  defense: [
    ['방산·조선','폴란드 방산 계약 예정 일정 한국'],['방산·조선','루마니아 방산 입찰 결과 발표 예정'],['방산·조선','사우디 방산 계약 예정 한국 기업'],['방산·조선','미국 해군 MRO 입찰 결과 예정 한국'],['방산·조선','캐나다 잠수함 사업 발표 예정 한국'],['방산·조선','호주 군함 사업 입찰 예정 한국'],['방산·조선','조선 수주 계약 발표 예정 LNG선'],['방산·조선','한화오션 MRO 계약 일정 예정'],['방산·조선','HD현대중공업 함정 수주 예정'],['방산·조선','방위사업청 사업자 선정 발표 예정'],['M&A·계약','대형 수주 본계약 체결 예정 조선'],['정부정책·입찰','방산 수출 금융 지원 발표 예정']
  ],
  market: [
    ['지수·시장제도','MSCI 정기변경 발표 예정 종목'],['지수·시장제도','코스피200 정기변경 편입 예정'],['지수·시장제도','코스닥150 정기변경 편입 예정'],['지수·시장제도','FTSE 지수 변경 예정 한국 종목'],['지수·시장제도','지수 리밸런싱 적용일 예정 종목'],['법원·특허·규제','판결 선고 예정일 상장사'],['법원·특허·규제','특허 소송 판결 예정 상장사'],['법원·특허·규제','가처분 결정 예정 상장사'],['주총·배당·증자','신규상장 보호예수 해제 예정'],['M&A·계약','상장폐지 심의 예정 종목'],['실적·IR','코리아 프리미엄 위크 IR 일정 상장사'],['전시회·정상회의','CES 참가 예정 국내 상장사'],['전시회·정상회의','MWC 참가 예정 국내 상장사'],['전시회·정상회의','SEMICON 참가 예정 국내 상장사']
  ],
  policy: [
    ['정부정책·입찰','정부 정책 발표 예정 산업 수혜 기업'],['정부정책·입찰','산업부 로드맵 발표 예정 기업'],['정부정책·입찰','과기정통부 사업 선정 발표 예정'],['정부정책·입찰','국토부 사업자 선정 발표 예정'],['정부정책·입찰','방위사업청 입찰 결과 발표 예정'],['정부정책·입찰','KOTRA 사업 참가기업 발표 예정'],['정부정책·입찰','정부 보조금 선정 발표 예정 상장사'],['정부정책·입찰','국책과제 선정 발표 예정 기업'],['정부정책·입찰','대규모 투자 프로젝트 발표 예정 기업'],['전시회·정상회의','비즈니스 포럼 참가기업 발표 예정'],['전시회·정상회의','경제사절단 참가기업 발표 예정'],['전시회·정상회의','국제 전시회 참가 발표 예정 국내 기업']
  ],
  calendar: [
    ['기타 일정','오는 발표 예정 상장사'],['기타 일정','내달 발표 예정 상장사'],['기타 일정','다음달 발표 예정 상장사'],['기타 일정','다음주 발표 예정 기업'],['기타 일정','연내 발표 예정 상장사'],['기타 일정','올해 하반기 예정 상장사'],['제품·서비스 출시','내달 출시 예정 국내 기업'],['M&A·계약','내달 계약 예정 국내 기업'],['정부정책·입찰','내달 선정 발표 예정 기업'],['임상·학회','내달 임상 결과 발표 예정 바이오'],['실적·IR','내달 IR 예정 상장사'],['우주·항공','내달 발사 예정 위성 우주']
  ]
};

const GLOBAL_HINTS = [
  {re:/spacex|스페이스\s*x|스타십|starship|falcon|팰컨|starlink|스타링크/i,theme:'우주·항공',reason:'SpaceX·Starship·Falcon·Starlink 일정 연동'},
  {re:/nasa|아르테미스|artemis|blue\s*origin|블루오리진/i,theme:'우주·항공',reason:'NASA·Artemis·민간우주 일정 연동'},
  {re:/nvidia|엔비디아|\bgtc\b|blackwell|rubin/i,theme:'반도체·AI·로봇',reason:'NVIDIA GTC·실적·AI 신제품 일정 연동'},
  {re:/tsmc|마이크론|micron|asml|euv|hbm/i,theme:'반도체·AI·로봇',reason:'글로벌 반도체 실적·기술 일정 연동'},
  {re:/tesla|테슬라|robotaxi|로보택시|\bfsd\b|optimus|옵티머스/i,theme:'2차전지·자동차',reason:'Tesla·FSD·Robotaxi·Optimus 일정 연동'},
  {re:/apple|애플|iphone|아이폰|폴더블/i,theme:'제품·서비스 출시',reason:'Apple 신제품·폴더블 일정 연동'},
  {re:/smr|소형모듈원전|원전\s*프로젝트/i,theme:'원전·에너지',reason:'SMR·원전 프로젝트 일정 연동'},
  {re:/방산|잠수함|군함|해군.*mro|mro.*해군/i,theme:'방산·조선',reason:'해외 방산·함정 MRO 일정 연동'},
  {re:/asco|esmo|aacr|sitc/i,theme:'임상·학회',reason:'글로벌 바이오 학회 일정 연동'}
];

const EVENT_CUES = /예정|일정|목표|목표일|시한|기한|승인|허가|결정|심사|발표|공개|개최|학회|임상|탑라인|주주총회|배당|권리락|납입|상장|보호예수|입찰|선정|계약|수주|인도|진수|착공|준공|양산|출시|상용화|발사|시험|마감|편입|편출|리밸런싱|시행|선고|공청회|청문회|행사|전시회|전망|예상|계획/i;
const FORWARD_CUES = /예정|계획|목표|목표일|시한|기한|결정일|발표할|발표 예정|공개 예정|개최 예정|상장 예정|납입 예정|선고 예정|발사 예정|출시 예정|양산 예정|착공 예정|준공 예정|통보 시한|심사 기한|마감|적용일|시행일|기준일|전망|예상/i;

function verify(code){if(!code)return false;const got=createHash('sha256').update(code.trim()).digest();const exp=Buffer.from(ACCESS_HASH,'hex');return got.length===exp.length&&timingSafeEqual(got,exp)}
function json(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}})}
function num(v){const n=Number(String(v??'').replace(/,/g,'').replace(/[^0-9.+-]/g,''));return Number.isFinite(n)?n:null}
function capEok(v){const s=String(v??'').replace(/,/g,'');let t=0,f=false;const a=s.match(/([0-9.]+)조/);if(a){t+=Number(a[1])*10000;f=true}const b=s.match(/([0-9.]+)억/);if(b){t+=Number(b[1]);f=true}return f?t:num(s)}
function clean(s=''){return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function safeIso(s=''){try{const d=new Date(s);if(Number.isFinite(d.getTime()))return d.toISOString()}catch{}return new Date().toISOString()}
async function fetchText(url,headers={},timeout=7000){const r=await fetch(url,{cache:'no-store',redirect:'follow',headers:{'User-Agent':UA,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.7',...headers},signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text()}
async function fetchJson(url,headers={}){const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':UA,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.7',...headers},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json()}
function pickArray(j){if(Array.isArray(j))return j;for(const k of ['stocks','items','data','stockList','result'])if(Array.isArray(j?.[k]))return j[k];if(Array.isArray(j?.result?.stocks))return j.result.stocks;if(Array.isArray(j?.result?.items))return j.result.items;return []}

async function loadMarket(market){const pageSize=100;const first=await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=1&pageSize=${pageSize}`,{Referer:'https://m.stock.naver.com/'});const count=Number(first?.totalCount??first?.result?.totalCount??first?.totalElements??0);const pageCount=count?Math.min(35,Math.ceil(count/pageSize)):30;const pages=[{p:1,rows:pickArray(first)}];for(let s=2;s<=pageCount;s+=8){const batch=[];for(let p=s;p<Math.min(s+8,pageCount+1);p++)batch.push(fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${p}&pageSize=${pageSize}`,{Referer:'https://m.stock.naver.com/'}).then(j=>({p,rows:pickArray(j)})).catch(()=>({p,rows:[]})));pages.push(...await Promise.all(batch))}const out=[],seen=new Set();for(const pg of pages.sort((a,b)=>a.p-b.p))for(const x of pg.rows){const code=String(x?.itemCode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||'';const name=String(x?.stockName??x?.name??x?.itemName??'').trim();if(!code||!name||seen.has(code))continue;seen.add(code);out.push({code,name,market,price:num(x?.closePrice??x?.currentPrice),changePct:num(x?.fluctuationsRatio??x?.changeRate),marketCapEok:capEok(x?.marketValue??x?.marketCap),naver:`https://finance.naver.com/item/main.naver?code=${code}`,news:`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(name)}`})}return out}
async function universe(){if(Date.now()-universeCache.at<MARKET_CACHE_MS&&universeCache.rows.length>1000)return universeCache.rows;const [a,b]=await Promise.all([loadMarket('KOSPI'),loadMarket('KOSDAQ')]);universeCache={at:Date.now(),rows:[...a,...b]};return universeCache.rows}

function dateIso(y,m,d){const x=new Date(Date.UTC(y,m-1,d));if(x.getUTCFullYear()!==y||x.getUTCMonth()!==m-1||x.getUTCDate()!==d)return null;return x.toISOString().slice(0,10)}
function lastDay(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate()}
function inferYear(m,ref){let y=ref.getUTCFullYear();if(m<ref.getUTCMonth()+1-1)y++;return y}
function addWindow(out,y,m,d1,d2,raw,precision,inferred=true){const a=dateIso(y,m,d1),b=dateIso(y,m,d2);if(a&&b)out.push({start:a,end:b,raw,precision,inferred})}
function extractWindows(text,refDate){const ref=new Date(refDate||Date.now()),out=[];let m;
  const full=/(20\d{2})\s*[년.\/-]\s*(1[0-2]|0?\d)\s*[월.\/-]\s*([0-3]?\d)\s*일?/g;while((m=full.exec(text))){const d=dateIso(+m[1],+m[2],+m[3]);if(d)out.push({start:d,end:d,raw:m[0],precision:'정확일',inferred:false})}
  const range=/(?<!\d)(1[0-2]|0?\d)\s*월\s*([0-3]?\d)\s*(?:~|～|-|부터)\s*([0-3]?\d)\s*일/g;while((m=range.exec(text))){const y=inferYear(+m[1],ref),a=dateIso(y,+m[1],+m[2]),b=dateIso(y,+m[1],+m[3]);if(a&&b)out.push({start:a,end:b,raw:m[0],precision:'날짜범위',inferred:true})}
  const exact=/(?<!\d)(1[0-2]|0?\d)\s*월\s*([0-3]?\d)\s*일/g;while((m=exact.exec(text))){const y=inferYear(+m[1],ref),d=dateIso(y,+m[1],+m[2]);if(d)out.push({start:d,end:d,raw:m[0],precision:'정확일',inferred:true})}
  const thisMonth=/이달\s*([0-3]?\d)\s*일/g;while((m=thisMonth.exec(text))){const d=dateIso(ref.getUTCFullYear(),ref.getUTCMonth()+1,+m[1]);if(d)out.push({start:d,end:d,raw:m[0],precision:'정확일',inferred:true})}
  const nextMonth=/내달\s*([0-3]?\d)\s*일/g;while((m=nextMonth.exec(text))){let y=ref.getUTCFullYear(),mm=ref.getUTCMonth()+2;if(mm>12){mm-=12;y++}const d=dateIso(y,mm,+m[1]);if(d)out.push({start:d,end:d,raw:m[0],precision:'정확일',inferred:true})}
  const part=/(?:(20\d{2})\s*년\s*)?(1[0-2]|0?\d)\s*월\s*(초|초순|중순|말|말께|말경)/g;while((m=part.exec(text))){const mm=+m[2],y=m[1]?+m[1]:inferYear(mm,ref),p=m[3];if(/초/.test(p))addWindow(out,y,mm,1,10,m[0],'기간예정',!m[1]);else if(/중순/.test(p))addWindow(out,y,mm,11,20,m[0],'기간예정',!m[1]);else addWindow(out,y,mm,21,lastDay(y,mm),m[0],'기간예정',!m[1])}
  const monthOnly=/(?:(20\d{2})\s*년\s*)?(1[0-2]|0?\d)\s*월\s*(?:중|내|께|경|예정|목표|계획)/g;while((m=monthOnly.exec(text))){const mm=+m[2],y=m[1]?+m[1]:inferYear(mm,ref);addWindow(out,y,mm,1,lastDay(y,mm),m[0],'월예정',!m[1])}
  const quarter=/(?:(20\d{2})\s*년\s*)?([1-4])\s*분기\s*(?:중|내|예정|목표|계획|출시|발표|양산)/g;while((m=quarter.exec(text))){const q=+m[2],y=m[1]?+m[1]:ref.getUTCFullYear(),sm=(q-1)*3+1,em=q*3;const a=dateIso(y,sm,1),b=dateIso(y,em,lastDay(y,em));if(a&&b)out.push({start:a,end:b,raw:m[0],precision:'분기예정',inferred:!m[1]})}
  const uniq=[],seen=new Set();for(const x of out){const k=`${x.start}|${x.end}|${x.raw}`;if(!seen.has(k)){seen.add(k);uniq.push(x)}}return uniq}
function contextAround(text,raw){const i=raw?text.indexOf(raw):-1;if(i<0)return text.slice(0,800);return text.slice(Math.max(0,i-420),Math.min(text.length,i+raw.length+500))}
function daysUntil(date){const t=new Date(date+'T00:00:00+09:00').getTime();const n=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Seoul'}));n.setHours(0,0,0,0);return Math.round((t-n.getTime())/86400000)}
function statusFrom(ctx){if(/확정|공식|개최한다|시행한다|기준일|납입일|상장일|PDUFA|목표일|발사창|마감일/i.test(ctx))return '확정·고정';if(/예정|계획|목표|추진|준비/i.test(ctx))return '예정';if(/전망|예상|관측|가능성|유력/i.test(ctx))return '전망';return '후보'}
function stageFrom(d){if(d<0)return '경과';if(d<=3)return '당일·임박';if(d<=14)return 'D-14 집중관찰';if(d<=45)return 'D-45 사전관찰';if(d<=120)return 'D-120 조기포착';return '장기일정'}
function classify(ctx,fallback){const t=ctx.toLowerCase();if(/pdufa|\bfda\b|식약처|ema|chmp|품목허가/.test(t))return 'FDA·허가';if(/임상|1상|2상|3상|asco|esmo|aacr|sitc|학회|탑라인/.test(t))return '임상·학회';if(/spacex|스페이스x|스타십|starlink|위성|발사체|nasa|아르테미스/.test(t))return '우주·항공';if(/nvidia|엔비디아|hbm|반도체|ai|로봇|humanoid/.test(t))return '반도체·AI·로봇';if(/테슬라|tesla|배터리|전고체|전기차|자율주행|robotaxi/.test(t))return '2차전지·자동차';if(/원전|smr|전력망|ess|lng|수소|풍력|태양광/.test(t))return '원전·에너지';if(/방산|군함|잠수함|mro|방사청|무기체계|조선/.test(t))return '방산·조선';if(/주주총회|배당|유상증자|무상증자|보호예수|전환사채|신주/.test(t))return '주총·배당·증자';if(/실적|기업설명회|\bir\b|\bndr\b|컨퍼런스콜/.test(t))return '실적·IR';if(/m&a|인수|합병|매각|공개매수|공급계약|수주/.test(t))return 'M&A·계약';if(/msci|코스피200|코스닥150|ftse|리밸런싱|편입|편출/.test(t))return '지수·시장제도';if(/판결|소송|특허|가처분|선고|심의/.test(t))return '법원·특허·규제';if(/출시|신제품|아이폰|apple|스마트글라스|상용화|양산/.test(t))return '제품·서비스 출시';if(/정부|산업부|과기정통부|국토부|보조금|국책과제|정책|로드맵/.test(t))return '정부정책·입찰';return fallback||'기타 일정'}
function escRe(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function mention(text,name){if(name==='NAVER')return /(^|[^가-힣A-Za-z0-9])(NAVER|네이버)(?=$|[^가-힣A-Za-z0-9])/i.test(text);if(/^[A-Za-z0-9&. -]{2,}$/.test(name))return new RegExp(`(^|[^A-Za-z0-9가-힣])${escRe(name)}(?=$|[^A-Za-z0-9가-힣])`,'i').test(text);return new RegExp(`(^|[^가-힣A-Za-z0-9])${escRe(name)}(?=$|[^가-힣A-Za-z0-9]|은|는|이|가|의|을|를|과|와|도|에|서|로|측|사|그룹)`,'i').test(text)}
function matchedCompanies(text,stocks,marketSet){const out=[];for(const s of stocks){if(!marketSet.has(s.market))continue;if(mention(text,s.name)){out.push(s);if(out.length>=14)break}}return out}

function canonicalNaver(oid,aid){return /^\d{3,4}$/.test(oid)&&/^\d{7,12}$/.test(aid)?`https://n.news.naver.com/article/${oid}/${aid}`:''}
function normalizeNaverUrl(href){if(!href)return '';let h=String(href).replace(/&amp;/g,'&').replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/');try{if(/^https?%3A/i.test(h))h=decodeURIComponent(h)}catch{}try{const u=new URL(h);if(/n\.news\.naver\.com$/i.test(u.hostname)){const m=u.pathname.match(/\/(?:mnews\/)?article\/(\d+)\/(\d+)/);if(m)return canonicalNaver(m[1],m[2])}if(/news\.naver\.com$/i.test(u.hostname))return canonicalNaver(u.searchParams.get('oid')||'',u.searchParams.get('aid')||'')}catch{}return ''}
function extractLinks(html){const set=new Set(),decoded=html.replace(/\\u002F/gi,'/').replace(/\\u003A/gi,':').replace(/\\\//g,'/').replace(/&amp;/g,'&');let m;const p1=/https?:\/\/n\.news\.naver\.com\/(?:mnews\/)?article\/(\d+)\/(\d+)/gi;while((m=p1.exec(decoded)))set.add(canonicalNaver(m[1],m[2]));const $=load(html);$('a[href]').each((_,e)=>{const x=normalizeNaverUrl(String($(e).attr('href')||''));if(x)set.add(x)});return [...set].filter(Boolean)}
function ymdKst(d){return d.toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}).replace(/-/g,'.')}
function monthQueries(){const n=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Seoul'})),arr=[];for(let i=0;i<6;i++){let mm=n.getMonth()+1+i,yy=n.getFullYear();while(mm>12){mm-=12;yy++}for(const [theme,tail] of [['기타 일정','발표 예정 상장사'],['제품·서비스 출시','출시 양산 예정 국내 기업'],['M&A·계약','계약 수주 예정 국내 기업'],['임상·학회','임상 학회 발표 예정 바이오'],['우주·항공','발사 위성 예정'],['정부정책·입찰','선정 입찰 발표 예정 기업']])arr.push([theme,`${yy}년 ${mm}월 ${tail}`])}return arr}
async function naverSearch(theme,q,lookback,depth){const out=[],seen=new Set(),ds=ymdKst(new Date(Date.now()-lookback*86400000)),de=ymdKst(new Date()),pages=depth==='deep'?[1,11,21,31,41]:[1,11,21];for(const start of pages){try{const url=`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(q)}&sort=1&photo=0&field=0&pd=3&ds=${encodeURIComponent(ds)}&de=${encodeURIComponent(de)}&start=${start}`;const html=await fetchText(url,{Referer:'https://search.naver.com/'},6000);for(const link of extractLinks(html))if(!seen.has(link)){seen.add(link);out.push({theme,q,link})}}catch{}}return out}
function cleanNode($,node){const c=node.clone();c.find('script,style,figure,iframe,nav,aside,footer,.end_photo_org,.img_desc,.article_byline,.copyright,.media_end_linked_more,.media_end_categorize,[class*="recommend"],[class*="related"],[class*="promotion"],[class*="ranking"]').remove();return clean(c.text()).slice(0,28000)}
async function readArticle(seed){try{const html=await fetchText(seed.link,{Referer:'https://search.naver.com/'},6500),$=load(html);const title=clean($('#title_area').first().text())||clean($('.media_end_head_headline').first().text())||clean($('meta[property="og:title"]').attr('content')||'');let body='';for(const sel of ['#dic_area','.go_trans._article_content','#newsct_article']){const n=$(sel).first();if(n.length){const t=cleanNode($,n);if(t.length>80){body=t;break}}}const source=clean($('.media_end_head_top_logo img').attr('alt')||'')||clean($('.media_end_head_top_logo').text())||'네이버뉴스';const pub=$('.media_end_head_info_datestamp_time').first().attr('data-date-time')||$('meta[property="article:published_time"]').attr('content')||'';return {...seed,title,body,source,publishedAt:safeIso(pub),bodyRead:body.length>80}}catch{return {...seed,title:'',body:'',source:'네이버뉴스',publishedAt:new Date().toISOString(),bodyRead:false}}}
async function mapConcurrent(xs,limit,fn){const out=[];for(let i=0;i<xs.length;i+=limit)out.push(...await Promise.all(xs.slice(i,i+limit).map(fn)));return out}
function scoreRow({bodyRead,relationType,precision,status,dDay,theme}){let s=42+(bodyRead?10:0)+(relationType==='직접언급'?12:0)+(precision==='정확일'?13:precision==='날짜범위'?9:precision==='기간예정'?7:precision==='월예정'?4:1)+(status==='확정·고정'?11:status==='예정'?7:status==='전망'?2:0);if(['FDA·허가','임상·학회','우주·항공','M&A·계약'].includes(theme))s+=4;if(dDay>=0&&dDay<=14)s+=5;else if(dDay<=45)s+=3;return Math.min(100,s)}
function rementionScore(row){let s=row.score+(row.precision==='정확일'?8:3)+(row.relationType==='직접언급'?5:0);if(['FDA·허가','임상·학회','우주·항공','방산·조선','M&A·계약','제품·서비스 출시'].includes(row.theme))s+=5;if(row.dDay>=0&&row.dDay<=30)s+=4;return Math.min(100,s)}

export async function GET(req){
  if(!verify(req.headers.get('x-access-code')||req.headers.get('x-radar-key')))return json({ok:false,error:'UNAUTHORIZED'},401);
  const u=new URL(req.url);if(u.searchParams.get('mode')==='ping')return json({ok:true,auth:'valid',packs:Object.keys(PACKS)});
  const pack=u.searchParams.get('pack')||'calendar',lookback=Math.max(14,Math.min(365,Number(u.searchParams.get('lookback')||180))),horizon=Math.max(30,Math.min(540,Number(u.searchParams.get('horizon')||365))),depth=u.searchParams.get('depth')==='standard'?'standard':'deep',marketParam=(u.searchParams.get('market')||'ALL').toUpperCase(),marketSet=new Set(marketParam==='KOSPI'?['KOSPI']:marketParam==='KOSDAQ'?['KOSDAQ']:['KOSPI','KOSDAQ']);
  const started=Date.now(),stocks=await universe(),byName=new Map(stocks.map(s=>[s.name,s]));let queries=[...(PACKS[pack]||PACKS.calendar)];if(pack==='calendar')queries.push(...monthQueries());
  const groups=await Promise.all(queries.map(([theme,q])=>naverSearch(theme,q,lookback,depth)));const seedMap=new Map();for(const x of groups.flat()){const old=seedMap.get(x.link);if(!old)seedMap.set(x.link,{...x,metas:[{theme:x.theme,q:x.q}]});else old.metas.push({theme:x.theme,q:x.q})}const seeds=[...seedMap.values()].slice(0,MAX_ARTICLES_PER_PACK),articles=await mapConcurrent(seeds,28,readArticle),rows=[];
  const maxT=Date.now()+horizon*86400000,minT=Date.now()-3*86400000;
  for(const a of articles){const text=`${a.title||''} ${a.body||''}`;if(!EVENT_CUES.test(text))continue;const windows=extractWindows(text,a.publishedAt);if(!windows.length)continue;for(const w of windows){const st=new Date(w.start+'T00:00:00+09:00').getTime(),en=new Date(w.end+'T23:59:59+09:00').getTime();if(en<minT||st>maxT)continue;const ctx=contextAround(text,w.raw);if(!EVENT_CUES.test(ctx))continue;if(w.inferred&&!FORWARD_CUES.test(ctx))continue;const fallback=a.metas?.[0]?.theme||a.theme||'기타 일정',theme=classify(ctx,fallback),status=statusFrom(ctx),dDay=daysUntil(w.start),direct=matchedCompanies(ctx,stocks,marketSet).length?matchedCompanies(ctx,stocks,marketSet):matchedCompanies(a.title||'',stocks,marketSet),used=new Set();
      for(const c of direct){used.add(c.code);const base={company:c.name,code:c.code,market:c.market,price:c.price,changePct:c.changePct,marketCapEok:c.marketCapEok,eventDate:w.start,eventEnd:w.end,dDay,theme,title:a.title||a.metas?.[0]?.q||'예정 일정',source:a.source,publishedAt:a.publishedAt,url:a.link,naver:c.naver,news:c.news,dateText:w.raw,bodyRead:a.bodyRead,bodyEvidence:clean(ctx).slice(0,240),relationType:'직접언급',mappingReason:'기사 제목 또는 일정 주변 본문에 종목명이 직접 등장',precision:w.precision,scheduleStatus:status,stage:stageFrom(dDay)};base.score=scoreRow({...base});base.rementionScore=rementionScore(base);base.id=createHash('sha1').update(`${c.code}|${w.start}|${w.end}|${theme}|${a.title}|direct`).digest('hex').slice(0,18);rows.push(base)}
      for(const hint of GLOBAL_HINTS){if(!hint.re.test(`${a.title||''} ${ctx}`))continue;const basket=THEME_BASKETS[hint.theme]||[];for(const name of basket.slice(0,10)){const c=byName.get(name);if(!c||!marketSet.has(c.market)||used.has(c.code))continue;const base={company:c.name,code:c.code,market:c.market,price:c.price,changePct:c.changePct,marketCapEok:c.marketCapEok,eventDate:w.start,eventEnd:w.end,dDay,theme:hint.theme,title:a.title||a.metas?.[0]?.q||'글로벌 예정 일정',source:a.source,publishedAt:a.publishedAt,url:a.link,naver:c.naver,news:c.news,dateText:w.raw,bodyRead:a.bodyRead,bodyEvidence:clean(ctx).slice(0,240),relationType:'테마연결',mappingReason:hint.reason,precision:w.precision,scheduleStatus:status,stage:stageFrom(dDay)};base.score=Math.max(35,scoreRow({...base})-11);base.rementionScore=Math.max(35,rementionScore(base)-7);base.id=createHash('sha1').update(`${c.code}|${w.start}|${w.end}|${hint.theme}|${a.title}|linked`).digest('hex').slice(0,18);rows.push(base)}}
    }
  }
  const seen=new Set(),unique=rows.filter(x=>{const k=`${x.code}|${x.eventDate}|${x.eventEnd}|${x.theme}|${x.relationType}|${x.title.slice(0,70)}`;if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>a.dDay-b.dDay||b.rementionScore-a.rementionScore||b.score-a.score);const counts={};for(const x of unique)counts[x.theme]=(counts[x.theme]||0)+1;
  return json({ok:true,pack,depth,generatedAt:new Date().toISOString(),elapsedMs:Date.now()-started,universeCount:stocks.filter(s=>marketSet.has(s.market)).length,queryCount:queries.length,naverSearchCount:seeds.length,bodyReadCount:articles.filter(x=>x.bodyRead).length,eventCount:unique.length,counts,events:unique.slice(0,2200),notes:['정확한 날짜뿐 아니라 월·초중말·분기 예정 일정도 별도 정밀도로 보존합니다.','일정매매용으로 D-Day 단계, 일정 확정도, 재부각 휴리스틱 점수를 함께 제공합니다.','테마연결은 해당 국내기업의 공식 일정이 아니라 글로벌 촉매와의 관련 후보입니다.']})
}
