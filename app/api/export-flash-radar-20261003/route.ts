// @ts-nocheck
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Reuse the existing permanent-login scope/hash so the user's old one-time code and token keep working.
const SCOPE = 'gc-flow-accumulation-radar-20261002-v1';
const ACCESS_CODE_HASH = '696db21cbff09ada1a61dce8499bd5de35f5f8a7f68a90ac294e091a131ca70f';
const BASE = 'https://apis.data.go.kr/1220000/prlstMmUtPrviExpAcrs';
const ITEMTRADE_ENDPOINT = 'https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList';
const UA = 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';

const ITEM_NAMES:any = {
  item01:'반도체', item02:'철강제품', item03:'승용차', item04:'석유제품',
  item05:'무선통신기기', item06:'선박', item07:'자동차부품',
  item08:'컴퓨터 주변기기', item09:'정밀기기', item10:'가전제품'
};

const HS2_NAMES:any = {
  '01':'살아있는 동물','02':'육류','03':'수산물','04':'낙농품·조란·천연꿀','05':'기타 동물성 생산품',
  '06':'화훼류','07':'채소','08':'과실·견과류','09':'커피·차·향신료','10':'곡물',
  '11':'제분공업 생산품','12':'채유용 종자·약용식물','13':'수액·식물성 추출물','14':'기타 식물성 생산품','15':'동식물성 유지',
  '16':'육·어류 조제품','17':'당류·설탕과자','18':'코코아·초콜릿','19':'곡물·전분 조제품','20':'채소·과실 조제품',
  '21':'기타 조제식료품','22':'음료·주류','23':'식품공업 잔재물·사료','24':'담배','25':'토석류·시멘트 원료',
  '26':'광·슬래그·회','27':'광물성연료·석유제품','28':'무기화학품','29':'유기화학품','30':'의약품',
  '31':'비료','32':'염료·안료·페인트','33':'향료·화장품','34':'비누·세제·왁스','35':'단백질계 물질·효소',
  '36':'화약류','37':'사진·영화용 재료','38':'기타 화학공업제품','39':'플라스틱·제품','40':'고무·제품',
  '41':'원피·가죽','42':'가죽제품·가방','43':'모피·제품','44':'목재·목제품','45':'코르크·제품',
  '46':'짚·조물제품','47':'펄프','48':'종이·판지','49':'인쇄물','50':'견',
  '51':'양모·동물모','52':'면','53':'기타 식물성 방직섬유','54':'인조필라멘트','55':'인조스테이플섬유',
  '56':'워딩·펠트·부직포','57':'양탄자','58':'특수직물','59':'도포직물','60':'편물',
  '61':'의류(편물)','62':'의류(비편물)','63':'기타 섬유제품','64':'신발','65':'모자',
  '66':'우산·지팡이','67':'깃털·조화·인조모발','68':'석재·플라스터·시멘트제품','69':'도자제품','70':'유리·유리제품',
  '71':'귀금속·보석류','72':'철강','73':'철강제품','74':'구리·제품','75':'니켈·제품',
  '76':'알루미늄·제품','78':'납·제품','79':'아연·제품','80':'주석·제품','81':'기타 비금속',
  '82':'공구·칼붙이','83':'각종 비금속제품','84':'기계·컴퓨터','85':'전기기기·전자제품','86':'철도차량',
  '87':'자동차·차량','88':'항공기·우주선','89':'선박','90':'광학·정밀·의료기기','91':'시계',
  '92':'악기','93':'무기·탄약','94':'가구·조명기구','95':'완구·스포츠용품','96':'잡품','97':'예술품·골동품'
};

function secret(){ return process.env.SESSION_SECRET || ''; }
function sign(payload:string){ return crypto.createHmac('sha256', `${secret()}:${SCOPE}`).update(payload).digest('base64url'); }
function createToken(){ const p=`${SCOPE}.${crypto.randomBytes(24).toString('base64url')}`; return `${p}.${sign(p)}`; }
function requestToken(req:Request){ return req.headers.get('x-auth-token') || (req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''); }
function validToken(token?:string|null){
  if(!token||!secret()) return false;
  const i=token.lastIndexOf('.'); if(i<0) return false;
  const p=token.slice(0,i),s=token.slice(i+1);
  if(!p.startsWith(`${SCOPE}.`)) return false;
  const e=sign(p); if(s.length!==e.length) return false;
  try{return crypto.timingSafeEqual(Buffer.from(s),Buffer.from(e));}catch{return false;}
}
function validPassword(v:string){
  const actual=crypto.createHash('sha256').update(String(v||'').trim()).digest();
  try{return actual.length===32&&crypto.timingSafeEqual(actual,Buffer.from(ACCESS_CODE_HASH,'hex'));}catch{return false;}
}
function unauthorized(){return NextResponse.json({error:'UNAUTHORIZED'},{status:401,headers:{'Cache-Control':'no-store'}});}
function cleanKey(v:any){
  let s=String(v||'').trim();
  if(!s) return '';
  if(/%[0-9A-Fa-f]{2}/.test(s)){ try{s=decodeURIComponent(s);}catch{} }
  return s;
}
function dec(s:any){
  return String(s??'')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
}
function n(v:any){
  const s=String(v??'').replace(/,/g,'').replace(/[^0-9+\-.]/g,'');
  const x=Number(s); return Number.isFinite(x)?x:null;
}
function xmlObjects(xml:string){
  let blocks=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m=>m[1]);
  if(!blocks.length && /<item01>/i.test(xml)) blocks=[xml];
  const rows:any[]=[];
  for(const block of blocks){
    const o:any={};
    for(const m of block.matchAll(/<([A-Za-z0-9_:-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)){
      const k=m[1].replace(/^.*:/,''); o[k]=dec(m[2].replace(/<[^>]+>/g,''));
    }
    if(Object.keys(o).length) rows.push(o);
  }
  return rows;
}
function apiError(xml:string){
  const pairs:any={};
  for(const k of ['resultCode','resultMsg','returnReasonCode','returnAuthMsg','errMsg']){
    const m=xml.match(new RegExp('<'+k+'[^>]*>([\\s\\S]*?)<\\/'+k+'>','i'));
    if(m)pairs[k]=dec(m[1]);
  }
  const code=String(pairs.resultCode??pairs.returnReasonCode??'').trim();
  const statusMsg=String(pairs.resultMsg??pairs.returnAuthMsg??pairs.errMsg??'').trim();
  if(code==='00'||/NORMAL[\\s_]*SERVICE/i.test(statusMsg)||/정상/.test(statusMsg))return '';
  return Object.values(pairs).filter(Boolean).join(' / ');
}
function ymdFromAny(v:any){
  const s=String(v??'').trim();
  let m=s.match(/(20\d{2})[^0-9]?(0?[1-9]|1[0-2])[^0-9]?(0?[1-9]|[12]\d|3[01])/);
  if(m)return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  const d=s.replace(/\D/g,'');
  if(/^20\d{6}$/.test(d))return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
  return '';
}
function inferDate(o:any){
  const keys=Object.keys(o);
  const preferred=keys.filter(k=>/(date|ymd|dt|day|base|stdr|stat|prlst|period)/i.test(k));
  for(const k of preferred.concat(keys)){
    const d=ymdFromAny(o[k]); if(d)return d;
  }
  const yearVal=keys.find(k=>/^year$/i.test(k)||/yr$/i.test(k));
  const monthVal=keys.find(k=>/^month$/i.test(k)||/mm$/i.test(k));
  const dayVal=keys.find(k=>/^day$/i.test(k)||/dd$/i.test(k));
  if(yearVal&&monthVal){
    const y=String(o[yearVal]).replace(/\D/g,''),m=String(o[monthVal]).replace(/\D/g,'').padStart(2,'0');
    const d=dayVal?String(o[dayVal]).replace(/\D/g,'').padStart(2,'0'):'01';
    if(/^20\d{2}$/.test(y)&&/^\d{2}$/.test(m))return `${y}-${m}-${d}`;
  }
  return '';
}
function inferRangeEnd(o:any,date:string){
  const keys=Object.keys(o);
  for(const k of keys){
    if(/(term|period|range|ten|unit|days|se|gb|type)/i.test(k)){
      const s=String(o[k]||'');
      const mm=s.match(/(?:~|-|–)\s*(10|20|28|29|30|31)/);
      if(mm)return Number(mm[1]);
      if(/^\s*(10|20|28|29|30|31)\s*$/.test(s))return Number(s.trim());
    }
  }
  if(date){
    const dd=Number(date.slice(8,10));
    if(dd===10||dd===20||dd>=28)return dd;
  }
  return 0;
}
function normalizeRows(raw:any[]){
  return raw.map((o:any,idx:number)=>{
    const ym=String(o.priodMon??o.periodMon??'').replace(/\D/g,'').slice(0,6);
    const pd=String(o.priodDt??o.periodDt??'').trim();
    let rangeEnd=0;
    const pm=pd.match(/~\s*(\d{1,2})(?:\D|$)/);
    if(pm)rangeEnd=Number(pm[1]);
    if(!rangeEnd){
      const ds=pd.match(/(?:^|\D)(10|20|28|29|30|31)(?:\D|$)/g);
      if(ds?.length){
        const last=ds[ds.length-1].match(/\d+/);
        if(last)rangeEnd=Number(last[0]);
      }
    }
    if(ym.length===6 && (!rangeEnd || rangeEnd>31)){
      const y=Number(ym.slice(0,4)),m=Number(ym.slice(4,6));
      rangeEnd=new Date(Date.UTC(y,m,0)).getUTCDate();
    }
    const date=ym.length===6&&rangeEnd
      ? `${ym.slice(0,4)}-${ym.slice(4,6)}-${String(rangeEnd).padStart(2,'0')}`
      : inferDate(o);
    if(!rangeEnd && date)rangeEnd=inferRangeEnd(o,date);

    const values:any={};
    for(let i=1;i<=10;i++){
      const suffix=String(i).padStart(2,'0');
      const official='itemUsdAmt'+suffix;
      const fallback='item'+suffix;
      const real=Object.keys(o).find(k=>k.toLowerCase()===official.toLowerCase())
        || Object.keys(o).find(k=>k.toLowerCase()===fallback.toLowerCase());
      values[fallback]=real?n(o[real]):null;
    }
    const totalReal=Object.keys(o).find(k=>k.toLowerCase()==='itemusdamt00')
      || Object.keys(o).find(k=>/(tot.*exp|exp.*tot|total.*(amt|val|dlr)|all.*exp|item00)/i.test(k));
    const total=totalReal?n(o[totalReal]):null;
    return {idx,date,rangeEnd,values,total,raw:o};
  }).filter((r:any)=>Object.values(r.values).some(v=>v!==null));
}
function isoMonth(s:string){return String(s||'').slice(0,7).replace('-','');}
function firstDateOfMonth(s:string){return String(s||'').slice(0,7)+'-01';}
function lastDateOfMonth(s:string){
  const [y,m]=String(s||'').slice(0,7).split('-').map(Number);
  if(!y||!m)return s; return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
}
function monthStartOffset(s:string,delta:number){
  const [y,m]=String(s||'').slice(0,7).split('-').map(Number);
  if(!y||!m)return s;
  return new Date(Date.UTC(y,m-1+delta,1)).toISOString().slice(0,10);
}
async function callUrl(url:string){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),13000);
  try{
    const r=await fetch(url,{signal:c.signal,cache:'no-store',headers:{'User-Agent':UA,'Accept':'application/xml,text/xml,text/plain,*/*'}});
    const text=await r.text();
    return {ok:r.ok,status:r.status,text};
  }finally{clearTimeout(t);}
}

function ymOffset(ym:string,delta:number){
  const s=String(ym||'').replace(/\D/g,'').slice(0,6), y=Number(s.slice(0,4)),m=Number(s.slice(4,6));
  if(!y||!m)return '';
  const d=new Date(Date.UTC(y,m-1+delta,1));
  return String(d.getUTCFullYear())+String(d.getUTCMonth()+1).padStart(2,'0');
}
function ymFromDate(s:string){return String(s||'').slice(0,7).replace('-','');}
function displayYm(ym:string){const s=String(ym||'').replace(/\D/g,'').slice(0,6);return s.length===6?s.slice(0,4)+'-'+s.slice(4,6):'';}
async function callUrlLong(url:string,ms=26000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  try{
    const r=await fetch(url,{signal:c.signal,cache:'no-store',headers:{'User-Agent':UA,'Accept':'application/xml,text/xml,text/plain,*/*'}});
    const text=await r.text();
    return {ok:r.ok,status:r.status,text};
  }finally{clearTimeout(t);}
}
function hsCodeOf(o:any){return String(o.hsCode??o.hsCd??o.hsSgn??'').replace(/\D/g,'');}
function yearYmOf(o:any){
  const s=String(o.year??o.priodMon??o.periodMon??'').replace(/\D/g,'').slice(0,6);
  return /^20\d{4}$/.test(s)?s:'';
}
function expDlrOf(o:any){return n(o.expDlr??o.expUsdAmt??o.exportDlr??o.expAmt);}
function xmlNum(xml:string,tag:string){
  const m=String(xml||'').match(new RegExp('<'+tag+'[^>]*>([\\s\\S]*?)<\\/'+tag+'>','i'));
  const v=m?Number(String(m[1]).replace(/[^0-9.-]/g,'')):0;
  return Number.isFinite(v)?v:0;
}
function rowSig(o:any){
  return [yearYmOf(o),hsCodeOf(o),String(o.statKor??''),String(expDlrOf(o)??'')].join('|');
}
async function fetchItemtradePage(key:string,startYm:string,endYm:string,hs2:string,pageNo:number,numOfRows:number,usePaging=true){
  const serviceKey=cleanKey(key); if(!serviceKey)throw new Error('DATA_GO_KR_KEY_REQUIRED');
  const q=new URLSearchParams({serviceKey,strtYymm:startYm,endYymm:endYm});
  if(hs2)q.set('hsSgn',hs2);
  if(usePaging){q.set('pageNo',String(pageNo));q.set('numOfRows',String(numOfRows));}
  const url=ITEMTRADE_ENDPOINT+'?'+q.toString();
  const r=await callUrlLong(url,hs2?18000:30000);
  const err=apiError(r.text);
  if(!r.ok)throw new Error('ITEMTRADE_HTTP_'+r.status+'::'+(err||r.text.slice(0,400)));
  if(err)throw new Error('ITEMTRADE_ERROR::'+err);
  const items=xmlObjects(r.text);
  return {
    items,
    totalCount:xmlNum(r.text,'totalCount'),
    pageNo:xmlNum(r.text,'pageNo'),
    numOfRows:xmlNum(r.text,'numOfRows'),
    status:r.status
  };
}
async function fetchItemtradeFull(key:string,startYm:string,endYm:string,hs2=''){
  const pageSize=5000,maxPages=40;
  let first:any;
  try{
    first=await fetchItemtradePage(key,startYm,endYm,hs2,1,pageSize,true);
  }catch(e:any){
    // Some GW variants do not accept paging parameters; fall back to the documented unpaged call.
    const msg=String(e?.message||e);
    if(!/INVALID_REQUEST_PARAMETER|ITEMTRADE_ERROR|HTTP_400/i.test(msg))throw e;
    const one=await fetchItemtradePage(key,startYm,endYm,hs2,1,pageSize,false);
    return {rows:one.items,pages:1,totalCount:one.items.length,pagingMode:'unpaged-fallback'};
  }
  const all:any[]=[],seen=new Set<string>();
  const add=(rows:any[])=>{
    let added=0;
    for(const o of rows){
      const sig=rowSig(o);
      if(!seen.has(sig)){seen.add(sig);all.push(o);added++;}
    }
    return added;
  };
  add(first.items);
  const declaredTotal=Number(first.totalCount||0);
  if(declaredTotal>0 && all.length>=declaredTotal){
    return {rows:all,pages:1,totalCount:declaredTotal,pagingMode:'paged'};
  }
  // If the gateway returns fewer than the requested page size and has no larger declared total,
  // this is already the complete response.
  if(first.items.length<pageSize && !(declaredTotal>first.items.length)){
    return {rows:all,pages:1,totalCount:declaredTotal||all.length,pagingMode:first.pageNo||first.numOfRows?'paged':'single-response'};
  }

  let pages=1,lastFirstSig=first.items.length?rowSig(first.items[0]):'';
  for(let page=2;page<=maxPages;page++){
    const p=await fetchItemtradePage(key,startYm,endYm,hs2,page,pageSize,true);
    if(!p.items.length)break;
    const firstSig=p.items.length?rowSig(p.items[0]):'';
    // Some gateways ignore pageNo and keep returning page 1. If so, retry once without paging;
    // the Customs API's documented call can return the complete dataset in one response.
    if(firstSig && firstSig===lastFirstSig){
      const one=await fetchItemtradePage(key,startYm,endYm,hs2,1,pageSize,false);
      if(one.items.length>all.length){
        return {rows:one.items,pages:1,totalCount:one.items.length,pagingMode:'unpaged-complete'};
      }
      break;
    }
    const added=add(p.items);pages++;
    if(!added)break;
    if(declaredTotal>0 && all.length>=declaredTotal)break;
    if(p.items.length<pageSize)break;
    lastFirstSig=firstSig;
  }
  return {rows:all,pages,totalCount:declaredTotal||all.length,pagingMode:'paged'};
}
async function fetchItemtrade(key:string,startYm:string,endYm:string,hs2=''){
  const got=await fetchItemtradeFull(key,startYm,endYm,hs2);
  return got.rows;
}
function aggregateHs2(raw:any[],ym:string){
  const sums:any={};
  for(const o of raw){
    if(yearYmOf(o)!==ym)continue;
    const hs=hsCodeOf(o); if(!/^\d{2,10}$/.test(hs))continue;
    const code=hs.slice(0,2),v=expDlrOf(o); if(v===null)continue;
    sums[code]=(sums[code]||0)+Number(v);
  }
  return sums;
}
function hs2Coverage(sums:any){
  return Object.keys(sums||{}).filter(code=>Number(code)>=1&&Number(code)<=97&&Number(sums[code])>=0).length;
}
async function ensureHs2Value(key:string,ym:string,hs2:string,sums:any){
  if(Number.isFinite(Number(sums?.[hs2])) && Number(sums[hs2])>0)return;
  const got=await fetchItemtradeFull(key,ym,ym,hs2);
  const part=aggregateSeriesForHs2(got.rows,hs2);
  if(Number.isFinite(Number(part[ym])))sums[hs2]=Number(part[ym]);
}
function aggregateSeriesForHs2(raw:any[],hs2:string){
  const exact=raw.filter((o:any)=>yearYmOf(o)&&hsCodeOf(o)===hs2);
  const src=exact.length?exact:raw.filter((o:any)=>yearYmOf(o)&&hsCodeOf(o).startsWith(hs2));
  const sums:any={};
  for(const o of src){const ym=yearYmOf(o),v=expDlrOf(o);if(!ym||v===null)continue;sums[ym]=(sums[ym]||0)+Number(v);}
  return sums;
}
async function fetchExtraTop50(key:string,endDate:string){
  let latestYm=ymOffset(ymFromDate(endDate),-1), latestGot:any=null, latestSums:any=null;
  for(let i=0;i<3;i++){
    const ym=ymOffset(latestYm,-i);
    const got=await fetchItemtradeFull(key,ym,ym);
    const snap=aggregateHs2(got.rows,ym);
    const coverage=hs2Coverage(snap);
    // A valid full month normally contains the great majority of HS chapters.
    if(coverage>=70){
      latestYm=ym;latestGot=got;latestSums=snap;break;
    }
  }
  if(!latestGot||!latestSums)throw new Error('ITEMTRADE_INCOMPLETE_HS_COVERAGE');

  const prevYm=ymOffset(latestYm,-1), prevYearYm=ymOffset(latestYm,-12);
  const [prevGot,yearGot]=await Promise.all([
    fetchItemtradeFull(key,prevYm,prevYm),
    fetchItemtradeFull(key,prevYearYm,prevYearYm)
  ]);
  const cur=latestSums,prev=aggregateHs2(prevGot.rows,prevYm),yr=aggregateHs2(yearGot.rows,prevYearYm);

  // Explicitly verify HS33 so cosmetics cannot disappear because of a partial gateway response.
  await Promise.all([
    ensureHs2Value(key,latestYm,'33',cur),
    ensureHs2Value(key,prevYm,'33',prev),
    ensureHs2Value(key,prevYearYm,'33',yr)
  ]);

  const curCoverage=hs2Coverage(cur),prevCoverage=hs2Coverage(prev),yrCoverage=hs2Coverage(yr);
  if(curCoverage<70)throw new Error('ITEMTRADE_INCOMPLETE_HS_COVERAGE::'+curCoverage);

  const ranked=Object.entries(cur)
    .filter(([code,v]:any)=>Number(v)>0 && Number(code)>=1 && Number(code)<=97)
    .sort((a:any,b:any)=>Number(b[1])-Number(a[1]));
  const items=ranked.slice(10,50).map(([code,value]:any,i:number)=>{
    const pv=Number(prev[code]||0),yv=Number(yr[code]||0),v=Number(value);
    return {
      key:'hs'+code,hs2:code,rank:11+i,name:HS2_NAMES[code]||('HS '+code),
      month:displayYm(latestYm),value:v/1000,
      yoy:yv?Math.round(((v/yv)-1)*1000)/10:null,
      mom:pv?Math.round(((v/pv)-1)*1000)/10:null
    };
  });
  const cosmetics=ranked.findIndex(([code]:any)=>code==='33');
  const cosmeticsRank=cosmetics>=0?cosmetics+1:null;
  const cv=Number(cur['33']||0),cp=Number(prev['33']||0),cy=Number(yr['33']||0);
  const cosmeticsItem=cv>0?{
    key:'hs33',hs2:'33',rank:cosmeticsRank,name:HS2_NAMES['33'],
    month:displayYm(latestYm),value:cv/1000,
    yoy:cy?Math.round(((cv/cy)-1)*1000)/10:null,
    mom:cp?Math.round(((cv/cp)-1)*1000)/10:null
  }:null;
  return {
    month:displayYm(latestYm),items,
    cosmeticsRank,cosmeticsItem,
    diagnostics:{
      latestYm,rows:latestGot.rows.length,pages:latestGot.pages,pagingMode:latestGot.pagingMode,
      hsChapters:curCoverage,prevHsChapters:prevCoverage,prevYearHsChapters:yrCoverage,
      cosmeticsUsd:Number(cur['33']||0)
    }
  };
}
async function fetchExtraTrend(key:string,hs2:string,endDate:string){
  const endYm=ymOffset(ymFromDate(endDate),-1);
  const startYm=ymOffset(endYm,-35);
  const windows:any[]=[];
  let s=startYm;
  while(s<=endYm){
    const eCandidate=ymOffset(s,11),e=eCandidate>endYm?endYm:eCandidate;
    windows.push([s,e]); s=ymOffset(e,1);
  }
  const chunks=await Promise.all(windows.map(([a,b])=>fetchItemtrade(key,a,b,hs2)));
  const sums:any={};
  for(const raw of chunks){
    const part=aggregateSeriesForHs2(raw,hs2);
    for(const [ym,v] of Object.entries(part))sums[ym]=(sums[ym]||0)+Number(v);
  }
  const months=Object.keys(sums).sort();
  const out:any[]=[];
  for(const ym of months){
    const v=Number(sums[ym]),pm=Number(sums[ymOffset(ym,-1)]||0),py=Number(sums[ymOffset(ym,-12)]||0);
    out.push({
      date:displayYm(ym)+'-01',
      metrics:{['hs'+hs2]:{
        value:v/1000,
        yoy:py?Math.round(((v/py)-1)*1000)/10:null,
        mom:pm?Math.round(((v/pm)-1)*1000)/10:null
      }}
    });
  }
  return out.slice(-24);
}

async function fetchOfficial(key:string,startDate:string,endDate:string){
  const serviceKey=cleanKey(key);
  if(!serviceKey)throw new Error('DATA_GO_KR_KEY_REQUIRED');
  const sm=isoMonth(startDate), em=isoMonth(endDate);
  const endpoint=BASE+'/getPrlstMmUtPrviExpAcrs';
  const q=new URLSearchParams({
    serviceKey,
    strtYymm:sm,
    endYymm:em
  });
  const url=endpoint+'?'+q.toString();
  const r=await callUrl(url);
  const err=apiError(r.text);
  if(!r.ok)throw new Error(`OFFICIAL_API_HTTP_${r.status}::${err||r.text.slice(0,500)}`);
  if(err)throw new Error(`OFFICIAL_API_ERROR::${err}`);
  const raw=xmlObjects(r.text);
  const rows=normalizeRows(raw);
  if(!rows.length){
    const keys=raw.slice(0,3).map((x:any)=>Object.keys(x));
    throw new Error('OFFICIAL_API_NO_ROWS::'+JSON.stringify({
      endpoint,
      params:['serviceKey','strtYymm','endYymm'],
      rawItems:raw.length,
      sampleKeys:keys
    }));
  }
  return {
    rows,
    endpoint,
    diagnostics:[{
      ep:'/getPrlstMmUtPrviExpAcrs',
      params:['strtYymm','endYymm'],
      status:r.status,
      rawItems:raw.length,
      rows:rows.length,
      error:''
    }]
  };
}

function releaseDateOf(row:any){
  if(!row.date)return '';
  const [y,m,d]=row.date.split('-').map(Number);
  if(d===10)return new Date(Date.UTC(y,m-1,11)).toISOString().slice(0,10);
  if(d===20)return new Date(Date.UTC(y,m-1,21)).toISOString().slice(0,10);
  if(d>=28){return new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);}
  return row.date;
}
function periodKey(row:any){
  if(!row.date)return '';
  const ym=row.date.slice(0,7), e=row.rangeEnd||Number(row.date.slice(8,10));
  if(e===10)return ym+'-10';
  if(e===20)return ym+'-20';
  if(e>=28)return ym+'-M';
  return row.date;
}
function previousMonthYm(ym:string){
  const [y,m]=ym.split('-').map(Number);return new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7);
}
function enrich(rows:any[],startDate:string,endDate:string){
  for(const r of rows){r.releaseDate=releaseDateOf(r);r.periodKey=periodKey(r);}
  rows.sort((a,b)=>String(a.periodKey).localeCompare(String(b.periodKey)));
  const byKey=new Map(rows.map(r=>[r.periodKey,r]));
  for(const r of rows){
    const ym=String(r.periodKey).slice(0,7), suffix=String(r.periodKey).slice(7);
    const py=(Number(ym.slice(0,4))-1)+ym.slice(4)+suffix;
    const pm=previousMonthYm(ym)+suffix;
    const yr=byKey.get(py), mr=byKey.get(pm);
    r.metrics={};
    for(let i=1;i<=10;i++){
      const k='item'+String(i).padStart(2,'0'),v=r.values[k];
      const yv=yr?.values?.[k],mv=mr?.values?.[k];
      r.metrics[k]={
        value:v,
        yoy:(v!==null&&yv!==null&&Number(yv)!==0)?Math.round(((Number(v)/Number(yv))-1)*1000)/10:null,
        mom:(v!==null&&mv!==null&&Number(mv)!==0)?Math.round(((Number(v)/Number(mv))-1)*1000)/10:null
      };
    }
  }
  const filtered=rows.filter(r=>{
    const rd=r.releaseDate||r.date;
    return rd && rd>=startDate && rd<=endDate;
  });
  return filtered.length?filtered:rows;
}

export async function GET(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'';
  if(op==='source')return NextResponse.json({
    source:'관세청_수출 주요품목별 10일 단위 잠정치 통계',
    base:BASE+'/getPrlstMmUtPrviExpAcrs',
    itemNames:ITEM_NAMES,
    cadence:'1~10일=11일, 1~20일=21일, 월전체=익월 1일',
    unit:'천 달러'
  },{headers:{'Cache-Control':'no-store'}});
  if(!validToken(requestToken(req)))return unauthorized();
  if(op==='ping')return NextResponse.json({ok:true,itemNames:ITEM_NAMES},{headers:{'Cache-Control':'no-store'}});
  return NextResponse.json({error:'BAD_OP'},{status:400});
}

export async function POST(req:Request){
  const u=new URL(req.url),op=u.searchParams.get('op')||'',body:any=await req.json().catch(()=>({}));
  if(op==='login'){
    if(!process.env.SESSION_SECRET)return NextResponse.json({error:'AUTH_NOT_CONFIGURED'},{status:503});
    if(!validPassword(String(body?.code||body?.password||'')))return NextResponse.json({error:'INVALID_CODE'},{status:401});
    return NextResponse.json({ok:true,token:createToken()},{headers:{'Cache-Control':'no-store'}});
  }
  if(!validToken(requestToken(req)))return unauthorized();
  if(op==='extraTrend'){
    const endDate=String(body.endDate||''),hs2=String(body.hs2||'').replace(/\D/g,'').slice(0,2);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||!/^\d{2}$/.test(hs2))return NextResponse.json({error:'BAD_EXTRA_TREND_REQUEST'},{status:400});
    const envKey=process.env.DATA_GO_KR_SERVICE_KEY||process.env.KCS_SERVICE_KEY||process.env.PUBLIC_DATA_SERVICE_KEY||'';
    try{
      const rows=await fetchExtraTrend(String(body.serviceKey||envKey),hs2,endDate);
      return NextResponse.json({ok:true,rows,hs2,name:HS2_NAMES[hs2]||('HS '+hs2),source:'관세청 품목별 수출입실적(GW)'},{headers:{'Cache-Control':'no-store'}});
    }catch(e:any){
      return NextResponse.json({error:'ITEMTRADE_FAILED',message:String(e?.message||e).slice(0,1200)},{status:502,headers:{'Cache-Control':'no-store'}});
    }
  }
  if(op==='query'){
    const startDate=String(body.startDate||''),endDate=String(body.endDate||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||startDate>endDate)
      return NextResponse.json({error:'BAD_DATE_RANGE'},{status:400});
    const envKey=process.env.DATA_GO_KR_SERVICE_KEY||process.env.KCS_SERVICE_KEY||process.env.PUBLIC_DATA_SERVICE_KEY||'';
    try{
      // Fetch 36 months from the selected end month so a clicked item can show
      // 24 completed monthly bars while still having the prior 12 months needed for Y/Y.
      const historyStart=monthStartOffset(endDate,-36);
      const got=await fetchOfficial(String(body.serviceKey||envKey),historyStart,lastDateOfMonth(endDate));
      const rows=enrich(got.rows,startDate,endDate);
      const trendRows=got.rows
        .filter((r:any)=>Number(r.rangeEnd||0)>=28 && (r.releaseDate||r.date) && (r.releaseDate||r.date)<=endDate)
        .sort((a:any,b:any)=>String(a.date).localeCompare(String(b.date)))
        .slice(-24)
        .map((r:any)=>({
          date:r.date,releaseDate:r.releaseDate,periodKey:r.periodKey,rangeEnd:r.rangeEnd,
          metrics:r.metrics
        }));
      let extraItems:any[]=[],extraMonth='',extraError='',extraDiagnostics:any=null,cosmeticsRank:any=null,cosmeticsItem:any=null;
      try{
        const extra=await fetchExtraTop50(String(body.serviceKey||envKey),endDate);
        extraItems=extra.items;extraMonth=extra.month;extraDiagnostics=extra.diagnostics;cosmeticsRank=extra.cosmeticsRank;cosmeticsItem=extra.cosmeticsItem;
      }catch(ex:any){
        extraError=String(ex?.message||ex).slice(0,1000);
      }
      return NextResponse.json({
        ok:true,rows,trendRows,itemNames:ITEM_NAMES,unit:'천 달러',
        extraItems,extraMonth,extraError,extraDiagnostics,cosmeticsRank,cosmeticsItem,
        endpoint:got.endpoint,diagnostics:got.diagnostics,
        source:'관세청·공공데이터포털',
        extraSource:'관세청 품목별 수출입실적(GW) · HS 2단위 월간 통계'
      },{headers:{'Cache-Control':'no-store'}});
    }catch(e:any){
      const msg=String(e?.message||e);
      if(msg==='DATA_GO_KR_KEY_REQUIRED')return NextResponse.json({error:'DATA_GO_KR_KEY_REQUIRED',message:'공공데이터포털 서비스키를 한 번 등록해 주세요.'},{status:428});
      return NextResponse.json({error:'OFFICIAL_API_FAILED',message:msg.slice(0,1800)},{status:502,headers:{'Cache-Control':'no-store'}});
    }
  }
  return NextResponse.json({error:'BAD_OP'},{status:400});
}
