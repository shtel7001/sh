import {NextResponse} from 'next/server';
import {deriveOtp} from '../../../../../lib/auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const H={'User-Agent':'Mozilla/5.0','Accept':'application/json'};
export async function GET(){
  try{
    const [otp,listR,priceR]=await Promise.all([
      deriveOtp(),
      fetch('https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=1&pageSize=5',{cache:'no-store',headers:H}),
      fetch('https://m.stock.naver.com/api/stock/005930/price?pageSize=20&page=1',{cache:'no-store',headers:H})
    ]);
    const list=listR.ok?await listR.json():null;
    const price=priceR.ok?await priceR.json():null;
    return NextResponse.json({ok:true,otp,kospiHttp:listR.status,kospiRows:list?.stocks?.length||0,kospiTotal:list?.totalCount||0,priceHttp:priceR.status,samsungBars:Array.isArray(price)?price.length:0});
  }catch(e){return NextResponse.json({ok:false,error:String(e?.message||e)},{status:500});}
}
