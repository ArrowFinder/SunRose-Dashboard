import type {TimeEntry} from './types';
export type Period='weekly'|'biweekly'|'semimonthly'|'monthly'|'custom';
export function localDay(d=new Date()) {return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function periodEnd(start:string,period:Period){
 const d=new Date(start+'T12:00:00');
 if(period==='weekly'||period==='biweekly')d.setDate(d.getDate()+(period==='weekly'?6:13));
 if(period==='monthly')d.setMonth(d.getMonth()+1,0);
 if(period==='semimonthly')d.setDate(d.getDate()<=15?15:new Date(d.getFullYear(),d.getMonth()+1,0).getDate());
 return localDay(d);
}
export function rangeMinutes(e:TimeEntry,from:string,through:string){
 if(e.voidedAt)return 0;
 const start=Date.parse(e.startedAt),end=Date.parse(e.endedAt);
 const left=new Date(from+'T00:00:00').getTime(),rightDate=new Date(through+'T00:00:00');rightDate.setDate(rightDate.getDate()+1);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return 0;
 if(end===start)return start>=left&&start<rightDate.getTime()?e.durationMinutes:0;
 return e.durationMinutes*Math.max(0,Math.min(end,rightDate.getTime())-Math.max(start,left))/(end-start);
}
export function timeCsv(rows:(string|number)[][]){return rows.map(row=>row.map(v=>{const text=String(v);return '"'+(/^[\s]*[=+@\-\t\r]/.test(text)?"'"+text:text).replaceAll('"','""')+'"';}).join(',')).join('\r\n');}
export function localDateTime(value:string){const d=new Date(value);return localDay(d)+'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
