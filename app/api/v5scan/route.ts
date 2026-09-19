import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchYahooBars, type UniverseStock, type Bar } from '@/lib/market';
import { backtestBars, chartScore, priceReturns, volumeScore, type SpikeThresholds } from '@/lib/scoring';

export const runtime='nodejs';
export const maxDuration=60;

const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n));
const pct=(a:number,b:number)=>b?((a/b)-1)*100:0;
const sma=(bars:Bar[],n:number,i=bars.length-1)=>i+1<n?null:avg(bars.slice(i-n+1,i+1).map(x=>x.close));
const dateRe=/^\d{4}-\d{2}-\d{2}$/;

function rsi14(bars:Bar[],idx=bars.length-1){
  if(idx<15)return 50;
  let gain=0,loss=0;
  for(let i=idx-13;i<=idx;i++){
    const d=bars[i].close-bars[i-1].close;
    if(d>=0)gain+=d; else loss-=d;
  }
  if(loss===0)return 100;
  const rs=(gain/14)/(loss/14);
  return 100-(100/(1+rs));
}

function ema(values:number[],period:number){
  if(!values.length)return [] as number[];
  const k=2/(period+1); const out=[values[0]];
  for(let i=1;i<values.length;i++)out.push(values[i]*k+out[i-1]*(1-k));
  return out;
}

function macdHistogram(bars:Bar[]){
  const closes=bars.slice(-90).map(x=>x.close);
  const e12=ema(closes,12),e26=ema(closes,26);
  const macd=closes.map((_,i)=>e12[i]-e26[i]);
  const sig=ema(macd,9);
  return macd.at(-1)!-sig.at(-1)!;
}

function obvSlope(bars:Bar[]){
  const x=bars.slice(-22); if(x.length<8)return 0;
  let obv=0; const arr:number[]=[];
  for(let i=1;i<x.length;i++){
    obv+=x[i].close>x[i-1].close?x[i].volume:x[i].close<x[i-1].close?-x[i].volume:0;
    arr.push(obv);
  }
  const a=avg(arr.slice(-3)),b=avg(arr.slice(-8,-5));
  const denom=Math.max(1,avg(arr.map(v=>Math.abs(v))));
  return (a-b)/denom;
}

function currentTechnicalPercent(bars:Bar[]){
  const v=volumeScore(bars),c=chartScore(bars); const r=priceReturns(bars);
  const quiet=clamp(100-Math.max(0,r.r1-1)*10-Math.max(0,r.r5-4)*5);
  return clamp((v.score/25)*35+(c.score/15)*35+quiet*.30);
}

function historicalSimilarity(events:any[],bars:Bar[]){
  if(!events.length)return {pct:0,score:0,patterns:[] as number[]};
  const cur=currentTechnicalPercent(bars);
  const patterns=events.map(e=>{
    const vals:[number,number][]=[[e.d10?.score,0.15],[e.d5?.score,0.22],[e.d3?.score,0.28],[e.d1?.score,0.35]];
    let s=0,w=0; for(const [v,ww] of vals){if(typeof v==='number'){s+=v*ww;w+=ww;}}
    const base=w?s/w:0; const lead=(e.leads?.volume?4:0)+(e.leads?.chart?3:0);
    return clamp(base+lead);
  }).filter(Number.isFinite);
  const sims=patterns.map(p=>clamp(100-Math.abs(cur-p))).sort((a,b)=>b-a);
  const best=avg(sims.slice(0,Math.min(3,sims.length)));
  return {pct:+best.toFixed(1),score:+(best*.15).toFixed(1),patterns:patterns.slice(-6)};
}

function scoreNow(bars:Bar[],events:any[]){
  const r=priceReturns(bars),v=volumeScore(bars),c=chartScore(bars);
  const idx=bars.length-1,last=bars[idx];
  const m5=sma(bars,5),m5p=sma(bars,5,idx-3),m20=sma(bars,20),m20p=sma(bars,20,idx-8),m60=sma(bars,60);
  const rr=rsi14(bars),mh=macdHistogram(bars),obv=obvSlope(bars);
  const reasons:string[]=[];

  const volumeEarly=+(v.score/25*20).toFixed(1);
  reasons.push(...v.reasons);

  let quietPrice=10;
  if(r.r1>=3)quietPrice-=Math.min(6,(r.r1-3)*1.5);
  if(r.r5>=8)quietPrice-=Math.min(6,(r.r5-8)*.8);
  if(r.r1<3&&r.r5<8)reasons.push(`가격 미반영 구간 · 1일 ${r.r1.toFixed(1)}% / 5일 ${r.r5.toFixed(1)}%`);
  quietPrice=+clamp(quietPrice,0,10).toFixed(1);

  let maStructure=0;
  if(m5&&m5p&&m5>m5p){maStructure+=3;reasons.push('5일선 우상향');}
  if(m20&&m20p&&m20>m20p){maStructure+=3;reasons.push('20일선 상승');}
  if(m5&&m20&&last.close>=m5&&m5>=m20)maStructure+=2;
  if(c.score>=5)maStructure+=2;
  maStructure=Math.min(10,maStructure);

  let convergence=0; let maGap:number|null=null;
  if(m20&&m60){
    maGap=Math.abs(m20-m60)/m60*100;
    if(maGap<=1.5)convergence=8; else if(maGap<=2.5)convergence=6; else if(maGap<=4)convergence=4; else if(maGap<=6)convergence=2;
    if(convergence)reasons.push(`20·60일선 간격 ${maGap.toFixed(1)}%`);
  }

  let momentum=0;
  if(rr>=45&&rr<=67){momentum+=2;reasons.push(`RSI ${rr.toFixed(0)} · 과열 전 구간`);}
  if(mh>0){momentum+=2;reasons.push('MACD 히스토그램 양전환/양수');}
  if(obv>0){momentum+=2;reasons.push('OBV 최근 흐름 상승');}
  if(rr<72)momentum+=1;
  momentum=Math.min(7,momentum);

  const hist=historicalSimilarity(events,bars);
  if(hist.pct>=70)reasons.push(`과거 급등 직전 패턴 유사도 ${hist.pct.toFixed(0)}%`);

  let runPenalty=0; const penaltyReasons:string[]=[];
  if(r.r1>=10){runPenalty-=30;penaltyReasons.push('당일 +10% 이상: 이미 급등');}
  else if(r.r1>=7){runPenalty-=22;penaltyReasons.push('당일 +7% 이상: 추격 구간');}
  else if(r.r1>=5){runPenalty-=12;penaltyReasons.push('당일 +5% 이상: 일부 반영');}
  else if(r.r1>=3){runPenalty-=5;penaltyReasons.push('당일 +3% 이상: 선행성 약화');}
  if(r.r5>=20){runPenalty-=15;penaltyReasons.push('5일 +20% 이상: 단기 과열');}
  else if(r.r5>=12){runPenalty-=9;penaltyReasons.push('5일 +12% 이상: 상승 상당부분 반영');}

  let fakeoutRisk=0; const riskReasons:string[]=[];
  if(rr>=75){fakeoutRisk+=20;riskReasons.push('RSI 과열');}
  if(m20&&last.close>m20*1.12){fakeoutRisk+=18;riskReasons.push('20일선 대비 과도한 이격');}
  if(v.ratio>=4&&m20&&last.close<m20){fakeoutRisk+=25;riskReasons.push('대량 거래량에도 20일선 아래');}
  if(m5&&m5p&&m5<m5p&&v.ratio>=2){fakeoutRisk+=18;riskReasons.push('거래량 증가 중 5일선 하락');}
  if(r.r1>=7)fakeoutRisk+=20;
  fakeoutRisk=Math.min(100,fakeoutRisk);
  const fakeoutPenalty=-Math.round(fakeoutRisk*.10);

  const quantScore=volumeEarly+quietPrice+maStructure+convergence+momentum+hist.score;
  const preSpikeEligible=r.r1<5&&r.r3<10&&r.r5<12;

  return {
    currentPrice:last.close,changePct:r.r1,ret3:r.r3,ret5:r.r5,ret20:r.r20,
    volumeRatio:+v.ratio.toFixed(2),rsi:+rr.toFixed(1),maGap:maGap===null?null:+maGap.toFixed(2),
    volumeEarly,quietPrice,maStructure,convergence,momentum,historySimilarity:hist.score,historySimilarityPct:hist.pct,
    quantScore:+quantScore.toFixed(1),runPenalty,fakeoutRisk,fakeoutPenalty,preSpikeEligible,
    reasons:[...reasons,...penaltyReasons],riskReasons
  };
}

async function one(stock:UniverseStock,period:number,t:SpikeThresholds,startDate?:string,endDate?:string){
  try{
    const customRange=Boolean(startDate&&endDate);
    const spanDays=customRange?Math.ceil((new Date(`${endDate}T00:00:00Z`).getTime()-new Date(`${startDate}T00:00:00Z`).getTime())/86400000)+1:0;
    const approxTradingDays=Math.ceil(spanDays*0.72);
    const need=Math.max(300,period+140,customRange?approxTradingDays+180:0);
    const bars=await fetchYahooBars(stock.code,stock.market,need);
    const allEvents=backtestBars(bars,t);
    const cutoff=bars[Math.max(0,bars.length-period)]?.date||'0000-00-00';
    const events=(customRange
      ?allEvents.filter((e:any)=>e.date>=startDate!&&e.date<=endDate!)
      :allEvents.filter((e:any)=>e.date>=cutoff)
    ).slice(-80);
    const now=scoreNow(bars,events);
    return {
      ...stock,...now,dataStatus:'ok',detectedAt:new Date().toISOString(),spikeCount:events.length,
      searchStartDate:customRange?startDate:null,searchEndDate:customRange?endDate:null,searchMode:customRange?'date-range':'trading-days',
      lastSpikeDate:events.at(-1)?.date||null,lastSpikePct:events.at(-1)?.spikePct??null,
      spikeDates:events.map((e:any)=>({date:e.date,pct:+Number(e.spikePct||0).toFixed(2)}))
    };
  }catch(e){
    return {...stock,dataStatus:'error',error:e instanceof Error?e.message:'가격 수집 실패',spikeCount:0,spikeDates:[]};
  }
}

export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  const body=await req.json().catch(()=>null);
  const stocks:UniverseStock[]=body?.stocks||[];
  const period=Math.max(30,Math.min(240,Number(body?.period??180)));
  const startDate=typeof body?.startDate==='string'&&dateRe.test(body.startDate)?body.startDate:undefined;
  const endDate=typeof body?.endDate==='string'&&dateRe.test(body.endDate)?body.endDate:undefined;
  const customRange=Boolean(startDate&&endDate);
  if((body?.startDate||body?.endDate)&&!customRange)return NextResponse.json({error:'시작일과 종료일을 모두 올바르게 입력해 주세요.'},{status:400});
  if(customRange&&startDate!>endDate!)return NextResponse.json({error:'시작일은 종료일보다 앞선 날짜여야 합니다.'},{status:400});
  if(customRange){
    const span=Math.ceil((new Date(`${endDate}T00:00:00Z`).getTime()-new Date(`${startDate}T00:00:00Z`).getTime())/86400000)+1;
    if(span>1096)return NextResponse.json({error:'직접 날짜 검색 구간은 최대 3년까지 선택할 수 있습니다.'},{status:400});
  }
  const t:SpikeThresholds={d1:Math.max(3,Math.min(30,Number(body?.spikePct??10))),d3:99,d5:99,d10:99};
  if(!Array.isArray(stocks)||stocks.length>12)return NextResponse.json({error:'한 번에 최대 12종목까지 분석합니다.'},{status:400});
  const out:any[]=[];
  for(let i=0;i<stocks.length;i+=4)out.push(...await Promise.all(stocks.slice(i,i+4).map(s=>one(s,period,t,startDate,endDate))));
  return NextResponse.json({results:out,period,spikePct:t.d1,startDate:startDate||null,endDate:endDate||null,searchMode:customRange?'date-range':'trading-days'});
}
