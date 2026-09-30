// @ts-nocheck
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const UA='Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const cache=new Map<string,{time:number,data:any[]}>();
const TTL=60*60*1000;
function json(data:any,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}})}
function n(v:any){if(typeof v==='number')return Number.isFinite(v)?v:null;if(v==null)return null;const x=Number(String(v).replace(/[,+%원주\s]/g,''));return Number.isFinite(x)?x:null}
async function authorize(req:Request){const token=req.headers.get('x-auth-token')||'';if(!token)return false;try{const u=new URL('/api/dead-golden-6020?op=auth',req.url);const r=await fetch(u,{headers:{'x-auth-token':token},cache:'no-store'});if(!r.ok)return false;const j=await r.json().catch(()=>({}));return !!j?.ok}catch{return false}}
async function fetchJson(url:string,timeout=9000){let last='';for(let i=0;i<2;i++){const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),timeout);try{const r=await fetch(url,{signal:ctl.signal,cache:'no-store',headers:{'User-Agent':UA,'Accept':'application/json,text/plain,*/*','Accept-Language':'ko-KR,ko;q=0.9,en;q=0.6','Referer':'https://m.stock.naver.com/'}});if(!r.ok){last=`HTTP ${r.status}`;await sleep(180*(i+1));continue}return JSON.parse(await r.text())}catch(e:any){last=String(e?.message||e);await sleep(180*(i+1))}finally{clearTimeout(t)}}throw new Error(last||'FETCH_FAILED')}
function pickArray(j:any){if(Array.isArray(j))return j;for(const k of ['stocks','items','data','stockList','result','etfs','etns']){if(Array.isArray(j?.[k]))return j[k];if(Array.isArray(j?.result?.[k]))return j.result[k]}if(Array.isArray(j?.result))return j.result;return []}
function isSpac(name:string){return /(스팩|SPAC)/i.test(String(name||''))}
function isETNName(name:string){return /(^|[^A-Z])ETN([^A-Z]|$)|상장지수증권/i.test(String(name||''))}
function isLikelyETFName(name:string){const s=String(name||'').trim();return /^(KODEX|TIGER|ACE|RISE|SOL|HANARO|KOSEF|ARIRANG|PLUS|TIMEFOLIO|KBSTAR|KINDEX|WOORI|FOCUS|UNICORN|히어로즈|1Q|BNK|마이티|TREX|MASTER|SMART|파워|QV|HK|KIWOOM|DAISHIN|신한SOL|삼성KODEX)\b/i.test(s)}
function isOtherSecurityName(name:string){return /(상장지수펀드|투자회사|뮤추얼|선박투자|인프라펀드|수익증권)/i.test(String(name||''))}
function normStock(x:any,market:'KOSPI'|'KOSDAQ'){const code=String(x?.itemCode??x?.itemcode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||'',name=String(x?.stockName??x?.name??x?.itemName??'').trim();if(!code||!name)return null;return {code,name,market,price:n(x?.closePrice??x?.currentPrice??x?.price),marketValue:x?.marketValue??x?.marketCap??null}}
async function stockList(market:'KOSPI'|'KOSDAQ'){const key=`STOCK:${market}`,c=cache.get(key);if(c&&Date.now()-c.time<TTL)return c.data;const out:any[]=[],seen=new Set<string>();for(let page=1;page<=35;page++){const j=await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`),rows=pickArray(j);if(!rows.length)break;let add=0;for(const x of rows){const s=normStock(x,market);if(s&&!seen.has(s.code)){seen.add(s.code);out.push(s);add++}}if(!add||rows.length<100)break}cache.set(key,{time:Date.now(),data:out});return out}
function normETF(x:any){const code=String(x?.itemCode??x?.symbolCode??x?.code??'').match(/\d{6}/)?.[0]||'',name=String(x?.stockName??x?.name??x?.itemName??x?.stockNameKor??x?.stockNameEng??'').trim();if(!code||!name)return null;return {code,name,market:'KOSPI',instrumentType:'ETF',price:n(x?.currentPrice??x?.closePrice??x?.price),marketValue:x?.aum??x?.marketValue??null}}
async function etfList(){const key='ETF',c=cache.get(key);if(c&&Date.now()-c.time<TTL)return c.data;const out:any[]=[],seen=new Set<string>();try{for(let page=1;page<=30;page++){const j=await fetchJson(`https://m.stock.naver.com/front-api/domestic/etf/list?sortTypeCode=aum&page=${page}&pageSize=100`),rows=pickArray(j);if(!rows.length)break;for(const x of rows){const s=normETF(x);if(s&&!seen.has(s.code)){seen.add(s.code);out.push(s)}}if(rows.length<100)break}if(out.length){cache.set(key,{time:Date.now(),data:out});return out}}catch{}for(let page=1;page<=30;page++){const j=await fetchJson(`https://api.stock.naver.com/etf/priceTop?page=${page}&pageSize=100`),rows=pickArray(j);if(!rows.length)break;for(const x of rows){const s=normETF(x);if(s&&!seen.has(s.code)){seen.add(s.code);out.push(s)}}if(rows.length<100)break}cache.set(key,{time:Date.now(),data:out});return out}
function normETN(x:any){const code=String(x?.itemCode??x?.symbolCode??x?.code??'').match(/\d{6}/)?.[0]||'',name=String(x?.stockName??x?.name??x?.itemName??x?.stockNameKor??x?.stockNameEng??'').trim();if(!code||!name)return null;return {code,name,market:'KOSPI',instrumentType:'ETN',price:n(x?.currentPrice??x?.closePrice??x?.price),marketValue:x?.marketValue??null}}
async function etnList(){const key='ETN',c=cache.get(key);if(c&&Date.now()-c.time<TTL)return c.data;const out:any[]=[],seen=new Set<string>();for(let page=1;page<=30;page++){let j:any;try{j=await fetchJson(`https://api.stock.naver.com/etn/priceTop?page=${page}&pageSize=100`)}catch{break}const rows=pickArray(j);if(!rows.length)break;for(const x of rows){const s=normETN(x);if(s&&!seen.has(s.code)){seen.add(s.code);out.push(s)}}if(rows.length<100)break}cache.set(key,{time:Date.now(),data:out});return out}

export async function GET(req:Request){
  if(!await authorize(req))return json({error:'UNAUTHORIZED'},401);
  const u=new URL(req.url),market=String(u.searchParams.get('market')||'ALL').toUpperCase(),types=String(u.searchParams.get('types')||'STOCK').split(',').map(x=>x.trim().toUpperCase()).filter(x=>['STOCK','SPAC','ETF','ETN','OTHER'].includes(x));
  if(!types.length)return json({error:'NO_TYPES'},400);
  const want=new Set(types),warnings:string[]=[],rows:any[]=[];
  try{
    const [er,nr]=await Promise.allSettled([etfList(),etnList()]);
    const etfs=er.status==='fulfilled'?er.value:[],etns=nr.status==='fulfilled'?nr.value:[];
    if(er.status==='rejected')warnings.push(`ETF 분류목록 오류: ${String(er.reason?.message||er.reason)}`);
    if(nr.status==='rejected')warnings.push(`ETN 분류목록 오류: ${String(nr.reason?.message||nr.reason)}`);
    const etfCodes=new Set(etfs.map(x=>x.code)),etnCodes=new Set(etns.map(x=>x.code));
    if(want.has('STOCK')||want.has('SPAC')||want.has('OTHER')){
      let base:any[]=[];if(market==='ALL'||market==='KOSPI')base.push(...await stockList('KOSPI'));if(market==='ALL'||market==='KOSDAQ')base.push(...await stockList('KOSDAQ'));
      for(const s of base){let instrumentType='STOCK';if(etnCodes.has(s.code)||isETNName(s.name))instrumentType='ETN';else if(etfCodes.has(s.code)||isLikelyETFName(s.name))instrumentType='ETF';else if(isSpac(s.name))instrumentType='SPAC';else if(isOtherSecurityName(s.name))instrumentType='OTHER';if(want.has(instrumentType))rows.push({...s,instrumentType})}
    }
    if((market==='ALL'||market==='KOSPI')&&want.has('ETF'))rows.push(...etfs);
    if((market==='ALL'||market==='KOSPI')&&want.has('ETN')){if(!etns.length)warnings.push('ETN 전용 목록 응답이 없어 ETN은 이번 검색에서 제외되었습니다.');rows.push(...etns)}
    const uniq=[...new Map(rows.map(x=>[`${x.instrumentType}:${x.code}`,x])).values()];
    const counts:any={STOCK:0,SPAC:0,ETF:0,ETN:0,OTHER:0};uniq.forEach((x:any)=>counts[x.instrumentType]=(counts[x.instrumentType]||0)+1);
    return json({ok:true,stocks:uniq,count:uniq.length,counts,warnings});
  }catch(e:any){return json({ok:false,error:String(e?.message||e),warnings},502)}
}
