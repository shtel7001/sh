export type WeightKey='volume'|'news'|'supply'|'chart'|'disclosure'|'sector';
export type Weights=Record<WeightKey,number>;
export const BASE_WEIGHTS:Weights={volume:25,news:20,supply:15,chart:15,disclosure:15,sector:10};

const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const norm=(w:Weights)=>{const s=Object.values(w).reduce((a,b)=>a+b,0)||100;const o={} as Weights;for(const k of Object.keys(w) as WeightKey[])o[k]=w[k]/s*100;return o;};

function aggregate(stats:any[],key:'volume'|'chart'){
  const a={tp:0,fp:0,fn:0,tn:0,signalCount:0,sumReturn:0,maxDrawdown:0};
  for(const s of stats){const x=s?.[key];if(!x)continue;for(const k of ['tp','fp','fn','tn','signalCount','sumReturn'] as const)a[k]+=Number(x[k]||0);a.maxDrawdown=Math.min(a.maxDrawdown,Number(x.maxDrawdown||0));}
  const precision=a.tp+a.fp?a.tp/(a.tp+a.fp):0;
  const recall=a.tp+a.fn?a.tp/(a.tp+a.fn):0;
  const fpr=a.fp+a.tn?a.fp/(a.fp+a.tn):0;
  const avgReturn=a.signalCount?a.sumReturn/a.signalCount:0;
  const quality=clamp(.45*precision+.25*recall-.20*fpr+.10*clamp((avgReturn+3)/12,0,1),0,1);
  return {...a,precision,recall,fpr,avgReturn,quality};
}

function realizedFactor(tracking:any[],key:WeightKey){
  const labeled=tracking.filter(x=>typeof x?.hit5_20==='boolean'&&x?.features&&typeof x.features[key]==='number');
  if(labeled.length<8)return {factor:1,labeled:labeled.length,hitRate:null,baseHitRate:null};
  const baseHit=labeled.filter(x=>x.hit5_20).length/labeled.length;
  const active=labeled.filter(x=>x.features[key]>=.35);
  if(active.length<4)return {factor:1,labeled:labeled.length,hitRate:null,baseHitRate:baseHit};
  const hit=(active.filter(x=>x.hit5_20).length+2)/(active.length+4);
  const base=(labeled.filter(x=>x.hit5_20).length+2)/(labeled.length+4);
  const lift=base?hit/base:1;
  return {factor:clamp(lift,.7,1.35),labeled:labeled.length,hitRate:hit,baseHitRate:base};
}

export function learnWeights(input:{stats:any[];tracking:any[];previous?:Partial<Weights>}){
  const previous=norm({...BASE_WEIGHTS,...(input.previous||{})});
  const histVolume=aggregate(input.stats,'volume');
  const histChart=aggregate(input.stats,'chart');
  const target:{[K in WeightKey]:number}={...BASE_WEIGHTS};
  const hv=.75+histVolume.quality*.5;
  const hc=.75+histChart.quality*.5;
  target.volume*=hv;target.chart*=hc;
  const realized:any={};
  for(const k of Object.keys(BASE_WEIGHTS) as WeightKey[]){realized[k]=realizedFactor(input.tracking||[],k);target[k]*=realized[k].factor;}
  let bounded={} as Weights;
  for(const k of Object.keys(BASE_WEIGHTS) as WeightKey[])bounded[k]=clamp(target[k],BASE_WEIGHTS[k]*.55,BASE_WEIGHTS[k]*1.55);
  bounded=norm(bounded);
  const smoothed={} as Weights;
  for(const k of Object.keys(BASE_WEIGHTS) as WeightKey[])smoothed[k]=previous[k]*.7+bounded[k]*.3;
  const weights=norm(smoothed);
  const labeled=Math.max(0,...Object.values(realized).map((x:any)=>x.labeled||0));
  return {weights,metrics:{historical:{volume:histVolume,chart:histChart},realized,labeled},learnedAt:new Date().toISOString()};
}
