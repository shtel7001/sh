import {NextResponse} from 'next/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
  const keys=['SESSION_SECRET','RADAR_PASSWORD','KV_REST_API_URL','KV_REST_API_TOKEN','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','BLOB_READ_WRITE_TOKEN','EDGE_CONFIG','REDIS_URL'];
  const present=Object.fromEntries(keys.map(k=>[k,Boolean(process.env[k])]));
  return NextResponse.json({ok:true,present});
}
