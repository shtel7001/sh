import {NextResponse} from 'next/server';
import {isAuthed,unauthorized} from '@/lib/guard';
import {learnWeights} from '@/lib/learning';
export const runtime='nodejs';
export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  const body=await req.json().catch(()=>({}));
  const stats=Array.isArray(body?.stats)?body.stats.slice(0,800):[];
  const tracking=Array.isArray(body?.tracking)?body.tracking.slice(-200):[];
  return NextResponse.json(learnWeights({stats,tracking,previous:body?.previous||{}}));
}
