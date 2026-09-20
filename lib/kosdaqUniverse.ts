import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

export type KosdaqStock = {
  name:string;
  code:string;
  market:'KOSDAQ';
  rank?:number;
  currentPrice:number|null;
  changePct:number|null;
  marketCap:number|null;
  sector:string|null;
  theme:string|null;
};

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function num(s:unknown){
  if(typeof s==='number')return Number.isFinite(s)?s:null;
  if(typeof s!=='string')return null;
  const n=Number(s.replace(/[,+%원\s]/g,'').trim());
  return Number.isFinite(n)?n:null;
}
async function fetchWithTimeout(url:string,init:RequestInit={},timeout=10000){
  const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),timeout);
  try{return await fetch(url,{...init,signal:ctl.signal});}finally{clearTimeout(timer);}
}
async function fetchJson(url:string){
  let last='';
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetchWithTimeout(url,{cache:'no-store',headers:{
        'User-Agent':'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
        'Accept':'application/json, text/plain, */*','Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6','Referer':'https://m.stock.naver.com/'
      }});
      if(!r.ok){last=`HTTP ${r.status}`;await sleep(180*(attempt+1));continue;}
      const text=await r.text();if(!text.trim().startsWith('{')&&!text.trim().startsWith('[')){last='JSON 아닌 응답';continue;}
      return JSON.parse(text);
    }catch(e){last=e instanceof Error?e.message:'fetch error';await sleep(180*(attempt+1));}
  }
  throw new Error(last||'JSON 수집 실패');
}
async function fetchHtmlEuckr(url:string){
  const r=await fetchWithTimeout(url,{cache:'no-store',headers:{
    'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6','Referer':'https://finance.naver.com/'
  }});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  const b=Buffer.from(await r.arrayBuffer());const ct=(r.headers.get('content-type')||'').toLowerCase();
  return ct.includes('utf-8')?b.toString('utf8'):iconv.decode(b,'EUC-KR');
}
function pickArray(j:any):any[]{
  if(Array.isArray(j))return j;
  for(const k of ['stocks','result','items','stockList','data'])if(Array.isArray(j?.[k]))return j[k];
  if(Array.isArray(j?.result?.stocks))return j.result.stocks;
  if(Array.isArray(j?.result?.items))return j.result.items;
  return [];
}
function normalize(x:any):KosdaqStock|null{
  const code=String(x?.itemCode??x?.itemcode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||'';
  const name=String(x?.stockName??x?.name??x?.itemName??'').trim();
  if(!code||!name)return null;
  return {name,code,market:'KOSDAQ',currentPrice:num(x?.closePrice??x?.currentPrice??x?.nowVal??x?.price),changePct:num(x?.fluctuationsRatio??x?.changeRate??x?.changePct??x?.rate),marketCap:num(x?.marketValue??x?.marketCap??x?.marketValueAmount),sector:null,theme:null};
}
async function fromMobile(){
  const out:KosdaqStock[]=[];const seen=new Set<string>();const pageSize=100;
  for(let page=1;page<=30;page++){
    const rows=pickArray(await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/KOSDAQ?page=${page}&pageSize=${pageSize}&_=${Date.now()}`));
    if(!rows.length)break;let added=0;
    for(const x of rows){const s=normalize(x);if(s&&!seen.has(s.code)){seen.add(s.code);out.push(s);added++;}}
    if(!added||rows.length<pageSize)break;
  }
  if(out.length<1000)throw new Error(`mobile KOSDAQ ${out.length}건`);
  return out;
}
async function fromFront(){
  const out:KosdaqStock[]=[];const seen=new Set<string>();const pageSize=100;
  for(let page=1;page<=30;page++){
    const rows=pickArray(await fetchJson(`https://m.stock.naver.com/front-api/stock/domestic/stockList?sortType=marketValue&category=KOSDAQ&page=${page}&pageSize=${pageSize}`));
    if(!rows.length)break;let added=0;
    for(const x of rows){const s=normalize(x);if(s&&!seen.has(s.code)){seen.add(s.code);out.push(s);added++;}}
    if(!added||rows.length<pageSize)break;
  }
  if(out.length<1000)throw new Error(`front-api KOSDAQ ${out.length}건`);
  return out;
}
async function fromPc(){
  const out:KosdaqStock[]=[];const seen=new Set<string>();
  for(let page=1;page<=45;page++){
    const html=await fetchHtmlEuckr(`https://finance.naver.com/sise/sise_market_sum.naver?sosok=1&page=${page}`);const $=cheerio.load(html);let count=0;
    $('table.type_2 tr,table.type2 tr').each((_,tr)=>{
      const a=$(tr).find('a.tltle,a[href*="/item/main.naver?code="]').first();if(!a.length)return;
      const name=a.text().trim(),href=a.attr('href')||'',code=(href.match(/code=(\d{6})/)||[])[1];if(!code||!name||seen.has(code))return;
      const cells=$(tr).find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get();
      seen.add(code);count++;out.push({name,code,market:'KOSDAQ',currentPrice:num(cells[2]||''),changePct:num(cells[4]||''),marketCap:num(cells[6]||''),sector:null,theme:null});
    });
    if(!count)break;
  }
  if(out.length<1000)throw new Error(`PC KOSDAQ ${out.length}건`);
  return out;
}
export async function fetchKosdaqUniverse(){
  const errors:string[]=[];let stocks:KosdaqStock[]=[];let source='';
  try{stocks=await fromMobile();source='naver-mobile-json';}
  catch(e1){errors.push(e1 instanceof Error?e1.message:'mobile 오류');
    try{stocks=await fromFront();source='naver-front-api';}
    catch(e2){errors.push(e2 instanceof Error?e2.message:'front 오류');stocks=await fromPc();source='naver-pc-html';}}
  const uniq=[...new Map(stocks.map(x=>[x.code,x])).values()].sort((a,b)=>(b.marketCap||0)-(a.marketCap||0)).map((x,i)=>({...x,rank:i+1}));
  if(!uniq.length)throw new Error(`KOSDAQ 전종목 수집 실패 · ${errors.join(' / ')}`);
  console.log('[universe-all-kosdaq]',{count:uniq.length,source,errors});
  return {stocks:uniq,errors,sources:[`${source}(${uniq.length})`]};
}
