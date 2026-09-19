import { redirect } from 'next/navigation';
import { isAuthed } from '@/lib/guard';
import InstitutionRadar from '@/components/InstitutionRadar';

export default async function Page(){
  if(!(await isAuthed())) redirect('/login');
  return <InstitutionRadar/>;
}
