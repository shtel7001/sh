import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import Dashboard from '@/components/Dashboard';
export default async function Page(){if(!await isAuthed())redirect('/login');return <Dashboard/>}
