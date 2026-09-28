(async function loadGcRadarParts(){
  const parts=[
    '/gc-retrace-ma5-double-bottom-radar-20260928-1.js',
    '/gc-retrace-ma5-double-bottom-radar-20260928-2.js',
    '/gc-retrace-ma5-double-bottom-radar-20260928-3.js',
    '/gc-retrace-ma5-double-bottom-radar-20260928-4.js'
  ];
  for(const src of parts){
    await new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src=src;
      s.async=false;
      s.onload=resolve;
      s.onerror=()=>reject(new Error(`스크립트 로드 실패: ${src}`));
      document.body.appendChild(s);
    });
  }
})().catch(err=>{
  const el=document.getElementById('loginErr')||document.getElementById('status');
  if(el) el.textContent=err.message||String(err);
  console.error(err);
});
