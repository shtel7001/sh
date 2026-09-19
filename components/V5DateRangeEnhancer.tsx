'use client';

import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';

const KEY='psr_v5_date_range';

export default function V5DateRangeEnhancer(){
  const [host,setHost]=useState<HTMLElement|null>(null);
  const [startDate,setStartDate]=useState('');
  const [endDate,setEndDate]=useState('');

  useEffect(()=>{
    try{
      const saved=JSON.parse(localStorage.getItem(KEY)||'{}');
      if(typeof saved.startDate==='string')setStartDate(saved.startDate);
      if(typeof saved.endDate==='string')setEndDate(saved.endDate);
    }catch{}

    let cancelled=false;
    const mount=()=>{
      if(cancelled)return;
      const rows=[...document.querySelectorAll<HTMLElement>('.quickRow')];
      const target=rows.find(el=>el.textContent?.includes('과거 검색기간'));
      if(!target){setTimeout(mount,250);return;}
      let node=document.getElementById('v5-date-range-host');
      if(!node){
        node=document.createElement('div');
        node.id='v5-date-range-host';
        target.insertAdjacentElement('afterend',node);
      }
      setHost(node);
    };
    mount();
    return()=>{cancelled=true;};
  },[]);

  useEffect(()=>{
    try{localStorage.setItem(KEY,JSON.stringify({startDate,endDate}));}catch{}
  },[startDate,endDate]);

  useEffect(()=>{
    const original=window.fetch.bind(window);
    window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
      if(url.includes('/api/v5scan')&&init?.body&&typeof init.body==='string'&&startDate&&endDate){
        try{
          const body=JSON.parse(init.body);
          body.startDate=startDate;
          body.endDate=endDate;
          return original(input,{...init,body:JSON.stringify(body)});
        }catch{}
      }
      return original(input,init);
    };
    return()=>{window.fetch=original;};
  },[startDate,endDate]);

  if(!host)return null;
  const active=Boolean(startDate&&endDate);
  const invalid=active&&startDate>endDate;
  const today=new Date().toISOString().slice(0,10);

  return createPortal(
    <section className={`dateRangeBox ${active?'active':''}`}>
      <div className="dateRangeTitle">
        <div><b>직접 날짜 구간 지정</b><small>날짜를 모두 입력하면 위 거래일 설정보다 우선 적용됩니다.</small></div>
        <button type="button" onClick={()=>{setStartDate('');setEndDate('');}}>날짜 초기화</button>
      </div>
      <div className="dateRangeGrid">
        <label><span>시작일</span><input type="date" value={startDate} max={endDate||today} onChange={e=>setStartDate(e.target.value)}/></label>
        <i>~</i>
        <label><span>종료일</span><input type="date" value={endDate} min={startDate||undefined} max={today} onChange={e=>setEndDate(e.target.value)}/></label>
      </div>
      <p className={invalid?'rangeError':''}>{invalid?'시작일은 종료일보다 앞선 날짜여야 합니다.':active?`적용 구간: ${startDate} ~ ${endDate}`:'날짜를 비워두면 기존 60·120·180·240거래일 설정을 사용합니다.'}</p>
    </section>,host
  );
}
