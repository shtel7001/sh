'use client';
import {useState} from 'react';

const css=`*{box-sizing:border-box}body{margin:0;background:#f3f4f1;color:#161b24;font-family:Arial,'Noto Sans KR',sans-serif}.auth{min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(460px,100%);background:#fbfbf9;border-top:3px solid #161b24;border-bottom:1px solid #dcdfe3;padding:34px 30px 30px;box-shadow:0 14px 38px #17203310}.ey{font-size:12px;letter-spacing:1.6px;color:#657083;font-weight:800}.card h1{font-size:34px;line-height:1.12;margin:8px 0 10px;letter-spacing:-1.4px}.card p{color:#657083;line-height:1.7;margin:0 0 24px}.code{display:block;width:100%;height:58px;border:1px solid #b9c0ca;border-radius:7px;background:#fff;padding:0 16px;font-size:25px;font-weight:900;letter-spacing:7px;text-align:center;color:#161b24;outline:none}.code:focus{border:2px solid #1f56c4}.btn{width:100%;height:52px;margin-top:14px;border:0;border-radius:7px;background:#161b24;color:white;font-size:16px;font-weight:900;cursor:pointer}.btn:disabled{opacity:.5}.msg{min-height:24px;margin:12px 0 0!important;font-size:13px}.bad{color:#bd2e2e!important}.ok{color:#1f56c4!important}.note{margin-top:24px;border-top:1px solid #dcdfe3;padding-top:16px;color:#657083;font-size:12px;line-height:1.65}.lock{width:40px;height:40px;border:2px solid #1f56c4;border-radius:20px;display:grid;place-items:center;margin-bottom:18px;font-weight:900;color:#1f56c4}@media(max-width:520px){.card{padding:28px 20px}.card h1{font-size:29px}}`;

export default function Login(){
  const[code,setCode]=useState(''); const[busy,setBusy]=useState(false); const[msg,setMsg]=useState(''); const[state,setState]=useState('');
  async function submit(e){
    e.preventDefault(); if(busy)return;
    const clean=code.replace(/\D/g,'').slice(0,6); setCode(clean);
    if(clean.length!==6){setState('bad');setMsg('6자리 인증번호를 입력해 주세요.');return;}
    setBusy(true);setMsg('인증번호를 확인하는 중입니다…');setState('');
    try{
      const r=await fetch('/api/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:clean}),cache:'no-store'});
      const j=await r.json().catch(()=>({}));
      if(r.ok&&j.ok){setState('ok');setMsg('인증되었습니다. 이 인증번호는 이제 폐기됩니다.');location.replace('/');return;}
      setState('bad');
      if(j.error==='CODE_ALREADY_USED')setMsg('이미 사용되어 폐기된 인증번호입니다.');
      else if(j.error==='TOO_MANY_ATTEMPTS')setMsg('입력 횟수가 많습니다. 잠시 후 다시 시도해 주세요.');
      else if(j.error==='AUTH_SERVICE_ERROR')setMsg('인증 서버 연결에 문제가 있습니다. 잠시 후 다시 시도해 주세요.');
      else setMsg('인증번호가 맞지 않습니다.');
    }catch{setState('bad');setMsg('네트워크 연결을 확인해 주세요.');}
    finally{setBusy(false);}
  }
  return <><style>{css}</style><main className="auth"><section className="card"><div className="lock">1×</div><div className="ey">PRIVATE ACCESS · ONE-TIME CODE</div><h1>한국주식 저점 스크리너<br/>1회용 인증</h1><p>발급된 6자리 개인 인증번호는 한 번만 사용할 수 있습니다. 인증 후에는 이 기기에서 세션이 유지됩니다.</p><form onSubmit={submit}><input className="code" inputMode="numeric" autoComplete="one-time-code" maxLength="6" placeholder="000000" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} autoFocus/><button className="btn" disabled={busy||code.length!==6}>{busy?'확인 중…':'인증하고 들어가기'}</button></form><p className={`msg ${state}`}>{msg}</p><div className="note">• 인증번호는 성공 즉시 서버에서 사용 처리됩니다.<br/>• 동일 번호 재입력은 거부됩니다.<br/>• 로그인 세션은 최대 30일 유지됩니다.<br/>• 새 기기나 세션 만료 후에는 새 인증번호가 필요합니다.</div></section></main></>;
}
