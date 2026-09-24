import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const NAVER = 'https://m.stock.naver.com/api/stocks/marketValue';
const PAGE_SIZE = 100;

function num(v){
  const n=Number(String(v??'').replace(/[^0-9.-]/g,''));
  return Number.isFinite(n)?n:null;
}
function marketValueToEok(v){
  const s=String(v??'').replace(/,/g,'').trim();
  if(!s) return null;
  let out=0, hit=false;
  const jo=s.match(/([0-9.]+)\s*조/); if(jo){out+=Number(jo[1])*10000;hit=true;}
  const eok=s.match(/([0-9.]+)\s*억/); if(eok){out+=Number(eok[1]);hit=true;}
  if(hit&&Number.isFinite(out)) return out;
  const raw=Number(s.replace(/[^0-9.-]/g,''));
  return Number.isFinite(raw)?raw:null;
}
async function getPage(market,page){
  const url=`${NAVER}/${market}?page=${page}&pageSize=${PAGE_SIZE}`;
  const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':UA,Accept:'application/json','Accept-Language':'ko-KR,ko;q=0.9,en;q=0.7',Referer:'https://m.stock.naver.com/'}});
  if(!r.ok) throw new Error(`Naver ${market} list HTTP ${r.status}`);
  const j=await r.json();
  if(!j||!Array.isArray(j.stocks)) throw new Error(`Naver ${market} list format changed`);
  return j;
}
async function buildMarket(market){
  const first=await getPage(market,1);
  const total=Math.max(first.stocks.length,Number(first.totalCount||0));
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const payloads=[first];
  for(let p=2;p<=pages;p+=8){
    const ps=[];
    for(let x=p;x<Math.min(p+8,pages+1);x++) ps.push(getPage(market,x));
    payloads.push(...await Promise.all(ps));
  }
  const label=market==='KOSDAQ'?'KOSDAQ':'KOSPI';
  const suffix=market==='KOSDAQ'?'KQ':'KS';
  const seen=new Set(), out=[];
  for(const j of payloads){
    for(const s of j.stocks||[]){
      const code=String(s.itemCode||s.stockCode||s.code||'').trim().toUpperCase();
      if(!code||seen.has(code)) continue;
      seen.add(code);
      const name=String(s.stockName||s.itemName||s.name||code).trim();
      const marketCapText=String(s.marketValue||s.marketCap||'').trim();
      out.push({
        rank:out.length+1,
        code,
        name,
        current:num(s.closePrice),
        marketCapText,
        marketCapEok:marketValueToEok(marketCapText),
        market:label,
        naver:code,
        yahoo:`${code}.${suffix}`
      });
    }
  }
  if(out.length<100) throw new Error(`${label} universe only ${out.length} rows`);
  return out;
}

export async function GET(req){
  try{
    const q=new URL(req.url).searchParams;
    const market=['kospi','kosdaq','all'].includes(q.get('market'))?q.get('market'):'kospi';
    const limit=Math.min(4000,Math.max(1,Number(q.get('limit')||4000)));
    let items;
    if(market==='all'){
      const [kospi,kosdaq]=await Promise.all([buildMarket('KOSPI'),buildMarket('KOSDAQ')]);
      items=[...kospi,...kosdaq].slice(0,limit);
    }else{
      items=(await buildMarket(market==='kosdaq'?'KOSDAQ':'KOSPI')).slice(0,limit);
    }
    return NextResponse.json({ok:true,source:'Naver Finance mobile marketValue API',market,count:items.length,items});
  }catch(e){
    return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500});
  }
}
