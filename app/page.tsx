import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import DashboardV5 from '@/components/DashboardV5';
export default async function Page(){if(!await isAuthed())redirect('/login');return <DashboardV5/>}
