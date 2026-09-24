import {NextResponse} from 'next/server';import {isAuthed} from '../../_lib/auth';
export const runtime='nodejs';export function GET(req){return NextResponse.json({ok:true,authenticated:isAuthed(req)})}
