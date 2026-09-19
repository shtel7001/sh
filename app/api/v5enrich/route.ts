import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchInvestorFlow, type UniverseStock } from '@/lib/market';

export const runtime='nodejs';
export const maxDuration=60;

const clean=(s:string)=>s.replace(/<[^>]+>/g,'').replace(/&[^;]+;/g,' ').replace(/[^0-9A-Za-z가-힣 ]/g,' ').replace(/\s+/g,' ').trim();
const eventWords=['계약','수주','공급','임상','FDA','IND','AI','데이터센터','반도체','HBM','로봇','자율주행','방산','원전','전력망','바이오','신약','특허','합작','협력','투자','정부사업','컨소시엄','MOU','승인','허가','증설','양산','수출','파트너'];
const stop=new Set(['관련','대한','위한','통해','올해','최근','기업','시장','주가','종목','코스피','코스닥','국내','한국','전망','기자','뉴스','발표','사업']);
const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n));

function host(url:string){try{return new URL(url).hostname.replace(/^www\./,'');}catch{return '';}}
function tokens(title:string){return clean(title).split(/\s+/).filter(x=>x.length>=2&&!stop.has(x)&&!/^\d+$/.test(x));}
function counts(items:any[]){const m=new Map<string,number>();for(const x of items)for(const t of tokens(x.title))m.set(t,(m.get(t)||0)+1);return m;}

function flowScore(rows:{date:string;inst:number;foreign:number}[]|null){
  if(!rows?.length)return {score:null,reasons:['수급 데이터 없음']};
  const a=[...rows].reverse(); const recent=a.slice(-5); let s=0; const reasons:string[]=[];
  const fp=recent.filter(x=>x.foreign>0).length,ip=recent.filter(x=>x.inst>0).length;
  if(fp>=3){s+=1.5;reasons.push(`외국인 최근 5일 중 ${fp}일 순매수`);}
  if(ip>=3){s+=1.5;reasons.push(`기관 최근 5일 중 ${ip}일 순매수`);}
  const fs=recent.reduce((x,y)=>x+y.foreign,0),is=recent.reduce((x,y)=>x+y.inst,0);
  if(fs>0)s+=1; if(is>0)s+=1;
  if(recent.slice(-3).every(x=>x.foreign>0)){s+=.5;reasons.push('외국인 3일 연속 순매수');}
  if(recent.slice(-3).every(x=>x.inst>0)){s+=.5;reasons.push('기관 3일 연속 순매수');}
  return {score:+Math.min(5,s).toFixed(1),reasons};
}

async function news(stock:UniverseStock){
  const id=process.env.NAVER_CLIENT_ID,secret=process.env.NAVER_CLIENT_SECRET;
  if(!id||!secret)return {newsVelocityScore:null,keywordNoveltyScore:null,sourceDiversityScore:null,themeConfirmationScore:null,reasons:['뉴스 API 미연결'],items:[],keywords:[]};
  try{
    const q=encodeURIComponent(stock.name);
    const r=await fetch(`https://openapi.naver.com/v1/search/news.json?query=${q}&display=100&sort=date`,{headers:{'X-Naver-Client-Id':id,'X-Naver-Client-Secret':secret},cache:'no-store'});
    if(!r.ok)throw new Error(String(r.status));
    const j=await r.json(); const seen=new Set<string>();
    const items:any[]=(j.items||[]).map((x:any)=>({title:clean(x.title||''),link:x.originallink||x.link,date:new Date(x.pubDate).toISOString(),source:host(x.originallink||x.link)})).filter((x:any)=>{const k=x.title.replace(/\s/g,'').slice(0,45);if(!k||seen.has(k))return false;seen.add(k);return true;});
    const now=Date.now(),d7=7*86400000,d35=35*86400000;
    const recent=items.filter(x=>now-new Date(x.date).getTime()<=d7);
    const prev=items.filter(x=>{const d=now-new Date(x.date).getTime();return d>d7&&d<=d35;});
    const rd=recent.length/7,pd=prev.length/28,ratio=pd?rd/pd:(recent.length?4:0);
    let velocity=0; const reasons:string[]=[];
    if(recent.length>=3)velocity+=2;
    if(recent.length>=6)velocity+=2;
    if(ratio>=1.5)velocity+=2;
    if(ratio>=2.5)velocity+=1;
    if(ratio>=4)velocity+=1;
    velocity=Math.min(8,velocity);
    if(recent.length)reasons.push(`최근 7일 뉴스 ${recent.length}건 · 이전 구간 대비 속도 ${ratio.toFixed(1)}배`);

    const rc=counts(recent),pc=counts(prev);
    const novel=[...rc.entries()].filter(([w,n])=>n>=2&&(pc.get(w)||0)<=1).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);
    const eventHits=eventWords.filter(w=>recent.filter(x=>x.title.toUpperCase().includes(w.toUpperCase())).length>=1);
    let novelty=Math.min(7,novel.length*1.2+Math.min(3,eventHits.length*.7));
    novelty=+novelty.toFixed(1);
    if(novel.length)reasons.push(`새 키워드: ${novel.slice(0,5).join(', ')}`);

    const domains=new Set(recent.map(x=>x.source).filter(Boolean));
    let diversity=domains.size>=7?5:domains.size>=5?4:domains.size>=3?3:domains.size>=2?2:domains.size>=1?1:0;
    if(diversity>=3)reasons.push(`서로 다른 뉴스 출처 ${domains.size}곳`);

    let theme=0;
    for(const w of eventHits){const n=recent.filter(x=>x.title.toUpperCase().includes(w.toUpperCase())).length;if(n>=3)theme+=2;else if(n>=2)theme+=1.2;else theme+=.6;}
    theme=+Math.min(5,theme).toFixed(1);
    if(eventHits.length)reasons.push(`테마/이벤트 확인: ${eventHits.slice(0,6).join(', ')}`);

    return {newsVelocityScore:velocity,keywordNoveltyScore:novelty,sourceDiversityScore:diversity,themeConfirmationScore:theme,reasons,items:recent.slice(0,12),keywords:[...new Set([...novel,...eventHits])].slice(0,10)};
  }catch{
    return {newsVelocityScore:null,keywordNoveltyScore:null,sourceDiversityScore:null,themeConfirmationScore:null,reasons:['뉴스 데이터 수집 실패'],items:[],keywords:[]};
  }
}

export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  const body=await req.json().catch(()=>null); const stocks:UniverseStock[]=body?.stocks||[];
  if(!Array.isArray(stocks)||stocks.length>20)return NextResponse.json({error:'한 번에 최대 20종목까지 보강합니다.'},{status:400});
  const results:any[]=[];
  for(let i=0;i<stocks.length;i+=4){
    const part=stocks.slice(i,i+4);
    const rr=await Promise.all(part.map(async s=>{
      const [n,flow]=await Promise.all([news(s),fetchInvestorFlow(s.code)]);
      const f=flowScore(flow);
      return {code:s.code,...n,flowScore:f.score,flowReasons:f.reasons};
    }));
    results.push(...rr);
  }
  return NextResponse.json({results});
}
