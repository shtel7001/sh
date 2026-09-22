import {NextResponse} from 'next/server';
import {analyzeDaily,type Settings} from '@/lib/pattern';
import {fetchDailyBars} from '@/lib/market';
export const runtime='nodejs';
export const maxDuration=30;

const settings:Settings={searchDays:40,downtrendDays:150,near20Pct:4,minDeclinePct:8,minNegativeMa20Ratio:50,minDowntrendR2:.05,requireStepDown:true,requireMa5Above20Now:true};
function synthetic(){
  const bars:any[]=[];let p=100000;
  for(let i=0;i<170;i++){p*=.9975;bars.push({date:new Date(2025,0,i+1).toISOString(),open:p,high:p*1.01,low:p*.99,close:p,volume:100000+i});}
  for(let i=0;i<18;i++){p*=1.012;bars.push({date:new Date(2025,6,i+1).toISOString(),open:p*.995,high:p*1.01,low:p*.99,close:p,volume:160000+i});}
  for(let i=0;i<9;i++){p*=.996;bars.push({date:new Date(2025,7,i+1).toISOString(),open:p*1.002,high:p*1.008,low:p*.992,close:p,volume:120000+i});}
  return analyzeDaily(bars,settings);
}
export async function GET(){
  const syn=synthetic();let live:any={ok:false};
  try{const f=await fetchDailyBars('120110','KOSPI','yahoo',240);live={ok:f.bars.length>=150,source:f.source,bars:f.bars.length,last:f.bars.at(-1)?.date}}catch(e){live={ok:false,error:e instanceof Error?e.message:'live fetch failed'}}
  return NextResponse.json({ok:!!syn.crossPass&&live.ok,synthetic:{pass:syn.pass,crossPass:syn.crossPass,downtrendPass:syn.downtrendPass,near20Pass:syn.near20Pass,score:syn.score},live,ts:new Date().toISOString()});
}
