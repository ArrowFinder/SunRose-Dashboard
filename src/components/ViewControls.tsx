import {useState} from 'react';
import {useAppState} from '../context/AppStateContext';
export function useViewPreference(page:string){
 const {currentUser,supportSnapshot}=useAppState();const key=`sunrose:view:${currentUser?.id||'local'}:${page}:${supportSnapshot?'support':'own'}`;
 const [stored,setStored]=useState<{key:string;value:string}>(()=>{try{return {key,value:localStorage.getItem(key)==='list'?'list':'grid'};}catch{return {key,value:'grid'};}});
 const view=stored.key===key?stored.value:'grid';
 const setView=(value:string)=>{setStored({key,value});try{localStorage.setItem(key,value);}catch{/* Preference remains usable for this session. */}};
 return [view,setView] as const;
}
export function ViewControls({view,onChange}:{view:string;onChange:(value:string)=>void}){return <div className="row" role="group" aria-label="Display layout"><button className={`btn ${view==='grid'?'btn-primary':''}`} aria-pressed={view==='grid'} onClick={()=>onChange('grid')}>Grid</button><button className={`btn ${view==='list'?'btn-primary':''}`} aria-pressed={view==='list'} onClick={()=>onChange('list')}>List</button></div>;}
