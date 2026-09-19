import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE RADAR · V6</div><h1>기관·외국인 초기매집 레이더 V6</h1><p>KOSPI 500 + KOSDAQ 300에서 급등 전 초기매집과 유사한 수급·거래량 패턴을 찾습니다.</p><LoginForm/><small>비밀번호는 브라우저 localStorage에 저장하지 않습니다.</small></section></main>}
