'use client';
import {useEffect,useRef,useState} from 'react';

type Config={lookback:number;priorSpikePct:number;priorVolumeRatio:number;holdPct:number;repeatRisePct:number;todayMinPct:number;todayMaxPct:number;todayVolumeRatio:number;nearHighPct:number;breakoutDistancePct:number;max5DayRisePct:number;maGapPct:number;minPrice:number;minScore:number};
type ThemeStat={theme:string;power:number;bonus:number;count:number;lateCount:number;avgToday:number;avgScore:number};
const DEFAULT:Config={lookback:7,priorSpikePct:8,priorVolumeRatio:3.5,holdPct:55,repeatRisePct:4,todayMinPct:-2,todayMaxPct:5,todayVolumeRatio:1.1,nearHighPct:5,breakoutDistancePct:8,max5DayRisePct:12,maGapPct:7,minPrice:1000,minScore:58};
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const themes=(s:any)=>String(s||'기타').split('·').map((x:string)=>x.trim()).filter(Boolean);
function isLate(r:any){const m=r?.metrics;return !!m&&r.dataStatus==='ok'&&m.maxSpike240Pct>=8&&m.ret5<=12&&m.ret5>=-15&&m.todayPct<=5&&m.todayPct>=-4&&m.ma20DistancePct<=12;}
function scoreThemes(input:any[]){
  const map=new Map<string,any[]>();
  input.filter((x:any)=>x.dataStatus==='ok'&&x.theme).forEach((r:any)=>themes(r.theme).forEach((t:string)=>{if(t==='기타')return;const a=map.get(t)||[];a.push(r);map.set(t,a);}));
  const stats:ThemeStat[]=[];
  map.forEach((rs:any[],theme:string)=>{const top=[...rs].sort((a:any,b:any)=>(b.score||0)-(a.score||0)).slice(0,6);const avgScore=top.reduce((s:number,x:any)=>s+(x.score||0),0)/Math.max(1,top.length);const avgToday=top.reduce((s:number,x:any)=>s+(x.metrics?.todayPct||0),0)/Math.max(1,top.length);const lateCount=rs.filter(isLate).length;const power=clamp(avgScore+Math.min(rs.length,6)*2.5+Math.min(lateCount,5)*3+clamp(avgToday,-2,4)*1.5,0,100);stats.push({theme,power,bonus:clamp((power-52)/2.4,0,18),count:rs.length,lateCount,avgToday,avgScore});});
  const sm=new Map<string,ThemeStat>();stats.forEach(x=>sm.set(x.theme,x));
  return input.map((r:any)=>{let best:ThemeStat|undefined;themes(r.theme).forEach((t:string)=>{const z=sm.get(t);if(z&&(!best||z.power>best.power))best=z;});const themeBonus=best?.bonus||0;const finalScore=clamp((r.score||0)+themeBonus+clamp((r.newsScore||0)*.35,0,6)+clamp((r.supplyScore||0)*.3,0,4),0,100);return {...r,themePower:best?.power||0,themeBonus,finalScore};}).sort((a:any,b:any)=>(b.finalScore||0)-(a.finalScore||0));
}

export default function AgentPage(){
  const tokenRef=useRef('');
  const busyRef=useRef(false);
  const [status,setStatus]=useState('AI Radar bridge ready');

  useEffect(()=>{
    const reply=(e:MessageEvent,payload:any)=>{try{(e.source as Window|null)?.postMessage(payload,e.origin)}catch{}};
    const api=async(url:string,init:RequestInit={})=>{
      const h=new Headers(init.headers||{});h.set('Authorization','Bearer '+tokenRef.current);
      const r=await fetch(url,{...init,headers:h,cache:'no-store'});const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j;
    };
    const run=async()=>{
      if(!tokenRef.current)throw new Error('브리지 인증 토큰이 없습니다.');
      if(busyRef.current)throw new Error('이미 분석 중입니다.');
      busyRef.current=true;setStatus('KOSPI 500 + KOSDAQ 300 수집 중…');
      try{
        const uj=await api('/api/universe?kospi=500&kosdaq=300');const stocks:any[]=Array.isArray(uj.stocks)?uj.stocks:[];
        if(!stocks.length)throw new Error('분석할 종목이 없습니다.');
        let all:any[]=[];const batch=24,wave=2;
        for(let i=0;i<stocks.length;i+=batch*wave){
          setStatus('전종목 분석 '+Math.min(stocks.length,i+batch*wave)+' / '+stocks.length);
          const packs:Promise<any>[]=[];
          for(let w=0;w<wave;w++){const part=stocks.slice(i+w*batch,i+(w+1)*batch);if(part.length)packs.push(api('/api/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stocks:part,config:DEFAULT})}));}
          const settled=await Promise.allSettled(packs);settled.forEach(x=>{if(x.status==='fulfilled'&&Array.isArray(x.value.results))all.push(...x.value.results);});
        }
        let scored=scoreThemes(all);
        const top=scored.filter((x:any)=>x.dataStatus==='ok').sort((a:any,b:any)=>(b.score||0)-(a.score||0)).slice(0,120);
        for(let i=0;i<top.length;i+=20){
          setStatus('뉴스·수급·테마 보강 '+Math.min(top.length,i+20)+' / '+top.length);
          const pack=top.slice(i,i+20);
          const [pj,nj]=await Promise.allSettled([
            api('/api/profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stocks:pack})}),
            api('/api/enrich',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({stocks:pack})})
          ]);
          const pm=new Map<string,any>(),nm=new Map<string,any>();
          if(pj.status==='fulfilled')for(const x of pj.value.results||[])pm.set(String(x.code),x);
          if(nj.status==='fulfilled')for(const x of nj.value.results||[])nm.set(String(x.code),x);
          scored=scored.map((x:any)=>{const pp=pm.get(String(x.code)),nn=nm.get(String(x.code));return {...x,sector:pp?.sector??x.sector,theme:pp?.theme??x.theme,newsScore:nn?.newsScore??x.newsScore,supplyScore:nn?.supplyScore??x.supplyScore,newsReasons:nn?.newsReasons??x.newsReasons,supplyReasons:nn?.supplyReasons??x.supplyReasons,news:nn?.news??x.news};});
          scored=scoreThemes(scored);
        }
        const out=scored.filter(isLate).sort((a:any,b:any)=>(b.finalScore||0)-(a.finalScore||0)).slice(0,200);
        setStatus('완료 · '+out.length+'종목');return out;
      }finally{busyRef.current=false}
    };

    const onMessage=async(e:MessageEvent)=>{
      const d=e.data||{};
      if(d.type==='AI_RADAR_AGENT_AUTH'&&d.token){tokenRef.current=String(d.token);return;}
      if(d.type==='AI_RADAR_AGENT_PING'){if(tokenRef.current)reply(e,{type:'AI_RADAR_AGENT_PONG',requestId:d.requestId||''});return;}
      if(d.type!=='AI_RADAR_AGENT_RUN')return;
      try{const rows=await run();reply(e,{type:'AI_RADAR_AGENT_RESULT',requestId:d.requestId||'',rows});}
      catch(err){reply(e,{type:'AI_RADAR_AGENT_ERROR',requestId:d.requestId||'',error:err instanceof Error?err.message:'레이더 실행 실패'});}
    };
    window.addEventListener('message',onMessage);return()=>window.removeEventListener('message',onMessage);
  },[]);

  return <main style={{minHeight:'100vh',background:'#07111f',color:'#d9ecff',fontFamily:'system-ui',display:'grid',placeItems:'center',padding:24}}><div style={{maxWidth:560,border:'1px solid #284665',borderRadius:18,padding:22,background:'#0e1b2d'}}><b>유행 테마 후발주 · AI Agent Bridge</b><p style={{color:'#8ea6bf',lineHeight:1.6}}>{status}</p><small style={{color:'#6f8aa4'}}>통합 지휘실에서 자동 호출되는 전용 연결 페이지입니다.</small></div></main>;
}
