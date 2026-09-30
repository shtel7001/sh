import { NextRequest, NextResponse } from 'next/server';
import { isThemeRotationAuthed } from '@/lib/naver-theme-rotation-auth';
export const runtime='nodejs';
export async function GET(req:NextRequest){return NextResponse.json({ok:isThemeRotationAuthed(req)});}
