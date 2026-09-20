import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import Dashboard from '@/components/Dashboard';
import NaverNewsLinkFix from '@/components/NaverNewsLinkFix';
export default async function Page(){if(!await isAuthed())redirect('/login');return <><NaverNewsLinkFix/><Dashboard/></>}
