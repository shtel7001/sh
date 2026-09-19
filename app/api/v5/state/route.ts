import {NextResponse} from 'next/server';
import {isAuthed,unauthorized} from '@/lib/guard';
import {loadV5State,saveV5State,v5DbConfigured,V5_MAX_DETECTIONS,V5_MAX_LEARNING_RUNS} from '@/lib/v5db';
export const runtime='nodejs'; export const maxDuration=60;

export async function GET(){
  if(!await isAuthed())return unauthorized();
  if(!v5DbConfigured())return NextResponse.json({configured:false,reason:'DATABASE_URL 미설정',limits:{detections:V5_MAX_DETECTIONS,learningRuns:V5_MAX_LEARNING_RUNS}});
  try{const data=await loadV5State();return NextResponse.json({configured:true,...data,limits:{detections:V5_MAX_DETECTIONS,learningRuns:V5_MAX_LEARNING_RUNS}});}
  catch(e){return NextResponse.json({configured:false,error:e instanceof Error?e.message:'Neon DB 조회 실패'},{status:502});}
}

export async function POST(req:Request){
  if(!await isAuthed())return unauthorized();
  if(!v5DbConfigured())return NextResponse.json({configured:false,error:'Neon DB 미연결: DATABASE_URL 환경변수가 필요합니다.'},{status:503});
  const body=await req.json().catch(()=>({}));
  try{const counts=await saveV5State({weights:body?.weights,learning:body?.learning,round:body?.round,detections:body?.detections});return NextResponse.json({ok:true,configured:true,counts});}
  catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:'Neon DB 저장 실패'},{status:502});}
}
