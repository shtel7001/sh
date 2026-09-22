import type {Bar} from './market';

export type Settings={maxBelowDays:number;gapPct:number;ma20CompareDays:number;supportTolPct:number;bottomTolPct:number};
const avg=(a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;
function sma(b:Bar[],n:number,i:number){if(i<n-1)return null;return avg(b.slice(i-n+1,i+1).map(x=>x.close))}
function slopePct(a:number[]){if(a.length<2)return 0;const n=a.length;let sx=0,sy=0,sxy=0,sxx=0;for(let i=0;i<n;i++){sx+=i;sy+=a[i];sxy+=i*a[i];sxx+=i*i}const d=n*sxx-sx*sx;if(!d)return 0;const m=(n*sxy-sx*sy)/d;const base=avg(a)||1;return m/base*100}

export function analyzeDaily(bars:Bar[],s:Settings){
 const b=bars.filter(x=>Number.isFinite(x.close));const n=b.length;if(n<75)return{pass:false,error:'일봉 75개 미만'};
 const ma5=b.map((_,i)=>sma(b,5,i));const ma20=b.map((_,i)=>sma(b,20,i));const i=n-1;const m5=ma5[i]!;const m20=ma20[i]!;const prev20=ma20[Math.max(19,i-s.ma20CompareDays)]!;
 let below=0;for(let k=i;k>=4;k--){if(b[k].close<(ma5[k]||0))below++;else break}
 let maxBelow=0,run=0;const start=Math.max(4,i-59);for(let k=start;k<=i;k++){if(b[k].close<(ma5[k]||0)){run++;maxBelow=Math.max(maxBelow,run)}else run=0}
 const prevBelow=i>4?b[i-1].close<(ma5[i-1]||0):false;const gap=(b[i].close/m5-1)*100;const ma20Rise=(m20/prev20-1)*100;const ma20Slope=slopePct((ma20.slice(Math.max(19,i-9),i+1).filter((x):x is number=>typeof x==='number')));
 const recentDip=below>=1&&below<=s.maxBelowDays;const justReclaim=below===0&&prevBelow&&gap<=0.8;const near5=Math.abs(gap)<=s.gapPct||gap<=0.8&&gap>=-s.gapPct;
 const pass=maxBelow<=s.maxBelowDays&&ma20Rise>0&&ma20Slope>0&&near5&&(recentDip||justReclaim);
 let score=0;if(maxBelow<=s.maxBelowDays)score+=25;if(ma20Rise>0)score+=20;if(ma20Slope>0)score+=10;if(recentDip||justReclaim)score+=20;if(Math.abs(gap)<=1)score+=15;else if(Math.abs(gap)<=s.gapPct)score+=8;if(b[i].close>m20)score+=10;
 const reasons:string[]=[];if(maxBelow<=s.maxBelowDays)reasons.push(`60일 내 5일선 하회 연속 최대 ${maxBelow}일`);if(ma20Rise>0)reasons.push(`20일선 ${s.ma20CompareDays}거래일 대비 +${ma20Rise.toFixed(2)}%`);if(recentDip)reasons.push(`현재 5일선 아래 ${below}일째`);if(justReclaim)reasons.push('직전 5일선 하회 후 재돌파');reasons.push(`5일선 괴리 ${gap.toFixed(2)}%`);
 return{pass,score:Math.min(score,100),close:b[i].close,ma5:m5,ma20:m20,gapPct:gap,belowDays:below,maxBelow60:maxBelow,ma20RisePct:ma20Rise,ma20SlopePct:ma20Slope,justReclaim,reasons,lastDate:b[i].date};
}

function pivots(b:Bar[]){const out:{i:number;low:number}[]=[];for(let i=2;i<b.length-2;i++)if(b[i].low<=b[i-1].low&&b[i].low<=b[i-2].low&&b[i].low<=b[i+1].low&&b[i].low<=b[i+2].low)out.push({i,low:b[i].low});return out}
export function analyze30m(bars:Bar[],s:Settings){
 const b=bars.filter(x=>Number.isFinite(x.close));const n=b.length;if(n<70)return{pass:false,error:'30분봉 70개 미만'};const i=n-1;
 const m5=sma(b,5,i)!;const m20=sma(b,20,i)!;const m60=sma(b,60,i)!;const m300=sma(b,300,i);const ma5Slope=slopePct(Array.from({length:5},(_,j)=>sma(b,5,i-4+j)||b[i-4+j].close));
 const supports=[['20',m20],['60',m60],['300',m300] as const].filter((x):x is [string,number]=>typeof x[1]==='number');let support='';let supportDist=999;
 for(const [name,m] of supports){const lows=b.slice(-8).map(x=>x.low);const d=Math.min(...lows.map(x=>Math.abs(x/m-1)*100));if(d<=s.supportTolPct&&b[i].close>=m*0.995&&d<supportDist){support=`30분 ${name}이평 지지`;supportDist=d}}
 const ps=pivots(b.slice(-48));let dbl=false,dbInfo='';for(let a=0;a<ps.length;a++)for(let c=a+1;c<ps.length;c++){const p1=ps[a],p2=ps[c];const sep=p2.i-p1.i;if(sep<4||sep>26)continue;const diff=Math.abs(p2.low/p1.low-1)*100;const higher=p2.low>=p1.low*0.99;if(diff<=s.bottomTolPct&&higher){const local=b.slice(-48);const neckline=Math.max(...local.slice(p1.i,p2.i+1).map(x=>x.high));if(b[i].close>=neckline*0.985&&ma5Slope>0){dbl=true;dbInfo=`30분 쌍바닥(${diff.toFixed(2)}%) + 우상향`;break}}}if(dbl)break}
 const rising=ma5Slope>0&&b[i].close>=m5*0.995;const pass=rising&&(!!support||dbl);let score=0;if(rising)score+=30;if(support)score+=30;if(dbl)score+=40;if(b[i].close>m20)score+=10;
 const reasons:string[]=[];if(rising)reasons.push(`30분 5이평 기울기 +${ma5Slope.toFixed(3)}%/bar`);if(support)reasons.push(`${support} · 오차 ${supportDist.toFixed(2)}%`);if(dbl)reasons.push(dbInfo);
 return{pass,score:Math.min(score,100),close:b[i].close,ma5:m5,ma20:m20,ma60:m60,ma300:m300,ma5SlopePct:ma5Slope,support: support||null,supportDistPct:support?supportDist:null,doubleBottom:dbl,reasons,lastDate:b[i].date};
}
