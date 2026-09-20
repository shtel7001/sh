import * as cheerio from 'cheerio';

const generic=new Set(['테마','국내 테마 DB','Daily 특징 테마','ETF 테마 DB','미국 테마 DB','테마 브리핑','일간/주간/월간 테마별 등락률','종목 테마 차트','HOT 테마']);
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();

export async function fetchInfostockThemes(code:string){
  const url=`https://infostock.co.kr/stockitem?code=${encodeURIComponent(code)}`;
  const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),7000);
  try{
    const r=await fetch(url,{signal:ctl.signal,headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36','Accept':'text/html,application/xhtml+xml','Accept-Language':'ko-KR,ko;q=0.9','Referer':'https://infostock.co.kr/'},next:{revalidate:21600}} as RequestInit & {next:{revalidate:number}});
    clearTimeout(t);if(!r.ok)return {themes:[],url,error:`HTTP ${r.status}`};
    const html=await r.text();const $=cheerio.load(html);const found:string[]=[];
    const add=(v:string)=>{const x=clean(v);if(!x||generic.has(x)||x.length>40||found.includes(x))return;found.push(x)};
    $('a[href*="ThemeDB/ThemeAllAllowed/"]').each((_,a)=>{const href=$(a).attr('href')||'';if(/ThemeAllAllowed\/\d+/.test(href))add($(a).text())});
    $('[class*="theme" i] a,[id*="theme" i] a').each((_,a)=>{const href=$(a).attr('href')||'';if(/Theme(AllAllowed|Detail|DB)|theme/i.test(href))add($(a).text())});
    for(const re of [/"themeName"\s*:\s*"([^"]+)"/gi,/"ThemeName"\s*:\s*"([^"]+)"/gi,/"theme_nm"\s*:\s*"([^"]+)"/gi]){let m;while((m=re.exec(html)))add(m[1])}
    return {themes:found.slice(0,5),url,error:null};
  }catch(e){clearTimeout(t);return {themes:[],url,error:e instanceof Error?e.message:'인포스탁 조회 실패'};}
}
