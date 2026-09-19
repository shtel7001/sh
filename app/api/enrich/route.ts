import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchInvestorFlow, type UniverseStock } from '@/lib/market';

export const runtime='nodejs';
export const maxDuration=60;

type FlowRow={date:string;inst:number;foreign:number};
const sum=(a:number[])=>a.reduce((x,y)=>x+y,0);

function scoreFlow(rows:FlowRow[]|null){
  if(!rows?.length)return {score:null,reasons:['기관·외국인 수급 데이터 없음'],flow:[]};
  const a=[...rows].reverse();
  const r3=a.slice(-3),r5=a.slice(-5),r10=a.slice(-10);
  const fp5=r5.filter(x=>x.foreign>0).length,ip5=r5.filter(x=>x.inst>0).length;
  const f5=sum(r5.map(x=>x.foreign)),i5=sum(r5.map(x=>x.inst));
  const f10=sum(r10.map(x=>x.foreign)),i10=sum(r10.map(x=>x.inst));
  const both5=r5.filter(x=>x.foreign>0&&x.inst>0).length;
  const f3=sum(r3.map(x=>x.foreign)),i3=sum(r3.map(x=>x.inst));
  const prevF=sum(r10.slice(-6,-3).map(x=>x.foreign));
  const prevI=sum(r10.slice(-6,-3).map(x=>x.inst));
  let s=0; const reasons:string[]=[];

  if(fp5>=4){s+=6;reasons.push(`최근 5일 외국인 순매수 ${fp5}일`);}
  else if(fp5>=3){s+=4;reasons.push(`최근 5일 외국인 순매수 ${fp5}일`);}
  if(ip5>=4){s+=6;reasons.push(`최근 5일 기관 순매수 ${ip5}일`);}
  else if(ip5>=3){s+=4;reasons.push(`최근 5일 기관 순매수 ${ip5}일`);}

  if(f5>0){s+=4;reasons.push(`외국인 5일 누적 순매수 ${Math.round(f5).toLocaleString('ko-KR')}주`);}
  if(i5>0){s+=4;reasons.push(`기관 5일 누적 순매수 ${Math.round(i5).toLocaleString('ko-KR')}주`);}
  if(f10>0){s+=2;reasons.push('외국인 10일 누적 수급도 순매수');}
  if(i10>0){s+=2;reasons.push('기관 10일 누적 수급도 순매수');}
  if(r3.length===3&&r3.every(x=>x.foreign>0)){s+=2;reasons.push('외국인 3일 연속 순매수');}
  if(r3.length===3&&r3.every(x=>x.inst>0)){s+=2;reasons.push('기관 3일 연속 순매수');}
  if(both5>=2){s+=3;reasons.push(`최근 5일 기관·외국인 동시 순매수 ${both5}일`);}
  if(f3>0&&f3>Math.max(prevF,0)*1.25){s+=2;reasons.push('외국인 최근 3일 매수 강도 가속');}
  if(i3>0&&i3>Math.max(prevI,0)*1.25){s+=2;reasons.push('기관 최근 3일 매수 강도 가속');}

  return {score:Math.min(35,s),reasons,flow:rows.slice(0,10)};
}

export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  const body=await req.json().catch(()=>null);
  const stocks:UniverseStock[]=body?.stocks||[];
  if(!Array.isArray(stocks)||stocks.length>20)return NextResponse.json({error:'최대 20종목'},{status:400});
  const results:any[]=[];
  for(let i=0;i<stocks.length;i+=5){
    const part=stocks.slice(i,i+5);
    const rr=await Promise.all(part.map(async s=>{
      const flow=await fetchInvestorFlow(s.code);
      const scored=scoreFlow(flow);
      return {code:s.code,flowScore:scored.score,flowReasons:scored.reasons,flow:scored.flow};
    }));
    results.push(...rr);
  }
  return NextResponse.json({results});
}
