import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { fetchYahooBars, type Bar, type UniverseStock } from './market';

export type RadarParams = {
  lookback:number;
  spikePct:number;
  spikeVolRatio:number;
  pullbackMaxDays:number;
  ma20Distance:number;
  maxTodayRise:number;
  minTechScore:number;
};

export type IndicatorBar = Bar & {
  ret:number|null;
  ma5:number|null;
  ma20:number|null;
  ma60:number|null;
  volRatio:number|null;
};

const UA='Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';
const avg=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const pct=(a:number,b:number)=>b?((a/b)-1)*100:0;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function fetchText(url:string, timeout=8500){
  const ctl=new AbortController();
  const t=setTimeout(()=>ctl.abort(),timeout);
  try{
    const r=await fetch(url,{signal:ctl.signal,headers:{'User-Agent':UA,'Accept-Language':'ko-KR,ko;q=0.9,en;q=0.5','Referer':'https://finance.naver.com/'},cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const b=Buffer.from(await r.arrayBuffer());
    const ct=(r.headers.get('content-type')||'').toLowerCase();
    return ct.includes('utf-8')?b.toString('utf8'):iconv.decode(b,'EUC-KR');
  } finally { clearTimeout(t); }
}

async function naverBars(code:string,count=180):Promise<Bar[]>{
  const xml=await fetchText(`https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=${count}&requestType=0`);
  const out:Bar[]=[];
  const re=/data="([^"]+)"/g;
  let m:RegExpExecArray|null;
  while((m=re.exec(xml))){
    const p=m[1].split('|');
    if(p.length<6) continue;
    const [d,o,h,l,c,v]=p;
    const nums=[o,h,l,c,v].map(Number);
    if(nums.every(Number.isFinite)) out.push({date:`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`,open:nums[0],high:nums[1],low:nums[2],close:nums[3],volume:nums[4]});
  }
  if(out.length<35) throw new Error('NAVER 일봉 이력 부족');
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}

export async function fetchDailyBars(code:string,market:'KOSPI'|'KOSDAQ',days=180){
  try{return await naverBars(code,Math.max(120,days));}
  catch{
    await sleep(60);
    return await fetchYahooBars(code,market,days);
  }
}

export function indicators(bars:Bar[]):IndicatorBar[]{
  return bars.map((b,i)=>{
    const ret=i?pct(b.close,bars[i-1].close):null;
    const ma=(n:number)=>i>=n-1?avg(bars.slice(i-n+1,i+1).map(x=>x.close)):null;
    const base=i>=20?avg(bars.slice(i-20,i).map(x=>x.volume)):0;
    return {...b,ret,ma5:ma(5),ma20:ma(20),ma60:ma(60),volRatio:base>0?b.volume/base:null};
  });
}

function localLowScore(a:IndicatorBar[],i:number){
  const start=Math.max(3,i-24); let lows=0; const vals:number[]=[];
  for(let j=start+2;j<=i-2;j++){
    if(a[j].close<=a[j-1].close&&a[j].close<=a[j+1].close&&a[j].close<=a[j-2].close&&a[j].close<=a[j+2].close){lows++;vals.push(a[j].close);}
  }
  if(vals.length>=2){const x=vals.at(-2)!,y=vals.at(-1)!; if(Math.abs(x-y)/Math.min(x,y)<=0.055)return {score:4,reason:'최근 저점이 W형/쌍바닥 범위'}; if(y>x)return {score:3,reason:'최근 저점이 높아지는 구조'};}
  return lows?{score:1,reason:'최근 국지 저점 확인'}:{score:0,reason:''};
}

function patternAt(a:IndicatorBar[],i:number,p:RadarParams){
  if(i<65)return false;
  const start=Math.max(20,i-p.lookback);
  let si=-1;
  for(let j=i-1;j>=start;j--){if((a[j].ret??-999)>=p.spikePct&&(a[j].volRatio??0)>=p.spikeVolRatio){si=j;break;}}
  if(si<0)return false;
  const age=i-si;
  if(age<1||age>p.pullbackMaxDays)return false;
  const pb=pct(a[i].close,a[si].close);
  const gap=a[i].ma20?pct(a[i].close,a[i].ma20!):99;
  return pb>=-28&&pb<=5&&Math.abs(gap)<=p.ma20Distance;
}

function historicalValidation(a:IndicatorBar[],p:RadarParams){
  let samples=0,hits=0,lastSignal=-99;
  for(let i=65;i<a.length-4;i++){
    if(i-lastSignal<5)continue;
    if(!patternAt(a,i,p))continue;
    lastSignal=i;samples++;
    const base=a[i].close;
    const maxHigh=Math.max(...a.slice(i+1,i+4).map(x=>x.high));
    if(pct(maxHigh,base)>=5)hits++;
    if(samples>=12)break;
  }
  const hitRate=samples?hits/samples*100:null;
  const bonus=samples>=3?(hitRate!>=70?5:hitRate!>=50?3:hitRate!>=35?1:0):0;
  return {samples,hits,hitRate,bonus};
}

export function analyzeTechnical(stock:UniverseStock,bars:Bar[],p:RadarParams){
  const a=indicators(bars); const i=a.length-1;
  if(i<65)throw new Error('분석 가능한 일봉 이력이 부족합니다.');
  const last=a[i], reasons:string[]=[], risks:string[]=[];
  let score=0,riskPenalty=0;
  const spikes:number[]=[];
  for(let j=Math.max(20,i-p.lookback);j<=i;j++) if((a[j].ret??-999)>=p.spikePct&&(a[j].volRatio??0)>=p.spikeVolRatio)spikes.push(j);
  const si=spikes.length?spikes.at(-1)!:-1;
  const recentAbnormal=a.slice(Math.max(20,i-5),i+1).filter(x=>(x.volRatio??0)>=1.5).length;
  if(si>=0){
    const s=a[si]; score+=10; reasons.push(`${s.date} +${(s.ret??0).toFixed(1)}% 대량거래 급등`);
    const vr=s.volRatio??0; const add=vr>=5?15:vr>=3?12:vr>=2.2?9:6; score+=add; reasons.push(`급등일 거래량 ${vr.toFixed(1)}배`);
    if(spikes.length>=2){score+=3;reasons.push(`검색구간 급등 신호 ${spikes.length}회`);}
    const age=i-si; const pb=pct(last.close,s.close);
    if(age>=1&&age<=p.pullbackMaxDays&&pb>=-28&&pb<=4){score+=10;reasons.push(`급등 후 ${age}거래일 조정 ${pb.toFixed(1)}%`);}
    const after=a.slice(si+1,i+1); const contraction=after.length?avg(after.map(x=>x.volume))/Math.max(1,s.volume):null;
    if(contraction!==null&&contraction<=0.65){score+=6;reasons.push(`조정 거래량 급등일의 ${(contraction*100).toFixed(0)}%로 감소`);}else if(contraction!==null&&contraction<=0.85){score+=3;reasons.push('조정 중 거래량 감소');}
  } else if(recentAbnormal>=2){score+=9;reasons.push(`최근 6거래일 거래량 이상 ${recentAbnormal}회`);}

  if((last.volRatio??0)>=2&&Math.abs(last.ret??0)<4){score+=8;reasons.push(`오늘 거래량 ${(last.volRatio??0).toFixed(1)}배인데 등락 ${(last.ret??0).toFixed(1)}%로 제한`);}else if((last.volRatio??0)>=1.5){score+=4;reasons.push(`오늘 거래량 ${(last.volRatio??0).toFixed(1)}배`);}

  const ma20Gap=last.ma20?pct(last.close,last.ma20):null;
  if(ma20Gap!==null&&Math.abs(ma20Gap)<=3){score+=8;reasons.push(`20일선과 ${ma20Gap.toFixed(1)}% 이내`);}else if(ma20Gap!==null&&Math.abs(ma20Gap)<=p.ma20Distance){score+=5;reasons.push(`20일선 근처 ${ma20Gap.toFixed(1)}%`);}
  const ma5Gap=last.ma5?pct(last.close,last.ma5):null;
  if(ma5Gap!==null&&Math.abs(ma5Gap)<=2.5){score+=4;reasons.push(`5일선과 ${ma5Gap.toFixed(1)}%`);}
  if(last.ma20&&a[i-8].ma20&&last.ma20>=a[i-8].ma20!){score+=3;reasons.push('20일선 8거래일 전보다 상승');}
  if(last.ma5&&a[i-3].ma5&&last.ma5>a[i-3].ma5!){score+=3;reasons.push('5일선 우상향');}
  const low=localLowScore(a,i); if(low.score){score+=low.score;reasons.push(low.reason);}

  const today=last.ret??0;
  if(today<=3&&today>=-5){score+=6;reasons.push('오늘 아직 과열되지 않은 가격대');}
  else if(today<=p.maxTodayRise){score+=3;}
  else {riskPenalty+=today>=10?18:10;risks.push(`오늘 +${today.toFixed(1)}%로 이미 상승폭 큼`);}

  const ret5=i>=5?pct(last.close,a[i-5].close):0;
  if(ret5>=20){riskPenalty+=10;risks.push(`최근 5일 +${ret5.toFixed(1)}% 급등`);}
  if(ma20Gap!==null&&ma20Gap>15){riskPenalty+=8;risks.push(`20일선 대비 +${ma20Gap.toFixed(1)}% 이격`);}

  const hist=historicalValidation(a,p); if(hist.bonus){score+=hist.bonus;reasons.push(`과거 유사패턴 ${hist.samples}회 중 3일내 +5% 도달 ${hist.hits}회`);}
  const technicalScore=Math.max(0,Math.min(70,Math.round(score-riskPenalty)));
  const stage=technicalScore>=55?'기술 강':'기술 후보';
  const spike=si>=0?a[si]:null;
  const pullbackDays=si>=0?i-si:null;
  const pullbackPct=si>=0?pct(last.close,a[si].close):null;
  const contraction=si>=0&&i>si?avg(a.slice(si+1,i+1).map(x=>x.volume))/Math.max(1,a[si].volume):null;
  return {
    ...stock,technicalScore,riskPenalty,stage,reasons:reasons.slice(0,8),risks,
    date:last.date,currentPrice:last.close,changePct:last.ret,volumeRatio:last.volRatio,ma5:last.ma5,ma20:last.ma20,ma60:last.ma60,ma20Gap,
    spikeDate:spike?.date??null,spikeRet:spike?.ret??null,spikeVolRatio:spike?.volRatio??null,pullbackDays,pullbackPct,volumeContraction:contraction,
    patternSamples:hist.samples,patternHits:hist.hits,patternHitRate:hist.hitRate,bars:a.slice(-35)
  };
}

const themes:[RegExp,string][]=[
  [/양자|양자암호|PQC/i,'양자·보안'],[/보안|사이버|암호/i,'보안'],[/스페이스X|우주|위성|발사체|NASA/i,'우주·위성'],[/HBM|DRAM|NAND|반도체|웨이퍼|패키징|전공정|후공정/i,'반도체'],[/로봇|휴머노이드|AMR|자동화/i,'로봇'],[/AI|인공지능|LLM|데이터센터/i,'AI'],[/원전|SMR|원자력/i,'원전'],[/방산|미사일|잠수함|군용|국방/i,'방산'],[/바이오|신약|임상|FDA|희귀질환/i,'바이오'],[/전력|변압기|전력망|ESS/i,'전력'],[/2차전지|배터리|리튬|양극재|음극재/i,'2차전지']
];
const positive=[/자사주.*취득/i,/공급계약|수주|계약 체결/i,/국책과제|주관기관|선정/i,/승인|허가|FDA/i,/흑자전환|실적 개선|상향/i,/증설|투자 결정/i,/공동연구|공동개발|파트너십|협력/i,/신제품|양산|출하 회복/i,/목표주가.*상향/i,/AI|양자|우주|반도체|로봇|방산|원전/i];
const negative=[/유상증자|무상감자|감자 결정/i,/전환사채|CB 발행|BW 발행/i,/불성실공시|소송|횡령|배임/i,/적자전환|실적 부진|목표주가.*하향/i,/최대주주.*매도|대주주.*매도/i];

function parseKst(s:string){
  const m=s.match(/(20\d{2})[.\-/](\d{2})[.\-/](\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if(!m)return null;
  const iso=`${m[1]}-${m[2]}-${m[3]}T${m[4]||'12'}:${m[5]||'00'}:00+09:00`;
  const d=new Date(iso); return Number.isNaN(d.getTime())?null:d;
}
function absolute(href:string){if(!href)return '';if(href.startsWith('http'))return href;return `https://finance.naver.com${href.startsWith('/')?'':'/'}${href}`;}

async function scrapeRows(url:string,kind:'news'|'notice'){
  const html=await fetchText(url); const $=cheerio.load(html); const out:{title:string;date:string;url:string;kind:string}[]=[];
  $('tr').each((_,tr)=>{
    const text=$(tr).text().replace(/\s+/g,' ').trim();
    const dm=text.match(/20\d{2}[.\-/]\d{2}[.\-/]\d{2}(?:\s+\d{2}:\d{2})?/);
    if(!dm)return;
    let a=$(tr).find('a').filter((_,el)=>{const h=$(el).attr('href')||'';return kind==='news'?/news_read|article|news/i.test(h):/notice|dart|kind/i.test(h);}).first();
    if(!a.length)a=$(tr).find('a').filter((_,el)=>$(el).text().trim().length>=6).first();
    const title=a.text().replace(/\s+/g,' ').trim(); if(title.length<5)return;
    out.push({title,date:dm[0],url:absolute(a.attr('href')||''),kind});
  });
  return out;
}

export async function fetchCatalyst(code:string){
  const [news,notice]=await Promise.allSettled([
    scrapeRows(`https://finance.naver.com/item/news_news.naver?code=${code}&page=1`,'news'),
    scrapeRows(`https://finance.naver.com/item/news_notice.naver?code=${code}&page=1`,'notice')
  ]);
  const items=[...(news.status==='fulfilled'?news.value:[]),...(notice.status==='fulfilled'?notice.value:[])];
  const uniq=[...new Map(items.map(x=>[`${x.date}|${x.title}`,x])).values()];
  const now=Date.now(), fresh=uniq.filter(x=>{const d=parseKst(x.date);return !d||now-d.getTime()<=72*3600_000;});
  let catalystScore=0,catalystRisk=0; const reasons:string[]=[]; const foundThemes=new Set<string>();
  for(const it of fresh){
    for(const [re,t] of themes)if(re.test(it.title))foundThemes.add(t);
    const pos=positive.some(re=>re.test(it.title)); const neg=negative.some(re=>re.test(it.title));
    if(pos){catalystScore+=it.kind==='notice'?9:6; if(reasons.length<4)reasons.push(`${it.kind==='notice'?'공시':'뉴스'}: ${it.title}`);}
    if(neg)catalystRisk+=it.kind==='notice'?10:7;
    const d=parseKst(it.date); if(d){const kstHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hour12:false}).format(d)); if(kstHour>=15&&it.kind==='notice')catalystScore+=6;}
  }
  if(fresh.length>=2)catalystScore+=2;
  if(foundThemes.size)catalystScore+=Math.min(4,foundThemes.size*2);
  catalystScore=Math.min(30,catalystScore);
  catalystRisk=Math.min(20,catalystRisk);
  return {catalystScore,catalystRisk,catalystReasons:reasons,themes:[...foundThemes],items:fresh.slice(0,6)};
}
