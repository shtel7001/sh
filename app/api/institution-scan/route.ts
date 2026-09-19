import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { isAuthed, unauthorized } from '@/lib/guard';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
type Market='kospi'|'kosdaq';
type FlowRow={date:string;close:number;rate:number;volume:number;inst:number;foreign:number};
type Stock={code:string;name:string};

function num(v:unknown){
  const cleaned=String(v??'').replace(/,/g,'').replace(/[^0-9+.-]/g,'');
  const x=Number(cleaned);
  return Number.isFinite(x)?x:0;
}
function clamp(v:number,min:number,max:number){return Math.max(min,Math.min(max,v));}
function sum<T>(a:T[],f:(x:T)=>number){return a.reduce((s,x)=>s+f(x),0);}
function sleep(ms:number){return new Promise(r=>setTimeout(r,ms));}
function ymd(v:unknown){
  const s=String(v??'').replace(/[^0-9]/g,'');
  return s.length===8?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:String(v??'').replace(/\./g,'-');
}

async function fetchWithRetry(url:string,init:RequestInit={},retries=2){
  let last:unknown;
  for(let attempt=0;attempt<=retries;attempt++){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),12000);
    try{
      const r=await fetch(url,{
        ...init,
        headers:{'user-agent':UA,'accept-language':'ko-KR,ko;q=0.9','accept':'application/json,text/plain,text/html,*/*',...(init.headers||{})},
        signal:ctrl.signal,cache:'no-store'
      });
      if(r.ok)return r;
      last=new Error(`HTTP ${r.status}`);
    }catch(e){last=e;}finally{clearTimeout(timer);}
    if(attempt<retries)await sleep(180*(attempt+1));
  }
  throw last instanceof Error?last:new Error('원격 데이터 요청 실패');
}

async function getUniverseJson(market:Market,page:number):Promise<Stock[]>{
  const marketType=market==='kospi'?'KOSPI':'KOSDAQ';
  const startIdx=(page-1)*50;
  const r=await fetchWithRetry(`https://stock.naver.com/api/domestic/market/stock/default?tradeType=KRX&marketType=${marketType}&orderType=marketSum&startIdx=${startIdx}&pageSize=50`);
  const data=await r.json();
  const arr=Array.isArray(data)?data:(Array.isArray(data?.content)?data.content:Array.isArray(data?.stocks)?data.stocks:[]);
  const out:Stock[]=[];
  for(const x of arr){
    const code=String(x?.itemcode??x?.itemCode??'').replace(/^A/,'');
    const name=String(x?.itemname??x?.itemName??x?.name??'').trim();
    if(/^\d{6}$/.test(code)&&name)out.push({code,name});
  }
  return out.slice(0,50);
}

async function getHtml(url:string){
  const r=await fetchWithRetry(url,{headers:{accept:'text/html,*/*'}});
  const b=Buffer.from(await r.arrayBuffer());
  const ct=(r.headers.get('content-type')||'').toLowerCase();
  return ct.includes('utf-8')?b.toString('utf8'):iconv.decode(b,'euc-kr');
}

async function getUniverseLegacy(market:Market,page:number):Promise<Stock[]>{
  const sosok=market==='kosdaq'?1:0;
  const html=await getHtml(`https://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}&page=${page}`);
  const $=cheerio.load(html);
  const out:Stock[]=[];
  $('table.type_2 tr').each((_,el)=>{
    const a=$(el).find('a.tltle').first();
    const m=(a.attr('href')||'').match(/code=(\d{6})/);
    const name=a.text().trim();
    if(m&&name)out.push({code:m[1],name});
  });
  return out.slice(0,50);
}

async function getUniverse(market:Market,page:number){
  try{
    const stocks=await getUniverseJson(market,page);
    if(stocks.length)return {stocks,source:'Naver Pay Stock JSON'};
  }catch{}
  const stocks=await getUniverseLegacy(market,page);
  return {stocks,source:'Naver Finance PC fallback'};
}

async function getFlow20(code:string):Promise<FlowRow[]>{
  const r=await fetchWithRetry(`https://stock.naver.com/api/domestic/detail/${code}/trend?tradeType=KRX&startIdx=0&pageSize=20`,{},2);
  const data=await r.json();
  const arr=Array.isArray(data)?data:Array.isArray(data?.items)?data.items:[];
  return arr.map((x:any)=>{
    const close=num(x?.closePrice);
    const change=num(x?.prevChangePrice);
    const prev=close-change;
    return {
      date:ymd(x?.bizdate),close,
      rate:prev?change/prev*100:0,
      volume:num(x?.tradeVolume),inst:num(x?.organPureBuyQuant),foreign:num(x?.foreignerPureBuyQuant)
    };
  }).filter((x:FlowRow)=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&x.close>0&&x.volume>=0).slice(0,20);
}

function parseMobileTrend(data:any):FlowRow[]{
  const items=Array.isArray(data?.result?.items)?data.result.items:Array.isArray(data?.items)?data.items:[];
  return items.map((x:any)=>{
    const k=x?.krx||x;
    return {date:ymd(x?.localTradedAt??x?.date),close:num(k?.closingPrice??k?.closePrice),rate:num(k?.changeRate??k?.fluctuationsRatio),volume:num(k?.tradingVolume??k?.accumulatedTradingVolume),inst:num(k?.organizationNetVolume??k?.organPureBuyQuant),foreign:num(k?.foreignNetVolume??k?.foreignerPureBuyQuant)};
  }).filter((x:FlowRow)=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&x.close>0);
}

async function getFlowMobile(code:string):Promise<FlowRow[]>{
  const r=await fetchWithRetry(`https://m.stock.naver.com/front-api/stock/domestic/trend?code=${code}`,{},1);
  return parseMobileTrend(await r.json()).slice(0,10);
}

async function getFlowLegacy(code:string):Promise<FlowRow[]>{
  const html=await getHtml(`https://finance.naver.com/item/frgn.naver?code=${code}&page=1`);
  const $=cheerio.load(html);
  const rows:FlowRow[]=[];
  $('table.type2 tr').each((_,el)=>{
    const td=$(el).find('td');
    if(td.length<7)return;
    const rawDate=$(td[0]).text().trim();
    if(!/^\d{4}\.\d{2}\.\d{2}$/.test(rawDate))return;
    rows.push({date:rawDate.replace(/\./g,'-'),close:num($(td[1]).text()),rate:num($(td[3]).text()),volume:num($(td[4]).text()),inst:num($(td[5]).text()),foreign:num($(td[6]).text())});
  });
  return rows.slice(0,20);
}

async function getFlow(code:string):Promise<{rows:FlowRow[];source:string}>{
  const primary=await getFlow20(code).catch(()=>[] as FlowRow[]);
  if(primary.length>=20)return {rows:primary,source:'Naver Pay Stock 20-day JSON'};
  const legacy=await getFlowLegacy(code).catch(()=>[] as FlowRow[]);
  if(legacy.length>=15)return {rows:legacy,source:'Naver Finance PC 20-day fallback'};
  const mobile=await getFlowMobile(code).catch(()=>[] as FlowRow[]);
  const best=primary.length>=legacy.length?(primary.length>=mobile.length?primary:mobile):(legacy.length>=mobile.length?legacy:mobile);
  if(best.length>=5)return {rows:best,source:best===primary?'Naver Pay Stock partial':best===legacy?'Naver Finance PC partial':'Naver Mobile 10-day fallback'};
  throw new Error('투자자별 매매동향 0건');
}

function scoreStock(stock:Stock,market:Market,rows:FlowRow[],flowSource:string){
  if(rows.length<5)return null;
  const r5=rows.slice(0,5),r10=rows.slice(0,10),r20=rows.slice(0,20);
  const vol20=Math.max(1,sum(r20,x=>x.volume));
  const inst5=sum(r5,x=>x.inst),foreign5=sum(r5,x=>x.foreign);
  const inst20=sum(r20,x=>x.inst),foreign20=sum(r20,x=>x.foreign);
  const instIntensity=inst20/vol20*100,foreignIntensity=foreign20/vol20*100;
  const combined20=inst20+foreign20,combined5=inst5+foreign5;
  const combinedIntensity=combined20/vol20*100;
  const latest=rows[0].close;
  const old=rows[Math.min(19,rows.length-1)].close||latest;
  const price20=old?(latest/old-1)*100:0;
  const buyDays=r10.filter(x=>x.inst+x.foreign>0).length;
  const bothDays=r10.filter(x=>x.inst>0&&x.foreign>0).length;
  const absorption=r10.filter(x=>x.rate<0&&x.inst+x.foreign>0).length;
  const avg20=combined20/Math.max(1,r20.length),avg5=combined5/Math.max(1,r5.length);
  const accel=avg20!==0?avg5/Math.abs(avg20):(avg5>0?2:0);

  let score=0;
  score+=clamp(foreignIntensity*3,0,20);
  score+=clamp(instIntensity*3,0,20);
  if(inst20>0&&foreign20>0)score+=10;
  score+=clamp(buyDays,0,10);
  if(price20>=-8&&price20<=8)score+=20;
  else if(price20>-15&&price20<15)score+=12;
  else if(price20>=15&&price20<=25)score+=5;
  else if(price20<-15)score+=6;
  if(combined5>0){if(accel>=1.5)score+=10;else if(accel>=1.1)score+=7;else if(accel>=0.7)score+=4;}
  score+=clamp(absorption*2.5,0,10);
  score=Math.round(clamp(score,0,100));

  const reasons:string[]=[];
  if(inst20>0&&foreign20>0)reasons.push('기관·외국인 20일 동시 순매수');
  if(buyDays>=7)reasons.push(`최근 10일 중 ${buyDays}일 수급 우위`);
  if(price20>=-8&&price20<=8)reasons.push(`${r20.length}거래일 주가 ${price20>=0?'+':''}${price20.toFixed(1)}%로 과열 전`);
  if(absorption>=2)reasons.push(`하락일 흡수매수 ${absorption}회`);
  if(accel>=1.3&&combined5>0)reasons.push('최근 5일 매수세 가속');
  if(foreign20>0)reasons.push('외국인 20일 누적 순매수');
  if(inst20>0)reasons.push('기관 20일 누적 순매수');

  const stage=score>=75?'강한 초기 매집':score>=60?'초기 매집':score>=45?'관찰':'약함';
  return {market:market==='kospi'?'KOSPI':'KOSDAQ',code:stock.code,name:stock.name,price:latest,score,stage,inst5,foreign5,inst20,foreign20,combinedIntensity:Number(combinedIntensity.toFixed(2)),price20:Number(price20.toFixed(2)),buyDays,bothDays,absorption,reason:reasons.slice(0,4).join(' · '),days:rows.length,flowSource,source:`https://stock.naver.com/domestic/stock/${stock.code}/total`};
}

async function pooled<T,R>(items:T[],limit:number,worker:(x:T)=>Promise<R>):Promise<(R|null)[]>{
  const out:(R|null)[]=new Array(items.length).fill(null);let next=0;
  async function run(){while(true){const idx=next++;if(idx>=items.length)break;try{out[idx]=await worker(items[idx]);}catch{out[idx]=null;}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>run()));
  return out;
}

export async function GET(req:NextRequest){
  if(!(await isAuthed()))return unauthorized();
  const {searchParams}=new URL(req.url);
  const market=(searchParams.get('market')==='kosdaq'?'kosdaq':'kospi') as Market;
  const maxPage=market==='kospi'?10:6;
  const page=clamp(Number(searchParams.get('page')||1),1,maxPage);
  try{
    const uni=await getUniverse(market,page);
    if(!uni.stocks.length)return NextResponse.json({error:'시가총액 종목 목록을 가져오지 못했습니다.',market,page},{status:502});
    const scanned=await pooled(uni.stocks,8,async s=>{const flow=await getFlow(s.code);return scoreStock(s,market,flow.rows,flow.source);});
    const rows=scanned.filter(Boolean);
    const failed=uni.stocks.length-rows.length;
    if(!rows.length)return NextResponse.json({error:'종목 목록은 가져왔지만 투자자별 수급 데이터가 0건입니다.',market,page,stockCount:uni.stocks.length,failed},{status:502});
    return NextResponse.json({market,page,count:uni.stocks.length,success:rows.length,failed,universeSource:uni.source,rows,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
  }catch(e:any){return NextResponse.json({error:e?.message||'수집 오류',market,page},{status:500});}
}
