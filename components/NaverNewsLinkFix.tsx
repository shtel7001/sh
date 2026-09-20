'use client';
import {useEffect} from 'react';

const OLD='finance.naver.com/item/news_news.naver';
function rewrite(a:HTMLAnchorElement){
  try{
    if(!a.href.includes(OLD))return;
    const u=new URL(a.href);
    const code=(u.searchParams.get('code')||'').match(/\d{6}/)?.[0];
    if(code)a.href=`https://m.stock.naver.com/domestic/stock/${code}/news`;
  }catch{}
}

export default function NaverNewsLinkFix(){
  useEffect(()=>{
    const scan=()=>document.querySelectorAll<HTMLAnchorElement>('a[href*="finance.naver.com/item/news_news.naver"]').forEach(rewrite);
    scan();
    const mo=new MutationObserver(scan);
    mo.observe(document.body,{childList:true,subtree:true});
    return()=>mo.disconnect();
  },[]);
  return null;
}
