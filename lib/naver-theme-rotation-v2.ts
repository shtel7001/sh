import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { unstable_cache } from 'next/cache';

const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n));
const median=(a:number[])=>{const x=a.filter(Number.isFinite).sort((p,q)=>p-q);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;};
const num=(v:any)=>{if(typeof v==='number')return Number.isFinite(v)?v:0;const n=Number(String(v??'').replace(/[,+%원\s]/g,''));return Number.isFinite(n)?n:0;};
const clean=(s:any)=>String(s??'').replace(/\s+/g,' ').trim();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

export type ThemeRow={no:string;name:string;dayPct:number;threeDayPct:number;up:number;flat:number;down:number;leaders:string[];structural:number;policy:number;global:number;market:number;breadth:number;firstPass:number;newsScore:number;newsItems:any[];outlook:number;overview?:string;stocks?:StockRow[];alienation?:number|null;drawdown?:number|null;momentum20?:number|null;rebound?:number;opportunity?:number;selected?:boolean;rank?:number};
export type StockRow={code:string;name:string;reason:string;market:'KOSPI'|'KOSDAQ'|null;marketCap:number;themeNo?:string;themeName?:string;alienation?:number|null;drawdown?:number|null;momentum20?:number|null;current?:number|null;high?:number|null;capScore?:number;reasonScore?:number;priceScore?:number;reboundScore?:number;qualityScore?:number;tier?:string;rank?:number};

type KeywordBand={score:number;words:string[]};
const structuralBands:KeywordBand[]=[
 {score:98,words:['HBM','고대역폭','AI 반도체','시스템반도체','반도체 장비','반도체 재료','유리 기판','CXL','뉴로모픽','온디바이스 AI','SOCAMM']},
 {score:97,words:['로봇','피지컬AI','스마트팩토리','스마트공장','자동화']},
 {score:96,words:['전력설비','전선','변압기','전력저장','ESS','원자력','SMR','핵융합','SOFC','냉각']},
 {score:95,words:['방위산업','전쟁 및 테러','드론','우주항공','스페이스X','위성','조선','조선기자재','LNG']},
 {score:93,words:['의료AI','유전자 치료','면역항암','항암','바이오','mRNA','치매','고령화']},
 {score:92,words:['보안주','사이버','양자','클라우드','데이터센터','5G','6G','광통신','통신장비']},
 {score:90,words:['2차전지','전고체','리튬','나트륨이온','LFP','전기차','자율주행']},
 {score:86,words:['반도체','PCB','MLCC','OLED','마이크로 LED','폴더블','카메라모듈']},
 {score:82,words:['수소','태양광','풍력','탄소','희토류','희귀금속','스마트그리드']},
 {score:78,words:['핀테크','전자결제','스테이블코인','블록체인','인터넷은행']},
 {score:72,words:['항공','여행','화장품','엔터테인먼트','게임','콘텐츠','식품','의류','건설']},
 {score:58,words:['코로나19','마스크','진단키트','음압병실']},
 {score:48,words:['정치','대선','총선','인맥','품절주']}
];
const policyBands:KeywordBand[]=[
 {score:98,words:['방위산업','원자력','SMR','로봇','우주항공','반도체','전력설비','전선','2차전지','스마트팩토리','5G','6G','사이버','보안주']},
 {score:92,words:['수소','풍력','태양광','전기차','자율주행','의료AI','바이오','희토류','양자','핵융합']},
 {score:84,words:['조선','LNG','철도','UAM','드론','스마트시티','탄소']},
 {score:70,words:['핀테크','스테이블코인','지역화폐','전자결제']},
 {score:45,words:['정치','인맥','대선','총선']}
];
const globalBands:KeywordBand[]=[
 {score:99,words:['AI','HBM','반도체','로봇','우주','스페이스X','방위산업','원자력','SMR','전력설비','전선','조선','LNG','2차전지','바이오','의료AI','사이버','5G','6G','광통신']},
 {score:92,words:['PCB','OLED','MLCC','카메라모듈','희토류','수소','풍력','태양광','자동차']},
 {score:80,words:['게임','콘텐츠','화장품','식품','엔터테인먼트']},
 {score:58,words:['지역화폐','정치','인맥']}
];
function bandScore(name:string,bands:KeywordBand[],base:number){for(const b of bands)if(b.words.some(w=>name.includes(w)))return b.score;return base;}
function semanticScores(name:string){return{structural:bandScore(name,structuralBands,62),policy:bandScore(name,policyBands,58),global:bandScore(name,globalBands,64)};}

async function fetchRaw(url:string,timeout=10000,accept='application/json,text/plain,*/*'){
 let last='';
 for(let i=0;i<3;i++){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);
  try{
   const r=await fetch(url,{signal:ctl.signal,cache:'no-store',headers:{'User-Agent':'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36','Accept':accept,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6','Referer':url.includes('finance.naver.com')?'https://finance.naver.com/':'https://m.stock.naver.com/'}});
   if(!r.ok){last=`HTTP ${r.status}`;await sleep(200*(i+1));continue;}return r;
  }catch(e){last=e instanceof Error?e.message:'fetch failed';await sleep(200*(i+1));}finally{clearTimeout(timer);}
 }
 throw new Error(last||'fetch failed');
}
async function fetchJson(url:string,timeout=10000){const r=await fetchRaw(url,timeout);const tx=await r.text();try{return JSON.parse(tx);}catch{throw new Error('JSON_PARSE_FAILED');}}
async function fetchHtml(url:string,timeout=10000){const r=await fetchRaw(url,timeout,'text/html,application/xhtml+xml,*/*');const b=Buffer.from(await r.arrayBuffer()),ct=(r.headers.get('content-type')||'').toLowerCase();return ct.includes('utf-8')?b.toString('utf8'):iconv.decode(b,'EUC-KR');}
function pickArray(j:any,keys:string[]){if(Array.isArray(j))return j;for(const k of keys){if(Array.isArray(j?.[k]))return j[k];if(Array.isArray(j?.result?.[k]))return j.result[k];}if(Array.isArray(j?.result))return j.result;return [];}
async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T,i:number)=>Promise<R>):Promise<R[]>{const out=new Array<R>(items.length);let cursor=0;async function worker(){while(true){const i=cursor++;if(i>=items.length)return;out[i]=await fn(items[i],i);}}await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));return out;}
function marketName(v:any):'KOSPI'|'KOSDAQ'|null{const s=String(v??'').toUpperCase();if(s.includes('KOSDAQ')||s==='KQ'||s==='2')return'KOSDAQ';if(s.includes('KOSPI')||s==='KS'||s==='1')return'KOSPI';return null;}

function makeTheme(x:any):ThemeRow|null{
 const no=String(x?.code??x?.sectorCode??x?.detailNo??x?.no??'').replace(/\D/g,''),name=clean(x?.name??x?.sectorName??x?.themeName);if(!no||!name)return null;
 const dayPct=num(x?.changeRate??x?.fluctuationsRatio??x?.changePct??x?.rate),threeDayPct=num(x?.threeDayChangeRate??x?.threeDaysChangeRate??x?.changeRate3D??x?.recent3DayChangeRate);
 const up=num(x?.risingCount??x?.risingStockCount??x?.riseCount??x?.upCount),down=num(x?.fallingCount??x?.fallingStockCount??x?.fallCount??x?.downCount),flat=num(x?.unchangedCount??x?.unchangedStockCount??x?.steadyCount??x?.flatCount);
 const leaders:any[]=[];for(const a of [x?.leadingStocks,x?.leaderStocks,x?.topStocks,x?.stocks])if(Array.isArray(a))for(const z of a){const nm=clean(z?.stockName??z?.itemName??z?.name);if(nm&&!leaders.includes(nm)&&leaders.length<2)leaders.push(nm);}
 const total=Math.max(1,up+flat+down),breadth=clamp(35+(up/total)*55-(down/total)*20,20,95),market=clamp(50+dayPct*2.2+threeDayPct*4,20,100),sem=semanticScores(name),firstPass=clamp(sem.structural*.38+sem.policy*.18+sem.global*.18+market*.16+breadth*.10);
 return{no,name,dayPct,threeDayPct,up,flat,down,leaders,...sem,market,breadth,firstPass,newsScore:48,newsItems:[],outlook:firstPass};
}
async function loadThemesFront(){
 const out:ThemeRow[]=[];let cursor='';const seen=new Set<string>();
 for(let turn=0;turn<14;turn++){
  const base='https://m.stock.naver.com/front-api/stock/sectors/all?nationType=domestic&sectorType=theme&sectorSortType=CHANGE_RATE&businessDayCategory=daily&pageSize=50';
  const url=cursor?`${base}&cursor=${encodeURIComponent(cursor)}`:base,j=await fetchJson(url,10000),rows=pickArray(j,['sectors','items','stocks','data']);if(!rows.length)break;
  for(const x of rows){const t=makeTheme(x);if(t)out.push(t);}
  const next=String(j?.result?.cursor??j?.cursor??'');if(j?.result?.hasNext===false||!next||next===cursor||seen.has(next))break;seen.add(next);cursor=next;
 }
 return[...new Map(out.map(x=>[x.no,x])).values()];
}
async function loadThemesLegacy(){
 const out:ThemeRow[]=[];
 for(let page=1;page<=8;page++){
  const html=await fetchHtml(`https://finance.naver.com/sise/theme.naver?page=${page}`,9000),$=cheerio.load(html);let count=0;
  $('a[href*="sise_group_detail.naver"]').each((_,el)=>{const a=$(el),href=a.attr('href')||'';if(!href.includes('type=theme'))return;const no=(href.match(/[?&]no=(\d+)/)||[])[1],name=clean(a.text());if(!no||!name)return;const tr=a.closest('tr'),cells=tr.find('td').map((_,td)=>clean($(td).text())).get();const raw={code:no,name,changeRate:num(cells[1]),threeDayChangeRate:num(cells[2]),risingCount:num(cells[3]),unchangedCount:num(cells[4]),fallingCount:num(cells[5])};const t=makeTheme(raw);if(t){t.leaders=tr.find('a[href*="/item/main.naver?code="]').map((_,z)=>clean($(z).text())).get().filter(Boolean).slice(0,2);out.push(t);count++;}});
  if(!count)break;
 }
 return[...new Map(out.map(x=>[x.no,x])).values()];
}
async function fetchAllThemes(){
 let front:ThemeRow[]=[];try{front=await loadThemesFront();}catch{}
 if(front.length>=150)return front;
 let legacy:ThemeRow[]=[];try{legacy=await loadThemesLegacy();}catch{}
 const merged=[...new Map([...front,...legacy].map(x=>[x.no,x])).values()];
 if(merged.length<150)throw new Error(`네이버 전체 테마 수집이 충분하지 않습니다(${merged.length}개). 모바일 API와 PC 보조수집 모두 확인이 필요합니다.`);
 return merged;
}

function normalizeMember(x:any,theme:ThemeRow):StockRow|null{
 const raw=String(x?.itemCode??x?.stockCode??x?.code??'').replace(/\D/g,''),code=raw.match(/\d{6}/)?.[0]||'',name=clean(x?.stockName??x?.itemName??x?.name);if(!code||!name)return null;
 const reason=clean(x?.themeReason??x?.sectorReason??x?.description??x?.reason??x?.remark)||'네이버증권 해당 테마 구성종목';
 return{code,name,reason,market:marketName(x?.marketType??x?.stockExchangeType??x?.market??x?.category),marketCap:num(x?.marketValue??x?.marketCap??x?.marketValueAmount),themeNo:theme.no,themeName:theme.name,current:num(x?.closePrice??x?.currentPrice??x?.nowVal??x?.price)||null};
}
async function loadMembersFront(theme:ThemeRow){
 const out:StockRow[]=[];
 for(let page=1;page<=5;page++){
  const url=`https://m.stock.naver.com/front-api/domestic/sector/item/list?sectorCode=${encodeURIComponent(theme.no)}&sectorType=theme&sectorSortType=MARKET_VALUE&page=${page}&pageSize=100`,j=await fetchJson(url,10000),rows=pickArray(j,['stocks','items','result','data']);if(!rows.length)break;
  for(const x of rows){const s=normalizeMember(x,theme);if(s)out.push(s);}if(rows.length<100||j?.result?.hasNext===false)break;
 }
 return[...new Map(out.map(x=>[x.code,x])).values()];
}
async function legacyThemeInfo(theme:ThemeRow){
 const html=await fetchHtml(`https://finance.naver.com/sise/sise_group_detail.naver?type=theme&no=${theme.no}`,8000),$=cheerio.load(html),reasons=new Map<string,string>();
 $('a[href*="/item/main.naver?code="]').each((_,a)=>{const href=$(a).attr('href')||'',code=(href.match(/code=(\d{6})/)||[])[1],name=clean($(a).text());if(!code||!name)return;const tx=clean($(a).closest('tr').text());let reason=tx.replace(name,'').replace(/[+\-]?\d[\d,]*(?:\.\d+)?%?/g,' ').replace(/\s+/g,' ').trim();const p=reason.indexOf('테마 편입 사유');if(p>=0)reason=reason.slice(p+'테마 편입 사유'.length).trim();if(reason.length>320)reason=reason.slice(0,320)+'…';if(reason)reasons.set(code,reason);});
 const body=clean($('body').text()),marker=`${theme.name} 테마 개요`,idx=body.indexOf(marker);let overview='';if(idx>=0)overview=body.slice(idx+marker.length,idx+marker.length+520).split('항목 선택표')[0].trim();return{reasons,overview};
}
async function loadThemeDetail(theme:ThemeRow){
 let stocks:StockRow[]=[];try{stocks=await loadMembersFront(theme);}catch{}
 let overview='';try{const z=await legacyThemeInfo(theme);overview=z.overview;for(const s of stocks){const r=z.reasons.get(s.code);if(r)s.reason=r;}}catch{}
 if(!stocks.length)throw new Error(`테마 구성종목 수집 실패: ${theme.name}`);
 return{...theme,overview,stocks};
}

function decodeXml(s:string){return s.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]+>/g,'').trim();}
function rssItems(xml:string){const arr:any[]=[];const re=/<item>([\s\S]*?)<\/item>/g;let m;while((m=re.exec(xml))&&arr.length<10){const b=m[1],get=(t:string)=>{const x=b.match(new RegExp(`<${t}>([\\s\\S]*?)<\\/${t}>`));return x?decodeXml(x[1]):''};arr.push({title:get('title'),link:get('link'),pubDate:get('pubDate')});}return arr;}
async function googleNews(themeName:string){
 const url=`https://news.google.com/rss/search?q=${encodeURIComponent(themeName+' 산업 주식 when:7d')}&hl=ko&gl=KR&ceid=KR:ko`,ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),5500);
 try{const r=await fetch(url,{signal:ctl.signal,cache:'no-store',headers:{'User-Agent':'Mozilla/5.0'}});if(!r.ok)throw new Error('news');const items=rssItems(await r.text()).slice(0,6),now=Date.now(),positive=['수주','투자','확대','성장','수출','승인','허가','양산','공급','지원','특화단지','MOU','협력','증설','흑자'],negative=['파산','상장폐지','적자 확대','수요 둔화','취소','제재','리콜'];let fresh=0,pos=0,neg=0;for(const it of items){const age=(now-new Date(it.pubDate).getTime())/86400000;fresh+=age<1?1.5:age<3?1:age<7?.6:.2;pos+=positive.filter(k=>it.title.includes(k)).length;neg+=negative.filter(k=>it.title.includes(k)).length;}return{score:clamp(38+items.length*6+fresh*2.1+pos*2.2-neg*4,28,100),items};}finally{clearTimeout(timer);}
}

async function snapshot(code:string,lookback:number){
 const count=Math.max(140,Math.ceil(lookback*1.7)+30),r=await fetchRaw(`https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(code)}&timeframe=day&count=${count}&requestType=0`,10000,'text/xml,text/plain,*/*'),xml=await r.text(),rows:{date:string;high:number;close:number}[]=[];
 for(const m of xml.matchAll(/<item\s+data=["']([^"']+)["']/g)){const [date,o,h,l,c]=m[1].split('|'),high=Number(h),close=Number(c);if(/^\d{8}$/.test(date)&&Number.isFinite(high)&&Number.isFinite(close)&&close>0)rows.push({date,high,close});}
 rows.sort((a,b)=>a.date.localeCompare(b.date));const x=rows.slice(-lookback);if(x.length<20)return null;const current=x[x.length-1].close,high=Math.max(...x.map(z=>z.high)),alienation=clamp(current/high*100,1,120),c20=x.length>20?x[x.length-21].close:x[0].close,momentum20=c20?(current/c20-1)*100:0;return{current,high,alienation,drawdown:100-alienation,momentum20};
}
function reasonScore(reason:string){const good=['수주','공급','양산','점유율','독점','글로벌','삼성전자','SK하이닉스','현대','한화','정부','FDA','승인','국산화','개발','생산','고객사'];let v=42+Math.min(16,clean(reason).length/20);v+=good.filter(k=>reason.includes(k)).length*3;return clamp(v,35,95);}
function capScores(stocks:StockRow[]){const vals=stocks.map(s=>s.marketCap).filter(v=>v>0).map(Math.log10),lo=vals.length?Math.min(...vals):0,hi=vals.length?Math.max(...vals):1;for(const s of stocks)s.capScore=s.marketCap>0?(hi===lo?70:clamp(40+(Math.log10(s.marketCap)-lo)/(hi-lo)*55,35,95)):38;}

export async function runThemeRotationAnalysis(lookback=240){
 lookback=clamp(Math.round(lookback),60,240);
 const allThemes=await fetchAllThemes();
 const newsCandidates=[...allThemes].sort((a,b)=>b.firstPass-a.firstPass).slice(0,50),newsResults=await mapLimit(newsCandidates,10,async t=>{try{return await googleNews(t.name);}catch{return{score:48,items:[]};}}),newsMap=new Map(newsCandidates.map((t,i)=>[t.no,newsResults[i]]));
 for(const t of allThemes){const n=newsMap.get(t.no);if(n){t.newsScore=n.score;t.newsItems=n.items;t.outlook=clamp(t.firstPass*.72+n.score*.28);}else{t.newsScore=48;t.outlook=clamp(t.firstPass*.92+48*.08);}}
 allThemes.sort((a,b)=>b.outlook-a.outlook);allThemes.forEach((t,i)=>t.rank=i+1);
 const top30=allThemes.slice(0,30),detailed=await mapLimit(top30,10,async t=>{try{return await loadThemeDetail(t);}catch{return{...t,overview:'',stocks:[] as StockRow[]};}});
 const repMap=new Map<string,StockRow>();for(const t of detailed){const reps=[...(t.stocks||[])].sort((a,b)=>(b.marketCap||0)-(a.marketCap||0)).slice(0,2);for(const s of reps)repMap.set(s.code,s);}
 const repSnaps=await mapLimit([...repMap.values()],12,async s=>{try{return{code:s.code,snap:await snapshot(s.code,lookback)};}catch{return{code:s.code,snap:null};}}),snapMap=new Map(repSnaps.map(x=>[x.code,x.snap]));
 for(const t of detailed){const reps=[...(t.stocks||[])].sort((a,b)=>(b.marketCap||0)-(a.marketCap||0)).slice(0,2),snaps=reps.map(s=>snapMap.get(s.code)).filter(Boolean) as any[],alien=median(snaps.map(s=>s.alienation)),mom=median(snaps.map(s=>s.momentum20));t.alienation=alien;t.drawdown=alien===null?null:100-alien;t.momentum20=mom;t.rebound=clamp(50+(mom||0)*2,20,95);const heat=Math.max(0,t.dayPct-5)*1.6+Math.max(0,t.threeDayPct-3)*1.2;t.opportunity=clamp(t.outlook*.55+(t.drawdown||0)*.30+(t.rebound||50)*.10+t.breadth*.05-heat);}
 const selected5=[...detailed].filter(t=>Number.isFinite(Number(t.alienation))).sort((a,b)=>(a.alienation??999)-(b.alienation??999)||b.outlook-a.outlook).slice(0,5);
 const candidateMap=new Map<string,StockRow>();for(const t of selected5){for(const s of (t.stocks||[]).slice(0,10)){if(!candidateMap.has(s.code))candidateMap.set(s.code,{...s});}}
 const candidates=[...candidateMap.values()],missing=candidates.filter(s=>!snapMap.has(s.code));const extra=await mapLimit(missing,12,async s=>{try{return{code:s.code,snap:await snapshot(s.code,lookback)};}catch{return{code:s.code,snap:null};}});for(const x of extra)snapMap.set(x.code,x.snap);
 capScores(candidates);
 for(const s of candidates){const z:any=snapMap.get(s.code);if(z){s.current=z.current;s.high=z.high;s.alienation=z.alienation;s.drawdown=z.drawdown;s.momentum20=z.momentum20;}s.reasonScore=reasonScore(s.reason||'');s.priceScore=s.drawdown==null?45:clamp(92-Math.abs(s.drawdown-30)*1.45,35,95);s.reboundScore=clamp(50+(s.momentum20||0)*2,20,95);s.qualityScore=clamp((s.capScore||40)*.28+(s.reasonScore||45)*.26+(s.priceScore||45)*.28+(s.reboundScore||50)*.18);s.tier=(s.qualityScore||0)>=78?'핵심':(s.qualityScore||0)>=65?'도전자':'다크호스';}
 const byTheme=new Map<string,StockRow[]>();for(const s of candidates){const a=byTheme.get(s.themeNo||'')||[];a.push(s);byTheme.set(s.themeNo||'',a);}
 const chosen:StockRow[]=[],chosenCodes=new Set<string>();for(const t of selected5){const ranked=(byTheme.get(t.no)||[]).sort((a,b)=>(b.qualityScore||0)-(a.qualityScore||0));for(const s of ranked){if(chosen.filter(x=>x.themeNo===t.no).length>=4)break;if(chosenCodes.has(s.code))continue;chosen.push(s);chosenCodes.add(s.code);}}
 const leftovers=candidates.filter(s=>!chosenCodes.has(s.code)).sort((a,b)=>(b.qualityScore||0)-(a.qualityScore||0));for(const s of leftovers){if(chosen.length>=20)break;chosen.push(s);chosenCodes.add(s.code);}
 const detailMap=new Map(detailed.map(t=>[t.no,t]));for(const t of allThemes){const d=detailMap.get(t.no);if(d){t.alienation=d.alienation;t.drawdown=d.drawdown;t.momentum20=d.momentum20;t.opportunity=d.opportunity;}}
 const selectedNos=new Set(selected5.map(t=>t.no));
 return{ok:true,asOf:new Date().toISOString(),lookback,totalThemeCount:allThemes.length,method:{topOutlook:30,selectedAlienated:5,finalStocks:20,newsEnriched:newsCandidates.length,source:'Naver mobile front-api first / PC HTML fallback'},top30:detailed.map(t=>({...t,selected:selectedNos.has(t.no)})),selected5:selected5.map((t,i)=>({...t,alienationRank:i+1})),final20:chosen.slice(0,20).map((s,i)=>({...s,rank:i+1})),allThemes};
}

export const getDailyThemeRotationAnalysis=unstable_cache(async()=>runThemeRotationAnalysis(240),['naver-theme-rotation-daily-v4'],{revalidate:60*60*20,tags:['naver-theme-rotation-daily-v4']});
