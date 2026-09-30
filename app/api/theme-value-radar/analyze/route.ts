import { NextRequest, NextResponse } from 'next/server';
import { isThemeValueAuthed } from '@/lib/theme-value-auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';

const clamp=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n));
const median=(a:number[])=>{const x=a.filter(Number.isFinite).sort((p,q)=>p-q);if(!x.length)return null;const m=Math.floor(x.length/2);return x.length%2?x[m]:(x[m-1]+x[m])/2};

type StockDef=[string,string,string,string];
type ThemeDef={id:string;name:string;query:string;structural:number;policy:number;earnings:number;global:number;fallbackAlienation:number;thesis:string;stocks:StockDef[]};
const themes:ThemeDef[]=[
{id:'robot',name:'피지컬AI·로봇',query:'피지컬 AI 로봇 휴머노이드 자동화',structural:96,policy:100,earnings:77,global:93,fallbackAlienation:74,thesis:'AI가 소프트웨어에서 실제 산업현장으로 확장되는 핵심 축. 정부의 로봇 보급·특화단지 정책을 직접 반영.',stocks:[['277810.KQ','레인보우로보틱스','277810','핵심'],['454910.KS','두산로보틱스','454910','핵심'],['108490.KQ','로보티즈','108490','도전자'],['030530.KQ','원익홀딩스','030530','다크호스']]},
{id:'semis',name:'AI반도체·HBM',query:'AI 반도체 HBM 메모리 데이터센터 삼성전자 SK하이닉스',structural:99,policy:88,earnings:96,global:100,fallbackAlienation:84,thesis:'AI 데이터센터의 연산·메모리 수요가 실적 가시성으로 연결되는 메가트렌드. 단기 과열 여부는 소외지수로 별도 판단.',stocks:[['005930.KS','삼성전자','005930','핵심'],['000660.KS','SK하이닉스','000660','핵심'],['042700.KQ','한미반도체','042700','도전자'],['403870.KQ','HPSP','403870','도전자']]},
{id:'power',name:'AI전력망·전력기기',query:'AI 데이터센터 전력망 전력기기 변압기 ESS',structural:97,policy:90,earnings:93,global:98,fallbackAlienation:81,thesis:'AI 데이터센터 전력수요, 노후 전력망 교체, 변압기 공급부족이 겹치는 인프라 사이클.',stocks:[['267260.KS','HD현대일렉트릭','267260','핵심'],['010120.KS','LS ELECTRIC','010120','핵심'],['298040.KS','효성중공업','298040','핵심'],['103590.KS','일진전기','103590','도전자']]},
{id:'defense',name:'방산·무인체계',query:'K방산 수출 무인체계 드론 미사일 방산 계약',structural:94,policy:99,earnings:90,global:96,fallbackAlienation:78,thesis:'국방비 확대와 수출 레퍼런스가 누적되는 구조. 국내 특화단지 정책과 해외 수주를 함께 추접.',stocks:[['012450.KS','한화에어로스페이스','012450','핵심'],['079550.KS','LIG넥스원','079550','핵심'],['047810.KS','한국항공우주','047810','핵심'],['064350.KS','현대로템','064350','도전자']]},
{id:'battery',name:'이차전지·ESS',query:'이차전지 ESS 배터리 공급망 광양만 특화단지',structural:88,policy:98,earnings:64,global:86,fallbackAlienation:58,thesis:'장기 성장성은 유지되지만 업황·수익성 변동성이 큰 영역. 충분한 가격조정과 실적 바닥 확인이 중요.',stocks:[['373220.KS','LG에너지솔루션','373220','핵심'],['006400.KS','삼성SDI','006400','핵심'],['003670.KS','포스코퓨처엠','003670','도전자'],['247540.KQ','에코프로비엠','247540','도전자']]},
{id:'nuclear',name:'원전·SMR',query:'원전 SMR AI 데이터센터 전력 수주 한국',structural:93,policy:91,earnings:84,global:95,fallbackAlienation:76,thesis:'AI 전력수요와 에너지 안보가 원전·SMR 투자 논리를 강화. 수주 일정과 밸류에이션을 함께 확인.',stocks:[['034020.KS','두산에너빌리티','034020','핵심'],['052690.KS','한전기술','052690','핵심'],['000720.KS','현대건설','000720','도전자'],['100840.KS','SNT에너지','100840','다크호스']]},
{id:'ship',name:'조선·LNG·해양방산',query:'한국 조선 LNG선 해양방산 수주 HD현대 한화오션',structural:91,policy:86,earnings:92,global:92,fallbackAlienation:83,thesis:'LNG·고부가 선박과 해양방산 수요가 수주잔고로 이어지는 장기 사이클. 이미 많이 오른 종목은 소외지수로 거른다.',stocks:[['009540.KS','HD한국조선해양','009540','핵심'],['329180.KS','HD현대중공업','329180','핵심'],['042660.KS','한화오션','042660','도전자'],['010140.KS','삼성중공업','010140','도전자']]},
{id:'bio',name:'바이오·FDA·항암',query:'K바이오 FDA 승인 항암 신약 기술수출',structural:87,policy:80,earnings:66,global:89,fallbackAlienation:68,thesis:'개별 임상·허가 이벤트의 상승탄력이 크지만 실패 리스크도 큼. 대형 바이오와 이벤트형 종목을 구분해 본다.',stocks:[['207940.KS','삼성바이오로직스','207940','핵심'],['068270.KS','셀트리온','068270','핵심'],['196170.KQ','알테오젠','196170','도전자'],['028300.KQ','HLB','028300','이벤트형']]},
{id:'space',name:'우주항공·위성',query:'우주항공 위성 발사체 한국 스페이스X 공급망',structural:90,policy:88,earnings:61,global:94,fallbackAlienation:71,thesis:'글로벌 발사·위성통신 시장 확대의 수혜 가능성이 있으나 실적 전환 속도 차이가 큼.',stocks:[['047810.KS','한국항공우주','047810','핵심'],['012450.KS','한화에어로스페이스','012450','핵심'],['099320.KQ','쎄트렉아이','099320','도전자'],['211270.KQ','AP위성','211270','다크호스']]},
{id:'cyber',name:'사이버보안·AI보안',query:'사이버보안 AI 보안 랜섬웨어 국가 사이버보안 한국',structural:89,policy:87,earnings:70,global:95,fallbackAlienation:63,thesis:'AI 확산과 지정학적 긴장으로 보안 지출이 구조적으로 증가. 국내 종목은 실접과 수주 확인이 특히 중요.',stocks:[['053800.KQ','안랩','053800','핵심'],['067920.KQ','이글루코퍼레이션','067920','도전자'],['184230.KQ','SGA솔루션즈','184230','다크호스']]},
{id:'software',name:'AI소프트웨어·데이터',query:'생성형 AI 소프트웨어 데이터센터 클라우드 한국 기업',structural:92,policy:89,earnings:74,global:98,fallbackAlienation:66,thesis:'AI 도입이 모델에서 업무·데이터·클라우드로 확산되는 축. 매출 성장 확인이 중요.',stocks:[['035420.KS','NAVER','035420','핵심'],['035720.KS','카카오','035720','도전자'],['012510.KS','더존비즈온','012510','도전자'],['304100.KQ','솔트룩스','304100','다크호스']]},
{id:'healthai',name:'의료AI·디지털헬스',query:'의료 AI 디지털헬스 FDA 한국 루닛 뷰노',structural:91,policy:84,earnings:62,global:93,fallbackAlienation:65,thesis:'의료 데이터와 AI 진단의 상용화가 진행 중. 허가·보험수가·해외매출을 핵심 검증지표로 사용.',stocks:[['328130.KQ','루닛','328130','도전자'],['338220.KQ','뷰노','338220','도전자']]}
];

async function yahooChart(ticker:string,lookback:number){
  const period2=Math.floor(Date.now()/1000),period1=period2-Math.max(lookback+30,270)*86400;
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},cache:'no-store',signal:AbortSignal.timeout(6500)}); if(!r.ok)throw new Error('yahoo');
  const j=await r.json();const x=j?.chart?.result?.[0],q=x?.indicators?.quote?.[0];if(!x||!q)throw new Error('chart');
  const closes=(q.close||[]).filter(Number.isFinite).slice(-lookback),highs=(q.high||[]).filter(Number.isFinite).slice(-lookback);const current=x.meta?.regularMarketPrice||closes.at(-1);if(!Number.isFinite(current)||!highs.length)throw new Error('price');
  const high=Math.max(...highs),pos=clamp(current/high*100,1,110),c20=closes.length>20?closes[closes.length-21]:closes[0],mom20=c20?(current/c20-1)*100:0;return{current,high,pos,mom20};
}
function decode(s:string){return s.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]+>/g,'').trim()}
function rssItems(xml:string){const arr:any[]=[];const re=/<item>([\s\S]*?)<\/item>/g;let m;while((m=re.exec(xml))&&arr.length<12){const b=m[1];const get=(t:string)=>{const mm=b.match(new RegExp(`<${t}>([\\s\\S]*?)<\\/${t}>`));return mm?decode(mm[1]):''};arr.push({title:get('title'),link:get('link'),pubDate:get('pubDate')})}return arr}
async function googleNews(query:string){const url=`https://news.google.com/rss/search?q=${encodeURIComponent(query+' when:7d')}&hl=ko&gl=KR&ceid=KR:ko`;const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},cache:'no-store',signal:AbortSignal.timeout(6500)});if(!r.ok)throw new Error('news');const items=rssItems(await r.text()).slice(0,6),now=Date.now();const freshness=items.reduce((s,it)=>{const age=(now-new Date(it.pubDate).getTime())/86400000;return s+(age<1?1.5:age<3?1.1:age<7?.7:.3)},0);return{score:clamp(42+items.length*6+freshness*2.2,35,100),items}}

export async function POST(req:NextRequest){
  if(!isThemeValueAuthed(req))return NextResponse.json({ok:false,message:'인증이 필요합니다.'},{status:401});
  let body:any={};try{body=await req.json()}catch{} const lookback=clamp(Number(body?.lookback)||240,30,240);
  const results=await Promise.all(themes.map(async t=>{const stockData=await Promise.all(t.stocks.map(async s=>{try{return{...(await yahooChart(s[0],lookback)),ticker:s[0],name:s[1],code:s[2],tier:s[3]}}catch{return{ticker:s[0],name:s[1],code:s[2],tier:s[3],error:true}}}));let news:any={score:55,items:[]};try{news=await googleNews(t.query)}catch{}const pos=stockData.filter((x:any)=>!x.error).map((x:any)=>x.pos),moms=stockData.filter((x:any)=>!x.error).map((x:any)=>x.mom20);const alienation=pos.length?median(pos)!:t.fallbackAlienation,momentum=moms.length?median(moms)!:0,reversal=clamp(50+momentum*2.2,20,95),outlook=clamp(t.structural*.30+t.policy*.22+news.score*.20+t.earnings*.16+t.global*.12),drawdown=clamp(100-alienation),opportunity=clamp(outlook*.58+drawdown*.30+reversal*.12);return{...t,newsScore:news.score,newsItems:news.items,alienation,drawdown,momentum,reversal,outlook,opportunity,stockData}}));
  results.sort((a,b)=>b.opportunity-a.opportunity);return NextResponse.json({ok:true,asOf:new Date().toISOString(),lookback,results});
}
