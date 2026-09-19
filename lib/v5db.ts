import { neon } from '@neondatabase/serverless';
import { BASE_WEIGHTS, type Weights } from './learning';

export const V5_MAX_DETECTIONS = 5000;
export const V5_MAX_LEARNING_RUNS = 200;

export function v5DatabaseUrl(){
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || '';
}

export function v5DbConfigured(){ return Boolean(v5DatabaseUrl()); }

function sql(){
  const url=v5DatabaseUrl();
  if(!url) throw new Error('Neon DB 미연결: DATABASE_URL 환경변수가 필요합니다.');
  return neon(url);
}

export async function ensureV5Schema(){
  const q=sql();
  await q`CREATE TABLE IF NOT EXISTS v5_state (
    id text PRIMARY KEY,
    weights jsonb NOT NULL,
    learning jsonb,
    round integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await q`CREATE TABLE IF NOT EXISTS v5_detections (
    id bigserial PRIMARY KEY,
    detection_date date NOT NULL,
    code text NOT NULL,
    payload jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(detection_date, code)
  )`;
  await q`CREATE INDEX IF NOT EXISTS v5_detections_date_idx ON v5_detections(detection_date DESC)`;
  await q`CREATE TABLE IF NOT EXISTS v5_learning_runs (
    id bigserial PRIMARY KEY,
    learned_at timestamptz NOT NULL DEFAULT now(),
    round integer NOT NULL,
    weights jsonb NOT NULL,
    metrics jsonb
  )`;
}

export async function loadV5State(){
  await ensureV5Schema();
  const q=sql();
  const state=await q`SELECT weights,learning,round,updated_at FROM v5_state WHERE id='global' LIMIT 1`;
  const det=await q`SELECT payload FROM v5_detections ORDER BY detection_date DESC,id DESC LIMIT 500`;
  const counts=await q`SELECT
    (SELECT count(*)::int FROM v5_detections) AS detections,
    (SELECT count(*)::int FROM v5_learning_runs) AS learning_runs`;
  const row:any=state[0]||null;
  return {
    weights:(row?.weights||BASE_WEIGHTS) as Weights,
    learning:row?.learning||null,
    round:Number(row?.round||0),
    updatedAt:row?.updated_at||null,
    detections:det.map((x:any)=>x.payload),
    counts:counts[0]||{detections:0,learning_runs:0}
  };
}

export async function saveV5State(input:{weights?:Weights;learning?:any;round?:number;detections?:any[]}){
  await ensureV5Schema();
  const q=sql();
  const weights=input.weights||BASE_WEIGHTS;
  const learning=input.learning??null;
  const round=Number(input.round||0);
  await q`INSERT INTO v5_state(id,weights,learning,round,updated_at)
    VALUES('global',${JSON.stringify(weights)}::jsonb,${JSON.stringify(learning)}::jsonb,${round},now())
    ON CONFLICT(id) DO UPDATE SET weights=EXCLUDED.weights,learning=EXCLUDED.learning,round=EXCLUDED.round,updated_at=now()`;

  const detections=(Array.isArray(input.detections)?input.detections:[])
    .filter(x=>x?.date&&x?.code)
    .slice(-250);
  if(detections.length){
    await q`INSERT INTO v5_detections(detection_date,code,payload,updated_at)
      SELECT (x->>'date')::date, x->>'code', x, now()
      FROM jsonb_array_elements(${JSON.stringify(detections)}::jsonb) AS x
      ON CONFLICT(detection_date,code) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`;
  }
  if(learning){
    await q`INSERT INTO v5_learning_runs(round,weights,metrics)
      VALUES(${round},${JSON.stringify(weights)}::jsonb,${JSON.stringify(learning?.metrics||null)}::jsonb)`;
  }
  await q`DELETE FROM v5_detections WHERE id IN (
    SELECT id FROM v5_detections ORDER BY detection_date DESC,id DESC OFFSET ${V5_MAX_DETECTIONS}
  )`;
  await q`DELETE FROM v5_learning_runs WHERE id IN (
    SELECT id FROM v5_learning_runs ORDER BY id DESC OFFSET ${V5_MAX_LEARNING_RUNS}
  )`;
  const counts=await q`SELECT
    (SELECT count(*)::int FROM v5_detections) AS detections,
    (SELECT count(*)::int FROM v5_learning_runs) AS learning_runs`;
  return counts[0]||{};
}
