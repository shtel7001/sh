import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import LoginForm from '@/components/LoginForm';

export default async function Login(){
  if(await isAuthed()) redirect('/');
  return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE ACCUMULATION RADAR</div><h1>기관·외국인 매집 초기 레이더</h1><p>KOSPI 500 + KOSDAQ 300에서 가격보다 수급이 먼저 움직이는 종목을 찾습니다.</p><LoginForm/><small>첫 인증 후 보안 쿠키가 유지되어 같은 기기에서는 반복 입력을 줄입니다.</small></section></main>
}
