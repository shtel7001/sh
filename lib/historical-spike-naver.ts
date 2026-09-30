const UA='Mozilla/5.0 (Linux; Android 16; Mobile) AppleWebKit/537.36 Chrome/140 Safari/537.36';
export function num(v:any):number|null{
  if(v===null||v===undefined) return null;
  const x=Number(String(v).replace(/,/g,'').replace(/[^0-9+\-.]/g,''));
  return Number.isFinite(x)?x:null;
}
export async function jfetch(url:string,timeout=12000){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*','referer':'https://m.stock.naver.com/'},signal:c.signal,cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
export function estimatedPage(target:string,pageSize=60){
  const now=new Date(); const t=new Date(`${target}T12:00:00+09:00`);
  const cal=Math.max(0,Math.floor((now.getTime()-t.getTime())/86400000));
  const trading=Math.floor(cal*5/7); return Math.max(1,Math.floor(trading/pageSize)+1);
}
async function pricePage(code:string,page=1,pageSize=60){
  return jfetch(`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/price?pageSize=${pageSize}&page=${page}`,12000);
}
export async function findBar(code:string,target:string){
  const guess=estimatedPage(target,60);
  const pages=[...new Set([guess,guess-1,guess+1,guess-2,guess+2].filter(x=>x>0&&x<=6))];
  for(const p of pages){
    try{
      const arr=await pricePage(code,p,60);
      if(!Array.isArray(arr)||!arr.length) continue;
      const exact=arr.find((x:any)=>x.localTradedAt===target);
      if(exact) return exact;
      const oldest=arr[arr.length-1]?.localTradedAt, newest=arr[0]?.localTradedAt;
      if(oldest&&newest&&target>=oldest&&target<=newest) break;
    }catch{}
  }
  return null;
}
export function within240(date:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t=new Date(`${date}T12:00:00+09:00`).getTime(); const now=Date.now();
  const diff=(now-t)/86400000; return diff>=-1 && diff<=241;
}
