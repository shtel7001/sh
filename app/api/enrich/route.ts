import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchInvestorFlow, type UniverseStock } from '@/lib/market';
export const runtime='nodejs'; export const maxDuration=60;
const clean=(s:string)=>s.replace(/<[^>]+>/g,'').replace(/&[^;]+;/g,' ').replace(/[^0-9A-Za-z가-힣 ]/g,' ').replace(/\s+/g,' ').trim();
const eventWords=['계약','수주','공급','임상','FDA','IND','AI','데이터센터','반도체','HBM','로봇','자율주행','방산','원전','전력망','바이오','신약','특허','합작','협력','투자','정부사업','컨소시엄'];
function supplyScore(rows:{date:string;inst:number;foreign:number}[]|null){
  if(!rows?.length)return {score:null,reasons:['수급 데이터 없음']}; const a=[...rows].reverse(); const recent=a.slice(-5); let s=0;const reasons:string[]=[];
  const fp=recent.filter(x=>x.foreign>0).length,ip=recent.filter(x=>x.inst>0).length; if(fp>=3){s+=4;reasons.push(`최근 5일 외국인 순매수 ${fp}일`);} if(ip>=3){s+=4;reasons.push(`최근 5일 기관 순매수 ${ip}일`);}
  const fsum=recent.reduce((x,y)=>x+y.foreign,0),isum=recent.reduce((x,y)=>x+y.inst,0); if(fsum>0){s+=2;reasons.push('최근 5일 외국인 누적 순매수');}if(isum>0){s+=2;reasons.push('최근 5일 기관 누적 순매수');}
  const f3=recent.slice(-3).every(x=>x.foreign>0),i3=recent.slice(-3).every(x=>x.inst>0);if(f3){s+=2;reasons.push('외국인 3일 연속 순매수');}if(i3){s+=1;reasons.push('기관 3일 연속 순매수');}
  return {score:Math.min(15,s),reasons};
}
async function news(stock:UniverseStock){
  const id=process.env.NAVER_CLIENT_ID,secret=process.env.NAVER_CLIENT_SECRET; if(!id||!secret)return {score:null,reasons:['뉴스 API 미연결'],items:[]};
  try{
    const q=encodeURIComponent(stock.name); const r=await fetch(`https://openapi.naver.com/v1/search/news.json?query=${q}&display=100&sort=date`,{headers:{'X-Naver-Client-Id':id,'X-Naver-Client-Secret':secret},cache:'no-store'}); if(!r.ok)throw new Error(String(r.status));
    const j=await r.json(); const seen=new Set<string>(); const items:any[]=(j.items||[]).map((x:any)=>({title:clean(x.title||''),link:x.originallink||x.link,date:new Date(x.pubDate).toISOString()})).filter((x:any)=>{const k=x.title.replace(/\s/g,'').slice(0,40);if(seen.has(k))return false;seen.add(k);return true;});
    const now=Date.now(),d5=5*86400000,d25=25*86400000; const recent=items.filter(x=>now-new Date(x.date).getTime()<=d5); const prev=items.filter(x=>{const d=now-new Date(x.date).getTime();return d>d5&&d<=d25;});
    const rd=recent.length/5,pd=prev.length/20,ratio=pd?rd/pd:(recent.length?5:0); let s=0; const reasons:string[]=[]; if(recent.length>=5){s+=4;reasons.push(`최근 5일 관련뉴스 ${recent.length}건`);} if(ratio>=2){s+=5;reasons.push(`뉴스 발생속도 이전 구간 대비 ${ratio.toFixed(1)}배`);} if(ratio>=4)s+=4;
    const hits=eventWords.filter(w=>recent.some(x=>x.title.includes(w))); if(hits.length){s+=Math.min(4,hits.length);reasons.push(`이벤트 키워드 증가: ${hits.slice(0,5).join(', ')}`);} if(recent.length>=8)s+=3;
    return {score:Math.min(20,s),reasons,items:recent.slice(0,12)};
  }catch{return {score:null,reasons:['뉴스 데이터 수집 실패'],items:[]};}
}
export async function POST(req:Request){
  if(!await isAuthed())return unauthorized(); const body=await req.json().catch(()=>null); const stocks:UniverseStock[]=body?.stocks||[]; if(!Array.isArray(stocks)||stocks.length>20)return NextResponse.json({error:'최대 20종목'},{status:400});
  const results=[]; for(let i=0;i<stocks.length;i+=4){const part=stocks.slice(i,i+4);const rr=await Promise.all(part.map(async s=>{const [n,flow]=await Promise.all([news(s),fetchInvestorFlow(s.code)]);const sup=supplyScore(flow);return {code:s.code,newsScore:n.score,newsReasons:n.reasons,news:n.items,supplyScore:sup.score,supplyReasons:sup.reasons};}));results.push(...rr);}
  return NextResponse.json({results});
}
