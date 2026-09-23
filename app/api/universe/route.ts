import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { isAuthed, unauthorized } from '@/lib/guard';

export const runtime='nodejs';
export const maxDuration=60;

type Stock={name:string;code:string;market:'KOSPI';currentPrice:number|null;changePct:number|null;marketCap:number|null;sector:null;theme:null};
const UA='Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';
const n=(v:any)=>{ if(typeof v==='number') return Number.isFinite(v)?v:null; if(typeof v!=='string') return null; const x=Number(v.replace(/[,+%원\s]/g,'')); return Number.isFinite(x)?x:null };
const codeOf=(x:any)=>String(x?.itemCode??x?.itemcode??x?.stockCode??x?.code??'').match(/\d{6}/)?.[0]||'';
const nameOf=(x:any)=>String(x?.stockName??x?.name??x?.itemName??'').trim();
function normalize(x:any):Stock|null{ const code=codeOf(x),name=nameOf(x); if(!code||!name)return null; return {name,code,market:'KOSPI',currentPrice:n(x?.closePrice??x?.currentPrice??x?.nowVal??x?.price),changePct:n(x?.fluctuationsRatio??x?.changeRate??x?.changePct??x?.rate),marketCap:n(x?.marketValue??x?.marketCap??x?.marketValueAmount),sector:null,theme:null}; }
function rowsOf(j:any):any[]{ if(Array.isArray(j))return j; for(const k of ['stocks','items','stockList','data'])if(Array.isArray(j?.[k]))return j[k]; if(Array.isArray(j?.result?.stocks))return j.result.stocks; if(Array.isArray(j?.result?.items))return j.result.items; if(Array.isArray(j?.result))return j.result; return []; }
async function fetchJson(url:string){ const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),9000); try{ const r=await fetch(url,{signal:ctl.signal,headers:{'User-Agent':UA,'Accept':'application/json,text/plain,*/*','Accept-Language':'ko-KR,ko;q=0.9','Referer':'https://m.stock.naver.com/'},next:{revalidate:900}} as RequestInit & {next:{revalidate:number}}); if(!r.ok)throw new Error(`HTTP ${r.status}`); return await r.json(); } finally{clearTimeout(t);} }
async function mobileUniverse(){ const out:Stock[]=[]; const pageSize=100; for(let page=1;page<=20;page++){ const j=await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=${page}&pageSize=${pageSize}`); const rows=rowsOf(j); if(!rows.length){ if(page===1)throw new Error('mobile-json 1페이지 0건'); break; } for(const x of rows){const s=normalize(x); if(s)out.push(s);} if(rows.length<pageSize)break; } return out; }
async function frontUniverse(){ const out:Stock[]=[]; const pageSize=100; for(let page=1;page<=20;page++){ const j=await fetchJson(`https://m.stock.naver.com/front-api/stock/domestic/stockList?sortType=marketValue&category=KOSPI&page=${page}&pageSize=${pageSize}`); const rows=rowsOf(j); if(!rows.length){ if(page===1)throw new Error('front-api 1페이지 0건'); break; } for(const x of rows){const s=normalize(x); if(s)out.push(s);} if(rows.length<pageSize)break; } return out; }
async function pcHtml(url:string){ const r=await fetch(url,{headers:{'User-Agent':UA,'Accept-Language':'ko-KR,ko;q=0.9','Referer':'https://finance.naver.com/'},next:{revalidate:900}} as RequestInit & {next:{revalidate:number}}); if(!r.ok)throw new Error(`HTTP ${r.status}`); const b=Buffer.from(await r.arrayBuffer()); return (r.headers.get('content-type')||'').toLowerCase().includes('utf-8')?b.toString('utf8'):iconv.decode(b,'EUC-KR'); }
async function pcUniverse(){ const out:Stock[]=[]; for(let page=1;page<=30;page++){ const html=await pcHtml(`https://finance.naver.com/sise/sise_market_sum.naver?sosok=0&page=${page}`); const $=cheerio.load(html); let count=0; $('table.type_2 tr, table.type2 tr').each((_,tr)=>{ const a=$(tr).find('a.tltle, a[href*="/item/main.naver?code="]').first(); if(!a.length)return; const name=a.text().trim(), code=((a.attr('href')||'').match(/code=(\d{6})/)||[])[1]; if(!code||!name)return; const cells=$(tr).find('td').map((_,td)=>$(td).text().replace(/\s+/g,' ').trim()).get(); out.push({name,code,market:'KOSPI',currentPrice:n(cells[2]||''),changePct:n(cells[4]||''),marketCap:n(cells[6]||''),sector:null,theme:null}); count++; }); if(count===0)break; } return out; }

export async function GET(){
 if(!await isAuthed())return unauthorized();
 const errors:string[]=[]; let stocks:Stock[]=[]; let source='';
 try{stocks=await mobileUniverse(); source='NAVER mobile-json';}catch(e){errors.push(`mobile: ${e instanceof Error?e.message:'오류'}`);}
 if(stocks.length<500){try{stocks=await frontUniverse();source='NAVER front-api';}catch(e){errors.push(`front: ${e instanceof Error?e.message:'오류'}`);}}
 if(stocks.length<500){try{stocks=await pcUniverse();source='NAVER PC html';}catch(e){errors.push(`pc: ${e instanceof Error?e.message:'오류'}`);}}
 stocks=[...new Map(stocks.map(s=>[s.code,s])).values()];
 if(!stocks.length)return NextResponse.json({error:'코스피 종목목록 수집 실패',errors,stocks:[]},{status:502});
 return NextResponse.json({stocks,source,errors,count:stocks.length,updatedAt:new Date().toISOString()});
}
