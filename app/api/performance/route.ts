import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/guard';
import { fetchYahooBars } from '@/lib/market';
export const runtime='nodejs'; export const maxDuration=60;
export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();const {detections=[]}=await req.json().catch(()=>({detections:[]}));if(!Array.isArray(detections)||detections.length>25)return NextResponse.json({error:'최대 25건'},{status:400});
  const out=[];for(const d of detections){try{const bars=await fetchYahooBars(d.code,d.market,220);const i=bars.findIndex(b=>b.date>=d.date);if(i<0)continue;const base=Number(d.price)||bars[i].close;const row:any={...d};for(const h of [1,3,5,10,20]){const slice=bars.slice(i+1,i+1+h);if(slice.length<h)continue;row[`r${h}`]=(slice[h-1].close/base-1)*100;row[`mfe${h}`]=(Math.max(...slice.map(x=>x.high))/base-1)*100;row[`mae${h}`]=(Math.min(...slice.map(x=>x.low))/base-1)*100;row[`hit5_${h}`]=row[`mfe${h}`]>=5;row[`hit10_${h}`]=row[`mfe${h}`]>=10;row[`hit15_${h}`]=row[`mfe${h}`]>=15;}out.push(row);}catch{out.push({...d,error:'성과 데이터 수집 실패'});}}
  return NextResponse.json({results:out});
}
