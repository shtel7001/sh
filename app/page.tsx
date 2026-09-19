import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import DashboardV4 from '@/components/DashboardV4';
export default async function Page(){if(!await isAuthed())redirect('/login');return <DashboardV4/>}
