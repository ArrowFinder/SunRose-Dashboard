import type {SotSuggestion} from '../lib/sot';
const labels={client:'New client',project:'New project',task:'New task',subtask:'New subtask',update:'Task update',complete:'Task completion'};
const paths={
 client:'M4 21V3h12v18M16 9h4v12M2 21h20M8 7h4M8 11h4M8 15h4M9 21v-2h2v2',
 project:'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
 task:'M9 11l3 3 8-9M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10',
 subtask:'M5 3v12a3 3 0 0 0 3 3h12M15 13l5 5-5 5M9 4h11',
 update:'M20 7a8 8 0 1 0 0 10M20 3v5h-5',
 complete:'M4 12l5 5L20 6',
};
export function SotTypeBadge({suggestion}:{suggestion:Pick<SotSuggestion,'kind'|'payload'>}){
 const type=suggestion.kind==='task'&&suggestion.payload.parent_id?'subtask':suggestion.kind;
 return <div className={`sot-type-badge sot-type-${type}`}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[type]}/></svg><span>{labels[type]}</span><small>Suggested by SOT</small></div>;
}
