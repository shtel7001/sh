// @ts-nocheck
import {authorized,json} from '../../../lib/naver-future-event/base';
import {SEARCH_TERMS,WINDOW_DAYS,TASKS_PER_BATCH} from '../../../lib/naver-future-event/config';
import {universe,tradingRange} from '../../../lib/naver-future-event/stocks';
import {buildTasks,searchTask,health} from '../../../lib/naver-future-event/news';
import {eventFromArticle} from '../../../lib/naver-future-event/events';
export const runtime='nodejs';export const maxDuration=60;export const dynamic='force-dynamic';
export async function GET(req:Request){const u=new URL(req.url),mode=u.searchParams.get('mode')||'batch';if(mode==='health')return json(await health());if(!authorized(req))return json({ok:false,error:'UNAUTHORIZED'},401);if(mode==='ping')return json({ok:true,auth:'valid'});
 const trades=Math.max(20,Math.min(240,Number(u.searchParams.get('trades')||240))),pageDepth=Math.max(1,Math.min(3,Number(u.searchParams.get('pageDepth')||2))),horizon=Math.max(30,Math.min(1460,Number(u.searchParams.get('horizon')||730))),range=await tradingRange(trades),{windows,tasks}=buildTasks(range,pageDepth),totalBatches=Math.ceil(tasks.length/TASKS_PER_BATCH);
 if(mode==='plan'){const stocks=await universe().catch(()=>[]);return json({ok:true,trades,pageDepth,horizon,range:{start:range.start,end:range.end},windowDays:WINDOW_DAYS,windows:windows.length,terms:SEARCH_TERMS.length,totalTasks:tasks.length,tasksPerBatch:TASKS_PER_BATCH,totalBatches,universeCount:stocks.length,searchTerms:SEARCH_TERMS})}
 const batch=Math.max(0,Math.min(totalBatches-1,Number(u.searchParams.get('batch')||0))),selected=tasks.slice(batch*TASKS_PER_BATCH,(batch+1)*TASKS_PER_BATCH),started=Date.now(),[stocks,chunks]=await Promise.all([universe().catch(()=>[]),Promise.all(selected.map(searchTask))]),raw=chunks.flat(),articleSeen=new Set<string>(),articles:any[]=[];
 for(const a of raw){const k=(a.naverNewsUrl||a.originUrl||a.title).replace(/[?#].*$/,'');if(!articleSeen.has(k)){articleSeen.add(k);articles.push(a)}}const events=articles.flatMap(a=>eventFromArticle(a,stocks,horizon)),seen=new Set<string>(),unique=events.filter(e=>!seen.has(e.id)&&!!seen.add(e.id)).sort((a,b)=>a.eventDate.localeCompare(b.eventDate)||b.score-a.score);
 return json({ok:true,batch,totalBatches,completed:batch+1>=totalBatches,range:{start:range.start,end:range.end},trades,pageDepth,horizon,tasks:selected,articleCount:articles.length,eventCount:unique.length,events:unique,elapsedMs:Date.now()-started,universeCount:stocks.length})}
