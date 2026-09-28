// @ts-nocheck
import {createHash,timingSafeEqual} from 'crypto';
import {ACCESS_HASH,UA} from './config';
export const clean=(s:any='')=>String(s).replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export const pad=(n:number)=>String(n).padStart(2,'0');
export const ymd=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
export function parseYmd(s:string){const m=s.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);if(!m)return null;const d=new Date(+m[1],+m[2]-1,+m[3]);return Number.isNaN(d.getTime())?null:d}
export function addDays(s:string,n:number){const d=parseYmd(s)!;d.setDate(d.getDate()+n);return ymd(d)}
export const compact=(s:string)=>s.replace(/-/g,'');
export const fmtNaverDate=(s:string)=>s.replace(/-/g,'.');
export function verify(code:string|null){if(!code)return false;const got=createHash('sha256').update(code.trim()).digest(),exp=Buffer.from(ACCESS_HASH,'hex');return got.length===exp.length&&timingSafeEqual(got,exp)}
export const authorized=(req:Request)=>verify(req.headers.get('x-access-code')||req.headers.get('x-radar-key'));
export const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
export function num(v:any){const n=Number(String(v??'').replace(/,/g,'').replace(/[^0-9.+-]/g,''));return Number.isFinite(n)?n:null}
export function capEok(v:any){const s=String(v??'').replace(/,/g,'');let t=0,f=false;const a=s.match(/([0-9.]+)조/),b=s.match(/([0-9.]+)억/);if(a){t+=+a[1]*10000;f=true}if(b){t+=+b[1];f=true}return f?t:num(s)}
export async function fetchText(url:string,headers:any={}){const r=await fetch(url,{cache:'no-store',redirect:'follow',headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'ko-KR,ko;q=0.9,en-US;q=0.6','Referer':'https://search.naver.com/',...headers},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.text()}
export async function fetchJson(url:string,headers:any={}){const r=await fetch(url,{cache:'no-store',headers:{'User-Agent':UA,'Accept-Language':'ko-KR,ko;q=0.9',...headers},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json()}
export function validDate(y:number,m:number,d:number){const x=new Date(y,m-1,d,12);return x.getFullYear()===y&&x.getMonth()===m-1&&x.getDate()===d?x:null}
export function dateObj(y:number,m:number,d:number){const x=validDate(y,m,d);return x?ymd(x):''}
export const daysInMonth=(y:number,m:number)=>new Date(y,m,0).getDate();
export function inferYear(m:number,d:number,ref:Date){let y=ref.getFullYear();const c=validDate(y,m,d);if(c&&(c.getTime()-ref.getTime())/86400000<-45)y++;return y}
export function dday(date:string){const n=new Date(),today=new Date(n.getFullYear(),n.getMonth(),n.getDate()),d=parseYmd(date);return d?Math.round((d.getTime()-today.getTime())/86400000):99999}
export const sha=(s:string)=>createHash('sha1').update(s).digest('hex').slice(0,18);
