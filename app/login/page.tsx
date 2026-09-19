import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE PRE-SPIKE RADAR V5</div><h1>급등 전조 사전탐지 레이더 V5</h1><p>이미 급등한 종목보다 가격이 아직 덜 움직인 선행 후보를 먼저 찾고, 과거 급등 직전 패턴·뉴스 변화·수급으로 확인합니다.</p><LoginForm/><small>기존 개인 인증 환경을 그대로 사용하며 비밀번호는 브라우저 localStorage에 저장하지 않습니다.</small></section></main>}
