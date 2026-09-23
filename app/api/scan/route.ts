import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchYahooBars, type UniverseStock, type Bar } from '@/lib/market';
export const runtime='nodejs'; export const maxDuration=60;

type Params={lookback:number;spikePct:number;volRatio:number;waitDays:number;mode:'strict'|'relaxed';maxAfterSpike:number;ma20Distance:number;pullbackMin:number;pullbackMax:number};
function avg(a:number[]){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null}
function calc(bars:Bar[]){return bars.map((b,i)=>{const prev=i?bars[i-1].close:null;const ret=prev?((b.close/prev)-1)*100:null;const ma5=i>=4?avg(bars.slice(i-4,i+1).map(x=>x.close)):null;const ma20=i>=19?avg(bars.slice(i-19,i+1).map(x=>x.close)):null;const ma60=i>=59?avg(bars.slice(i-59,i+1).map(x=>x.close)):null;const priorVol=i>=20?avg(bars.slice(i-20,i).map(x=>x.volume)):null;const vr=priorVol&&priorVol>0?b.volume/priorVol:null;return {...b,ret,ma5,ma20,ma60,volRatio:vr};});}
function analyze(bars:Bar[],p:Params){
 const a=calc(bars); const last=a.length-1; if(last<25)return null; const start=Math.max(20,last-p.lookback+1); const spikes:number[]=[];
 for(let i=start;i<last;i++) if((a[i].ret??-999)>=p.spikePct && (a[i].volRatio??0)>=p.volRatio)spikes.push(i);
 if(!spikes.length)return {stage:'none',reason:'최근 검색구간에 대량거래 급등 없음',latest:a[last],bars:a.slice(-25)};
 for(const si of [...spikes].reverse()){
   if(last-si>p.maxAfterSpike)continue;
   let age=0, first=-1, patternOk=false;
   if(p.mode==='strict'){
     let i=last; while(i>si && a[i].ma5 && a[i].close<a[i].ma5!){i--;}
     first=i+1; age=last-first+1; patternOk=age>0;
   }else{
     const latestBelow=!!a[last].ma5 && a[last].close<a[last].ma5!;
     if(!latestBelow)continue;
     const minPivot=Math.max(si+1,last-(p.waitDays+3));
     for(let j=last-1;j>=minPivot;j--){
       const seq=a.slice(j,last+1); const downTail=seq.slice(1).every(x=>(x.ret??0)<=1.0); const hasDown=seq.slice(1).some(x=>(x.ret??0)<-0.15);
       const pivotOk=(a[j].ret??-999)>=-0.2 && !!a[j].ma5 && a[j].close<=a[j].ma5!*1.06;
       const near5=seq.filter(x=>x.ma5&&x.close<=x.ma5!*1.035).length>=Math.max(1,seq.length-1);
       if(pivotOk&&downTail&&hasDown&&near5){first=j;age=last-j+1;patternOk=true;break;}
     }
   }
   if(!patternOk||first<0)continue;
   const pullback=((a[last].close/a[si].close)-1)*100;
   const ma20gap=a[last].ma20?((a[last].close/a[last].ma20!)-1)*100:null;
   const structureOk=pullback>=p.pullbackMin&&pullback<=p.pullbackMax&&(ma20gap===null||Math.abs(ma20gap)<=p.ma20Distance);
   const stage=age===p.waitDays&&structureOk?'buy':age<p.waitDays?'wait':age>p.waitDays&&age<=p.waitDays+2?'late':'none';
   const score=Math.max(0,Math.min(100,Math.round(55+Math.min(20,(a[si].volRatio??0)*2)+Math.min(12,(a[si].ret??0)*.7)+Math.max(0,8-Math.abs(ma20gap??8))-(age>p.waitDays?8:0))));
   return {stage,structureOk,age,belowCount:a.slice(first,last+1).filter(x=>x.ma5&&x.close<x.ma5!).length,spikeDate:a[si].date,spikeRet:a[si].ret,spikeVolume:a[si].volume,spikeVolRatio:a[si].volRatio,firstBelowDate:a[first].date,signalDate:a[last].date,signalClose:a[last].close,ma5:a[last].ma5,ma20:a[last].ma20,ma60:a[last].ma60,ma20Gap:ma20gap,pullback,score,latest:a[last],bars:a.slice(-25)};
 }
 return {stage:'none',reason:'급등 이후 5일선 하회 구조 불일치',latest:a[last],bars:a.slice(-25)};
}
async function one(stock:UniverseStock,p:Params){try{const bars=await fetchYahooBars(stock.code,'KOSPI',Math.max(100,p.lookback+80));const sig=analyze(bars,p);return {...stock,...sig,dataStatus:'ok'};}catch(e){return {...stock,stage:'error',dataStatus:'error',error:e instanceof Error?e.message:'가격 수집 실패'};}}
export async function POST(req:Request){
 if(!await isAuthed())return unauthorized(); const b=await req.json().catch(()=>({})); const stocks:UniverseStock[]=Array.isArray(b?.stocks)?b.stocks:[];
 if(!stocks.length||stocks.length>24)return NextResponse.json({error:'한 번에 1~24종목을 전송하세요.'},{status:400});
 const p:Params={lookback:Math.max(10,Math.min(60,Number(b?.params?.lookback??20))),spikePct:Math.max(2,Math.min(30,Number(b?.params?.spikePct??7))),volRatio:Math.max(1.2,Math.min(30,Number(b?.params?.volRatio??3))),waitDays:Math.max(2,Math.min(7,Number(b?.params?.waitDays??3))),mode:b?.params?.mode==='strict'?'strict':'relaxed',maxAfterSpike:Math.max(3,Math.min(30,Number(b?.params?.maxAfterSpike??15))),ma20Distance:Math.max(1,Math.min(30,Number(b?.params?.ma20Distance??10))),pullbackMin:Math.max(-50,Math.min(0,Number(b?.params?.pullbackMin??-25))),pullbackMax:Math.max(-5,Math.min(30,Number(b?.params?.pullbackMax??8)))};
 const out:any[]=[]; for(let i=0;i<stocks.length;i+=6)out.push(...await Promise.all(stocks.slice(i,i+6).map(s=>one(s,p))));
 return NextResponse.json({results:out,params:p});
}
