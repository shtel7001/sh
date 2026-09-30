import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { unstable_cache } from 'next/cache';
import { fetchUniverse } from '@/lib/market';

const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n));
const median=(a:number[])=>{const x=a.filter(Number.isFinite).sort((p,q)=>p-q);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2;};
const num=(s:any)=>{const n=Number(String(s??'').replace(/[,+%원\s]/g,''));return Number.isFinite(n)?n:0;};
const clean=(s:string)=>String(s||'').replace(/\s+/g,' ').trim();

export type ThemeRow={no:string;name:string;dayPct:number;threeDayPct:number;up:number;flat:number;down:number;leaders:string[];structural:number;policy:number;global:number;market:number;breadth:number;firstPass:number;newsScore:number;newsItems:any[];outlook:number;overview?:string;stocks?:StockRow[];alienation?:number|null;drawdown?:number|null;momentum20?:number|null;rebound?:number;opportunity?:number;selected?:boolean};
export type StockRow={code:string;name:string;reason:string;market:'KOSPI'|'KOSDAQ'|null;marketCap:number;themeNo?:string;themeName?:string;alienation?:number|null;drawdown?:number|null;momentum20?:number|null;current?:number|null;high?:number|null;capScore?:number;reasonScore?:number;priceScore?:number;reboundScore?:number;qualityScore?:number;tier?:string};

type KeywordBand={score:number;words:string[]};
const structuralBands:KeywordBand[]=[
 {score:98,words:['HBM','고대역폭','AI 반도체','시스템반도체','반도체 장비','반도체 재료','유리 기판','CXL','뉴로모픽','온디바이스 AI','소캠','SOCAMM']},
 {score:97,words:['로봇','피지컬AI','스마트팩토리','스마트공장','자동화']},
 {score:96,words:['전력설비','전선','변압기','전력저장','ESS','원자력','SMR','핵융합','SOFC','냉각시스템']},
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
 {score:99,words:['AI','HBM','반도체','로봇','우주','스페이스X','방위산업','원자력','SMR','전력설비','전선','조선','LNG','2차전지','바이오','의료AI','사이버','5G','6G']},
 {score:92,words:['PCB','OLED','MLCC','카메라모듈','희토류','수소','풍력','태양광','자동차']},
 {score:80,words:['게임','콘텐츠','화장품','식품','엔터테인먼트']},
 {score:58,words:['지역화폐','정치','인맥']}
];

function bandScore(name:string,bands:KeywordBand[],base:number){for(const b of bands){if(b.words.some(w=>name.includes(w)))return b.score;}return base;}
function semanticScores(name:string){
  const structural=bandScore(name,structuralBands,62),policy=bandScore(name,policyBands,58),global=bandScore(name,globalBands,64);
  return{structural,policy,global};
}

async function fetchHtmlEuckr(url:string,revalidate=1200){
  const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),8000);
  try{
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36','Accept-Language':'ko-KR,ko;q=0.9','Referer':'https://finance.naver.com/'},signal:ctl.signal,next:{revalidate}} as RequestInit & {next:{revalidate:number}});
    if(!r.ok)throw new Error(`Naver HTTP ${r.status}`);
    const b=Buffer.from(await r.arrayBuffer()); const ct=(r.headers.get('content-type')||'').toLowerCase();
    return ct.includes('utf-8')?b.toString('utf8'):iconv.decode(b,'EUC-KR');
  }finally{clearTimeout(timer);}
}

async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T,i:number)=>Promise<R>):Promise<R[]>{
  const out=new Array<R>(items.length); let cursor=0;
  async function worker(){while(true){const i=cursor++;if(i>=items.length)return;out[i]=await fn(items[i],i);}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker())); return out;
}

function parseListPage(html:string){
  const $=cheerio.load(html); const out:ThemeRow[]=[]; const seen=new Set<string>();
  $('a[href*="sise_group_detail.naver"]').each((_,a)=>{
    const href=$(a).attr('href')||''; if(!href.includes('type=theme'))return;
    const no=(href.match(/[?&]no=(\d+)/)||[])[1]; const name=clean($(a).text()); if(!no||!name||seen.has(no))return;
    const tr=$(a).closest('tr'); const cells=tr.find('td').map((_,td)=>clean($(td).text())).get();
    if(cells.length<3)return; seen.add(no);
    const leaders=tr.find('a[href*="/item/main.naver?code="]').map((_,x)=>clean($(x).text())).get().filter(Boolean).slice(0,2);
    const dayPct=num(cells[1]),threeDayPct=num(cells[2]); const up=num(cells[3]),flat=num(cells[4]),down=num(cells[5]);
    const total=Math.max(1,up+flat+down),breadth=clamp(35+(up/total)*55-(down/total)*20,20,95);
    const market=clamp(50+dayPct*2.2+threeDayPct*4,20,100); const sem=semanticScores(name);
    const firstPass=clamp(sem.structural*.38+sem.policy*.18+sem.global*.18+market*.16+breadth*.10);
    out.push({no,name,dayPct,threeDayPct,up,flat,down,leaders,...sem,market,breadth,firstPass,newsScore:50,newsItems:[],outlook:firstPass});
  });
  return out;
}

async function fetchAllThemes(){
  const pages=await mapLimit([1,2,3,4,5,6,7],4,async p=>parseListPage(await fetchHtmlEuckr(`https://finance.naver.com/sise/theme.naver?page=${p}`,900)));
  return [...new Map(pages.flat().map(t=>[t.no,t])).values()];
}

function decodeXml(s:string){return s.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]+>/g,'').trim();}
function rssItems(xml:string){const arr:any[]=[];const re=/<item>([\s\S]*?)<\/item>/g;let m;while((m=re.exec(xml))&&arr.length<10){const b=m[1],get=(t:string)=>{const x=b.match(new RegExp(`<${t}>([\\s\\S]*?)<\\/${t}>`));return x?decodeXml(x[1]):''};arr.push({title:get('title'),link:get('link'),pubDate:get('pubDate')});}return arr;}
async function googleNews(themeName:string){
  const q=encodeURIComponent(`${themeName} 산업 주식 when:7d`),url=`https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;
  const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),6000);
  try{
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:ctl.signal,next:{revalidate:1800}} as RequestInit & {next:{revalidate:number}});if(!r.ok)throw new Error('news');
    const items=rssItems(await r.text()).slice(0,6),now=Date.now();
    const positive=['수주','투자','확대','성장','수출','승인','허가','양산','공급','지원','특화단지','MOU','협력','증설','흑자','신기록'];
    const negative=['파산','상장폐지','적자 확대','수요 둔화','취소','제재','리콜','수사'];
    let fresh=0,pos=0,neg=0; for(const it of items){const age=(now-new Date(it.pubDate).getTime())/86400000;fresh+=age<1?1.5:age<3?1.0:age<7?.6:.2;pos+=positive.filter(k=>it.title.includes(k)).length;neg+=negative.filter(k=>it.title.includes(k)).length;}
    return{score:clamp(38+items.length*6+fresh*2.1+pos*2.2-neg*4,28,100),items};
  }finally{clearTimeout(timer);}
}

async function fetchThemeDetail(t:ThemeRow,capMap:Map<string,{market:'KOSPI'|'KOSDAQ';marketCap:number}>){
  const html=await fetchHtmlEuckr(`https://finance.naver.com/sise/sise_group_detail.naver?type=theme&no=${t.no}`,1800); const $=cheerio.load(html);
  const stocks:StockRow[]=[]; const seen=new Set<string>();
  $('a[href*="/item/main.naver?code="]').each((_,a)=>{
    const href=$(a).attr('href')||'',code=(href.match(/code=(\d{6})/)||[])[1],name=clean($(a).text()); if(!code||!name||seen.has(code))return;seen.add(code);
    const tr=$(a).closest('tr'); let reason=clean(tr.find('.info_txt,.info_layer,.layer_section').text());
    if(!reason){const tx=clean(tr.text());reason=tx.replace(name,'').replace(/[+\-]?\d[\d,]*(?:\.\d+)?%?/g,' ').replace(/\s+/g,' ').trim();}
    if(reason.length>320)reason=reason.slice(0,320)+'…';
    const meta=capMap.get(code); stocks.push({code,name,reason,market:meta?.market||null,marketCap:meta?.marketCap||0,themeNo:t.no,themeName:t.name});
  });
  const body=clean($('body').text()),marker=`${t.name} 테마 개요`; const idx=body.indexOf(marker); let overview='';
  if(idx>=0)overview=body.slice(idx+marker.length,idx+marker.length+520).split('항목 선택표')[0].trim();
  return{...t,overview,stocks};
}

async function yahooOne(symbol:string,lookback:number){
  const p2=Math.floor(Date.now()/1000),p1=p2-Math.max(lookback+45,300)*86400,url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=history`;
  const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),5500);
  try{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:ctl.signal,next:{revalidate:1800}} as RequestInit & {next:{revalidate:number}});if(!r.ok)throw new Error('yahoo');const j=await r.json();const z=j?.chart?.result?.[0],q=z?.indicators?.quote?.[0]||{};const closes=(q.close||[]).filter(Number.isFinite).slice(-lookback),highs=(q.high||[]).filter(Number.isFinite).slice(-lookback);const current=z?.meta?.regularMarketPrice||closes.at(-1);if(!Number.isFinite(current)||!highs.length)throw new Error('price');const high=Math.max(...highs),alienation=clamp(current/high*100,1,120),c20=closes.length>20?closes[closes.length-21]:closes[0],momentum20=c20?(current/c20-1)*100:0;return{current,high,alienation,drawdown:100-alienation,momentum20};}finally{clearTimeout(timer);}
}
async function snapshot(code:string,market:'KOSPI'|'KOSDAQ'|null,lookback:number){
  const syms=market?[`${code}.${market==='KOSPI'?'KS':'KQ'}`]:[`${code}.KS`,`${code}.KQ`];
  for(const s of syms){try{return await yahooOne(s,lookback);}catch{}}
  return null;
}

function reasonScore(reason:string){const good=['수주','공급','양산','점유율','독점','글로벌','삼성전자','SK하이닉스','현대','한화','정부','FDA','승인','국산화','개발','생산','고객사'];let v=45+Math.min(15,reason.length/22);v+=good.filter(k=>reason.includes(k)).length*3;return clamp(v,35,95);}
function capScores(stocks:StockRow[]){const vals=stocks.map(s=>s.marketCap).filter(v=>v>0).map(Math.log10);const lo=vals.length?Math.min(...vals):0,hi=vals.length?Math.max(...vals):1;for(const s of stocks){s.capScore=s.marketCap>0?(hi===lo?70:clamp(40+(Math.log10(s.marketCap)-lo)/(hi-lo)*55,35,95)):35;}}

export async function runThemeRotationAnalysis(lookback=240){
  lookback=clamp(Math.round(lookback),60,240);
  const allThemes=await fetchAllThemes();
  if(allThemes.length<150)throw new Error(`네이버 전체 테마 수집이 충분하지 않습니다(${allThemes.length}개).`);

  const newsCandidates=[...allThemes].sort((a,b)=>b.firstPass-a.firstPass).slice(0,50);
  const newsResults=await mapLimit(newsCandidates,10,async t=>{try{return await googleNews(t.name);}catch{return{score:48,items:[]};}});
  const newsMap=new Map(newsCandidates.map((t,i)=>[t.no,newsResults[i]]));
  for(const t of allThemes){const n=newsMap.get(t.no);if(n){t.newsScore=n.score;t.newsItems=n.items;t.outlook=clamp(t.firstPass*.72+n.score*.28);}else{t.newsScore=48;t.outlook=clamp(t.firstPass*.92+48*.08);}}
  allThemes.sort((a,b)=>b.outlook-a.outlook);
  const top30=allThemes.slice(0,30);

  let capMap=new Map<string,{market:'KOSPI'|'KOSDAQ';marketCap:number}>();
  try{const u=await fetchUniverse();capMap=new Map(u.stocks.map(s=>[s.code,{market:s.market,marketCap:s.marketCap||0}]));}catch{}

  const detailed=await mapLimit(top30,8,async t=>{try{return await fetchThemeDetail(t,capMap);}catch{return{...t,overview:'',stocks:[] as StockRow[]};}});
  const repKeys=new Map<string,StockRow>();
  for(const t of detailed){const reps=[...(t.stocks||[])].sort((a,b)=>(b.marketCap||0)-(a.marketCap||0)).slice(0,2);for(const s of reps)repKeys.set(s.code,s);}
  const repList=[...repKeys.values()]; const repSnaps=await mapLimit(repList,10,async s=>({code:s.code,snap:await snapshot(s.code,s.market,lookback)})); const snapMap=new Map(repSnaps.map(x=>[x.code,x.snap]));

  for(const t of detailed){const reps=[...(t.stocks||[])].sort((a,b)=>(b.marketCap||0)-(a.marketCap||0)).slice(0,2),snaps=reps.map(s=>snapMap.get(s.code)).filter(Boolean) as any[];const alien=median(snaps.map(s=>s.alienation)),mom=median(snaps.map(s=>s.momentum20));t.alienation=alien;t.drawdown=alien===null?null:100-alien;t.momentum20=mom;t.rebound=clamp(50+(mom||0)*2,20,95);const heat=Math.max(0,t.dayPct-5)*1.6+Math.max(0,t.threeDayPct-3)*1.2;t.opportunity=clamp(t.outlook*.55+(t.drawdown||0)*.30+(t.rebound||50)*.10+t.breadth*.05-heat);}

  const selected5=[...detailed].filter(t=>Number.isFinite(t.alienation as number)).sort((a,b)=>(a.alienation as number)-(b.alienation as number)).slice(0,5); selected5.forEach(t=>t.selected=true);
  const candidateByTheme=new Map<string,StockRow[]>(); const candidateUnique=new Map<string,StockRow>();
  for(const t of selected5){const arr=[...(t.stocks||[])].sort((a,b)=>(b.marketCap||0)-(a.marketCap||0)).slice(0,8).map(s=>({...s,themeNo:t.no,themeName:t.name}));candidateByTheme.set(t.no,arr);for(const s of arr)candidateUnique.set(s.code,s);}
  const stockList=[...candidateUnique.values()]; const stockSnaps=await mapLimit(stockList,10,async s=>({code:s.code,snap:snapMap.get(s.code)||await snapshot(s.code,s.market,lookback)})); const stockSnapMap=new Map(stockSnaps.map(x=>[x.code,x.snap]));
  capScores(stockList);
  for(const s of stockList){const z=stockSnapMap.get(s.code) as any;s.current=z?.current??null;s.high=z?.high??null;s.alienation=z?.alienation??null;s.drawdown=z?.drawdown??null;s.momentum20=z?.momentum20??null;s.reasonScore=reasonScore(s.reason);s.priceScore=s.alienation==null?38:clamp((100-s.alienation)*1.55,25,92);s.reboundScore=s.momentum20==null?45:clamp(50+s.momentum20*1.8-(s.momentum20>22?(s.momentum20-22)*2:0),20,92);s.qualityScore=clamp((s.capScore||35)*.45+(s.reasonScore||45)*.20+(s.priceScore||38)*.20+(s.reboundScore||45)*.15);s.tier=(s.capScore||0)>=78?'핵심':(s.capScore||0)>=58?'도전자':'다크호스';}

  const chosen:StockRow[]=[]; const chosenCodes=new Set<string>();
  for(const t of selected5){const ranked=(candidateByTheme.get(t.no)||[]).map(x=>stockList.find(s=>s.code===x.code)!).filter(Boolean).sort((a,b)=>(b.qualityScore||0)-(a.qualityScore||0));for(const s of ranked){if(chosen.filter(x=>x.themeNo===t.no).length>=4)break;if(chosenCodes.has(s.code))continue;chosen.push(s);chosenCodes.add(s.code);}}
  const leftovers=stockList.filter(s=>!chosenCodes.has(s.code)).sort((a,b)=>(b.qualityScore||0)-(a.qualityScore||0));for(const s of leftovers){if(chosen.length>=20)break;chosen.push(s);chosenCodes.add(s.code);}

  detailed.sort((a,b)=>b.outlook-a.outlook);
  const selectedNos=new Set(selected5.map(t=>t.no));
  return{ok:true,asOf:new Date().toISOString(),lookback,totalThemeCount:allThemes.length,method:{topOutlook:30,selectedAlienated:5,finalStocks:20,newsEnriched:newsCandidates.length},top30:detailed.map((t,i)=>({...t,rank:i+1,selected:selectedNos.has(t.no)})),selected5:selected5.map((t,i)=>({...t,alienationRank:i+1})),final20:chosen.slice(0,20).map((s,i)=>({...s,rank:i+1})),allThemes:allThemes.map((t,i)=>({...t,rank:i+1}))};
}

export const getDailyThemeRotationAnalysis=unstable_cache(async()=>runThemeRotationAnalysis(240),['naver-theme-rotation-daily-v3'],{revalidate:60*60*20,tags:['naver-theme-rotation-daily-v3']});
