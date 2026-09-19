import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { isAuthed, unauthorized } from '@/lib/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

type FlowRow = { date:string; close:number; rate:number; volume:number; inst:number; foreign:number };
type Stock = { code:string; name:string };

function num(v:string){
  const x = Number((v || '').replace(/[^0-9+-.]/g, ''));
  return Number.isFinite(x) ? x : 0;
}
function clamp(v:number,min:number,max:number){ return Math.max(min, Math.min(max, v)); }
function sum<T>(a:T[], f:(x:T)=>number){ return a.reduce((s,x)=>s+f(x),0); }

async function getHtml(url:string){
  const r = await fetch(url, {
    headers: {'user-agent': UA, 'accept-language':'ko-KR,ko;q=0.9'},
    next: { revalidate: 120 }
  });
  if(!r.ok) throw new Error(`Naver HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  return iconv.decode(b, 'euc-kr');
}

async function getUniversePage(market:'kospi'|'kosdaq', page:number):Promise<Stock[]>{
  const sosok = market === 'kosdaq' ? 1 : 0;
  const html = await getHtml(`https://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}&page=${page}`);
  const $ = cheerio.load(html);
  const out:Stock[] = [];
  $('table.type_2 tr').each((_, el) => {
    const a = $(el).find('a.tltle').first();
    const href = a.attr('href') || '';
    const m = href.match(/code=(\d{6})/);
    const name = a.text().trim();
    if(m && name) out.push({ code:m[1], name });
  });
  return out.slice(0, 50);
}

async function getFlow(code:string):Promise<FlowRow[]>{
  const html = await getHtml(`https://finance.naver.com/item/frgn.naver?code=${code}&page=1`);
  const $ = cheerio.load(html);
  const rows:FlowRow[] = [];
  $('table.type2 tr').each((_, el) => {
    const td = $(el).find('td');
    if(td.length < 7) return;
    const date = $(td[0]).text().trim();
    if(!/^\d{4}\.\d{2}\.\d{2}$/.test(date)) return;
    rows.push({
      date,
      close: num($(td[1]).text()),
      rate: num($(td[3]).text()),
      volume: num($(td[4]).text()),
      inst: num($(td[5]).text()),
      foreign: num($(td[6]).text()),
    });
  });
  return rows.slice(0,20);
}

function scoreStock(stock:Stock, market:'kospi'|'kosdaq', rows:FlowRow[]){
  if(rows.length < 5) return null;
  const r5 = rows.slice(0,5), r10 = rows.slice(0,10), r20 = rows.slice(0,20);
  const vol20 = Math.max(1, sum(r20, x => x.volume));
  const inst5 = sum(r5, x => x.inst), foreign5 = sum(r5, x => x.foreign);
  const inst20 = sum(r20, x => x.inst), foreign20 = sum(r20, x => x.foreign);
  const instIntensity = inst20 / vol20 * 100;
  const foreignIntensity = foreign20 / vol20 * 100;
  const combined20 = inst20 + foreign20;
  const combined5 = inst5 + foreign5;
  const combinedIntensity = combined20 / vol20 * 100;
  const latest = rows[0].close;
  const old = rows[Math.min(19, rows.length-1)].close || latest;
  const price20 = old ? (latest / old - 1) * 100 : 0;
  const buyDays = r10.filter(x => x.inst + x.foreign > 0).length;
  const bothDays = r10.filter(x => x.inst > 0 && x.foreign > 0).length;
  const absorption = r10.filter(x => x.rate < 0 && x.inst + x.foreign > 0).length;
  const avg20 = combined20 / Math.max(1, r20.length);
  const avg5 = combined5 / Math.max(1, r5.length);
  const accel = avg20 !== 0 ? avg5 / Math.abs(avg20) : (avg5 > 0 ? 2 : 0);

  let score = 0;
  score += clamp(foreignIntensity * 3.0, 0, 20);
  score += clamp(instIntensity * 3.0, 0, 20);
  if(inst20 > 0 && foreign20 > 0) score += 10;
  score += clamp(buyDays, 0, 10);
  if(price20 >= -8 && price20 <= 8) score += 20;
  else if(price20 > -15 && price20 < 15) score += 12;
  else if(price20 >= 15 && price20 <= 25) score += 5;
  else if(price20 < -15) score += 6;
  if(combined5 > 0){
    if(accel >= 1.5) score += 10;
    else if(accel >= 1.1) score += 7;
    else if(accel >= 0.7) score += 4;
  }
  score += clamp(absorption * 2.5, 0, 10);
  score = Math.round(clamp(score, 0, 100));

  const reasons:string[] = [];
  if(inst20 > 0 && foreign20 > 0) reasons.push('기관·외국인 20일 동시 순매수');
  if(buyDays >= 7) reasons.push(`최근 10일 중 ${buyDays}일 수급 우위`);
  if(price20 >= -8 && price20 <= 8) reasons.push(`20일 주가 ${price20>=0?'+':''}${price20.toFixed(1)}%로 과열 전`);
  if(absorption >= 2) reasons.push(`하락일 흡수매수 ${absorption}회`);
  if(accel >= 1.3 && combined5 > 0) reasons.push('최근 5일 매수세 가속');
  if(foreign20 > 0) reasons.push('외국인 누적 순매수');
  if(inst20 > 0) reasons.push('기관 누적 순매수');

  const stage = score >= 75 ? '강한 초기 매집' : score >= 60 ? '초기 매집' : score >= 45 ? '관찰' : '약함';
  return {
    market: market === 'kospi' ? 'KOSPI' : 'KOSDAQ', code:stock.code, name:stock.name,
    price:latest, score, stage,
    inst5, foreign5, inst20, foreign20,
    combinedIntensity:Number(combinedIntensity.toFixed(2)),
    price20:Number(price20.toFixed(2)), buyDays, bothDays, absorption,
    reason:reasons.slice(0,4).join(' · '), days:rows.length,
    source:`https://finance.naver.com/item/frgn.naver?code=${stock.code}`
  };
}

async function pooled<T,R>(items:T[], limit:number, worker:(x:T)=>Promise<R>):Promise<R[]>{
  const out:R[] = new Array(items.length); let next = 0;
  async function run(){
    while(true){
      const idx = next++;
      if(idx >= items.length) break;
      try { out[idx] = await worker(items[idx]); }
      catch { out[idx] = null as R; }
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)}, () => run()));
  return out;
}

export async function GET(req:NextRequest){
  if(!(await isAuthed())) return unauthorized();
  const { searchParams } = new URL(req.url);
  const market = (searchParams.get('market') === 'kosdaq' ? 'kosdaq' : 'kospi') as 'kospi'|'kosdaq';
  const maxPage = market === 'kospi' ? 10 : 6;
  const page = clamp(Number(searchParams.get('page') || 1), 1, maxPage);
  try {
    const stocks = await getUniversePage(market, page);
    const rows = await pooled(stocks, 6, async s => scoreStock(s, market, await getFlow(s.code)));
    return NextResponse.json({ market, page, count:stocks.length, rows:rows.filter(Boolean), updatedAt:new Date().toISOString() }, { headers:{'Cache-Control':'no-store'} });
  } catch(e:any){
    return NextResponse.json({ error:e?.message || '수집 오류', market, page }, { status:500 });
  }
}
