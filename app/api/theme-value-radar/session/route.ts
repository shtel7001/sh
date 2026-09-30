import { NextRequest, NextResponse } from 'next/server';
import { isThemeValueAuthed } from '@/lib/theme-value-auth';
export const runtime='nodejs';
export async function GET(req:NextRequest){ return NextResponse.json({ok:isThemeValueAuthed(req)}); }
