import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import LoginForm from '@/components/LoginForm';
export default async function Login(){if(await isAuthed())redirect('/');return <main className="loginWrap"><section className="loginCard"><div className="eyebrow">PRIVATE NEXT-DAY RADAR</div><h1>내일 급등 전조 레이더</h1><p>18:00 장후 데이터에서 코스피·코스닥의 대량거래, 눌림목, 이동평균, 뉴스·공시 촉매를 함께 확인합니다.</p><LoginForm/><small>개인 인증 후 이용합니다. 비밀번호는 브라우저 localStorage에 저장하지 않습니다.</small></section></main>}
