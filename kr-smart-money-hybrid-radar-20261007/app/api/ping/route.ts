import { NextResponse } from 'next/server';
export function GET(){ return NextResponse.json({ok:true,configured:Boolean(process.env.SESSION_SECRET)}); }
