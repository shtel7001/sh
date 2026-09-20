import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import KosdaqDashboard from '@/components/KosdaqDashboard';
import NaverNewsLinkFix from '@/components/NaverNewsLinkFix';
export default async function Page(){if(!await isAuthed())redirect('/login');return <><NaverNewsLinkFix/><KosdaqDashboard/></>}
