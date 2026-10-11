// Fetch every page before selecting bounded prompt context. No global newest-N blind spot.
export async function allPages<T>(query:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>,size=500):Promise<T[]> {
 const rows:T[]=[];
 for(let from=0;;from+=size){const r=await query(from,from+size-1);if(r.error)throw new Error('SOT could not load complete workspace context. Please retry.');rows.push(...(r.data||[]));if(!r.data||r.data.length<size)return rows;}
}
export function relevantWork<T extends {title?:string;name?:string;status?:string;archived_at?:string|null}>(rows:T[],text:string,limit:number){
 const words=new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]);
 const score=(r:T)=>((r.title||r.name||'').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]).reduce((n,w)=>n+(words.has(w)?1:0),0);
 return [...rows].sort((a,b)=>score(b)-score(a)||Number(!!a.archived_at)-Number(!!b.archived_at)||Number(a.status==='done')-Number(b.status==='done')).slice(0,limit);
}
