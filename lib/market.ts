import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export type UniverseStock = { name:string; code:string; market:'KOSPI'|'KOSDAQ'; rank?:number; currentPrice:number|null; changePct:number|null; marketCap:number|null; sector:string|null; theme:string|null };
export type Bar = { date:string; open:number; high:number; low:number; close:number; volume:number };

function num(s:unknown){
  if(typeof s==='number') return Number.isFinite(s)?s:null;
  if(typeof s!=='string') return null;
  const n=Number(s.replace(/[,+%원\s]/g,'').trim());
  return Number.isFinite(n)?n:null;
}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function fetchWithTimeout(url:string, init:RequestInit={}, timeout=10000){
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),timeout);
  try{return await fetch(url,{...init,signal:ctl.signal});}
  finally{clearTimeout(timer);}
}

async function fetchJson(url:string,revalidate=900){
  let last='';
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetchWithTimeout(url,{headers:{
        'User-Agent':'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
        'Accept':'application/json, text/plain, */*','Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6','Referer':'https://m.stock.naver.com/'
      },next:{revalidate}} as RequestInit & {next:{revalidate:number}});
      if(!r.ok){last=`HTTP ${r.status}`;await sleep(200*(attempt+1));continue;}
      const text=await r.text();
      if(!text.trim().startsWith('{')&&!text.trim().startsWith('[')){last='JSON 아닌 응답';continue;}
      return JSON.parse(text);
    }catch(e){last=e instanceof Error?e.message:'fetch error';await sleep(200*(attempt+1));}
  }
  throw new Error(last||'JSON 수집 실패');
}

async function fetchHtmlEuckr(url:string,revalidate=1800){
  const r=await fetchWithTimeout(url,{headers:{
    'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6','Referer':'https://finance.naver.com/'
  },next:{revalidate}} as RequestInit & {next:{revalidate:number}});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  const b=Buffer.from(await r.arrayBuffer());
  const ct=(r.headers.get('content-type')||'').toLowerCase();
  return ct.includes('utf-8')?b.toString('utf8'):iconv.decode(b,'EUC-KR');
}

function pickArray(j:any):any[]{
  if(Array.isArray(j))return j;
  for(const k of ['stocks','result','items','stockList','data'])if(Array.isArray(j?.[k]))return j[k];
  if(Array.isArray(j?.result?.stocks))return j.result.stocks;
  if(Array.isArray(j?.result?.items))return j.result.items;
  return [];
}

function normalizeStock(x:any):UniverseStock|null{
  const code=String(x?.itemCode??x?.itemcode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||'';
  const name=String(x?.stockName??x?.name??x?.itemName??'').trim();
  if(!code||!name)return null;
  return {name,code,market:'KOSPI',currentPrice:num(x?.closePrice??x?.currentPrice??x?.nowVal??x?.price),changePct:num(x?.fluctuationsRatio??x?.changeRate??x?.changePct??x?.rate),marketCap:num(x?.marketValue??x?.marketCap??x?.marketValueAmount),sector:null,theme:null};
}

async function fetchAllKospiMobile(){
  const out:UniverseStock[]=[]; const seen=new Set<string>(); const pageSize=100;
  for(let page=1;page<=20;page++){
    const j=await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=${page}&pageSize=${pageSize}`,600);
    const rows=pickArray(j); if(!rows.length)break;
    let added=0;
    for(const x of rows){const s=normalizeStock(x);if(s&&!seen.has(s.code)){seen.add(s.code);out.push(s);added++;}}
    if(!added||rows.length<pageSize)break;
  }
  if(out.length<500)throw new Error(`mobile KOSPI ${out.length}건`);
  return out;
}

async function fetchAllKospiFront(){
  const out:UniverseStock[]=[]; const seen=new Set<string>(); const pageSize=100;
  for(let page=1;page<=20;page++){
    const j=await fetchJson(`https://m.stock.naver.com/front-api/stock/domestic/stockList?sortType=marketValue&category=KOSPI&page=${page}&pageSize=${pageSize}`,600);
    const rows=pickArray(j); if(!rows.length)break;
    let added=0;
    for(const x of rows){const s=normalizeStock(x);if(s&&!seen.has(s.code)){seen.add(s.code);out.push(s);added++;}}
    if(!added||rows.length<pageSize)break;
  }
  if(out.length<500)throw new Error(`front-api KOSPI ${out.length}건`);
  return out;
}

async function fetchAllKospiPc(){
  const out:UniverseStock[]=[]; const seen=new Set<string>();
  for(let page=1;page<=30;page++){
    const html=await fetchHtmlEuckr(`https://finance.naver.com/sise/sise_market_sum.naver?sosok=0&page=${page}`,600);
    const $=cheerio.load(html);let pageRows=0;
    $('table.type_2 tr,table.type2 tr').each((_,tr)=>{
      const a=$(tr).find('a.tltle,a[href*="/item/main.naver?code="]').first();if(!a.length)return;
      const name=a.text().trim(),href=a.attr('href')||'',code=(href.match(/code=(\d{6})/)||[])[1];if(!code||!name||seen.has(code))return;
      const cells=$(tr).find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
      seen.add(code);pageRows++;out.push({name,code,market:'KOSPI',currentPrice:num(cells[2]||''),changePct:num(cells[4]||''),marketCap:num(cells[6]||''),sector:null,theme:null});
    });
    if(pageRows===0)break;
  }
  if(out.length<500)throw new Error(`PC KOSPI ${out.length}건`);
  return out;
}

export async function fetchUniverse(){
  const errors:string[]=[];let stocks:UniverseStock[]=[];let source='';
  try{stocks=await fetchAllKospiMobile();source='naver-mobile-json';}
  catch(e1){errors.push(e1 instanceof Error?e1.message:'mobile 오류');
    try{stocks=await fetchAllKospiFront();source='naver-front-api';}
    catch(e2){errors.push(e2 instanceof Error?e2.message:'front 오류');stocks=await fetchAllKospiPc();source='naver-pc-html';}}
  const uniq=[...new Map(stocks.map(x=>[x.code,x])).values()].sort((a,b)=>(b.marketCap||0)-(a.marketCap||0)).map((x,i)=>({...x,rank:i+1}));
  if(!uniq.length)throw new Error(`KOSPI 전종목 수집 실패 · ${errors.join(' / ')}`);
  console.log('[universe-all-kospi]',{count:uniq.length,source,errors});
  return {stocks:uniq,errors,sources:[`${source}(${uniq.length})`]};
}

export function yahooSymbol(code:string,market:'KOSPI'|'KOSDAQ'='KOSPI'){return `${code}.${market==='KOSPI'?'KS':'KQ'}`;}

export async function fetchYahooBars(code:string,market:'KOSPI'|'KOSDAQ',days=420):Promise<Bar[]>{
  const symbol=yahooSymbol(code,market);
  const period1=Math.floor((Date.now()-Math.max(500,days*2.2)*86400000)/1000);
  const period2=Math.floor(Date.now()/1000)+86400;
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`;
  let last='';
  for(let attempt=0;attempt<3;attempt++){
    const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),8000);
    try{
      const r=await fetch(url,{signal:ctl.signal,headers:{'User-Agent':'Mozilla/5.0'},next:{revalidate:900}} as RequestInit & {next:{revalidate:number}});clearTimeout(t);
      if(!r.ok){last=`HTTP ${r.status}`;await sleep(250*(attempt+1));continue;}
      const j=await r.json();const z=j?.chart?.result?.[0];const ts:number[]=z?.timestamp||[];const q=z?.indicators?.quote?.[0]||{};
      const bars:Bar[]=ts.map((v,i)=>({date:new Date(v*1000).toISOString().slice(0,10),open:q.open?.[i],high:q.high?.[i],low:q.low?.[i],close:q.close?.[i],volume:q.volume?.[i]})).filter(x=>[x.open,x.high,x.low,x.close,x.volume].every(Number.isFinite));
      if(bars.length<20)throw new Error('가격 이력 부족');
      return bars;
    }catch(e){clearTimeout(t);last=e instanceof Error?e.message:'fetch error';await sleep(250*(attempt+1));}
  }
  throw new Error(last||'Yahoo Finance 수집 실패');
}

const themeRules:[RegExp,string][]=[
  [/HBM|반도체|DRAM|낸드|파운드리|웨이퍼|패키징|후공정/i,'반도체·HBM'],
  [/인공지능|\bAI\b|데이터센터|GPU|클라우드/i,'AI·데이터센터'],
  [/로봇|협동로봇|휴머노이드|스마트팩토리/i,'로봇'],
  [/2차전지|이차전지|배터리|리튬|양극재|음극재|전해질/i,'2차전지'],
  [/바이오|제약|신약|임상|의약|헬스케어/i,'바이오·제약'],
  [/방산|국방|미사일|레이더|항공우주|우주/i,'방산·우주'],
  [/원전|원자력|SMR|전력기기|변압기|송배전|전선/i,'원전·전력'],
  [/자동차|자율주행|ADAS|전장|모빌리티/i,'자동차·자율주행'],
  [/OLED|디스플레이|XR|AR|VR/i,'OLED·XR'],
  [/조선|선박|LNG선|해양플랜트/i,'조선'],
  [/건설|건축|토목|부동산/i,'건설'],
  [/게임|콘텐츠|엔터|웹툰|미디어/i,'게임·콘텐츠'],
  [/은행|증권|보험|금융|카드/i,'금융'],
  [/화장품|뷰티|면세/i,'화장품·뷰티'],
  [/식품|음료|유통|백화점|마트/i,'소비·유통']
];

export async function fetchCompanyProfile(code:string,name=''){
  try{
    const html=await fetchHtmlEuckr(`https://finance.naver.com/item/main.naver?code=${code}`,3600);const $=cheerio.load(html);
    const sector=$('a[href*="sise_group_detail.naver?type=upjong"]').first().text().replace(/\s+/g,' ').trim()||null;
    const summary=[$('.summary_info').text(),$('#summary_info').text(),$('.wrap_company').nextAll().slice(0,4).text()].join(' ').replace(/\s+/g,' ').trim();
    const hay=`${name} ${sector||''} ${summary}`;const themes:string[]=[];
    for(const [re,label] of themeRules)if(re.test(hay)&&!themes.includes(label))themes.push(label);
    if(!themes.length&&sector)themes.push(sector);
    return {code,sector,theme:themes.slice(0,3).join(' · ')||'기타'};
  }catch(e){return {code,sector:null,theme:'기타',error:e instanceof Error?e.message:'기업정보 수집 실패'};}
}

export async function fetchInvestorFlow(code:string){
  try{
    const html=await fetchHtmlEuckr(`https://finance.naver.com/item/frgn.naver?code=${code}`,900);const $=cheerio.load(html);const rows:{date:string;inst:number;foreign:number}[]=[];
    $('table.type2 tr').each((_,tr)=>{const tds=$(tr).find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();if(tds.length<7||!/^\d{4}\.\d{2}\.\d{2}/.test(tds[0]||''))return;const inst=num(tds[5]||''),foreign=num(tds[6]||'');if(inst!==null&&foreign!==null)rows.push({date:tds[0],inst,foreign});});
    return rows.slice(0,10);
  }catch{return null;}
}
