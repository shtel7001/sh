import { NextResponse } from 'next/server';
export const dynamic='force-dynamic';
const H={'User-Agent':'Mozilla/5.0','Accept':'application/json','Referer':'https://m.stock.naver.com/'};
function d(v:any){const s=String(v??'').replace(/\D/g,'');return s.length>=8?s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8):''}
export async function GET(){
  try{
    const r=await fetch('https://api.stock.naver.com/chart/domestic/item/005930?periodType=dayCandle&count=20',{headers:H,cache:'no-store'});
    const j=await r.json();
    const rows=(j.priceInfos||[]).map((p:any)=>({date:d(p.localDate),close:Number(p.closePrice)})).filter((x:any)=>x.date);
    const hit=rows.find((x:any)=>x.date==='2026-10-06');
    return NextResponse.json({ok:r.ok,status:r.status,count:rows.length,first:rows[0],last:rows[rows.length-1],hit});
  }catch(e:any){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500})}
}