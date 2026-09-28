(async function loadGcRadarParts(){
  const parts=[
    '/gc-retrace-ma5-double-bottom-radar-20260928-1.js',
    '/gc-retrace-ma5-double-bottom-radar-20260928-2.js',
    '/gc-retrace-ma5-double-bottom-radar-20260928-3.js',
    '/gc-retrace-ma5-double-bottom-radar-20260928-4.js'
  ];
  const texts=[];
  for(const src of parts){
    const r=await fetch(src,{cache:'no-store'});
    if(!r.ok) throw new Error(`스크립트 로드 실패: ${src} (HTTP ${r.status})`);
    texts.push(await r.text());
  }
  const s=document.createElement('script');
  s.textContent=texts.join('\n');
  document.body.appendChild(s);
})().catch(err=>{
  const el=document.getElementById('loginErr')||document.getElementById('status');
  if(el) el.textContent=err.message||String(err);
  console.error(err);
});
