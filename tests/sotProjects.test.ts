import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveProject} from '../supabase/functions/sot/projects.ts';
const projects=[{id:'p1',client_id:'c1',name:'November Email Campaign',stage:'active'},{id:'p2',client_id:'c2',name:'Other client',stage:'active'}];
const base={kind:'task',client_id:'c1',project_id:'p1',new_project_name:null,parent_id:null,task_id:null,project_evidence:'November Email Campaign'};
test('known project matches require same client and a supporting source passage',()=>{
 assert.equal(resolveProject(base,projects,[],'Please write copy for November Email Campaign.').project_id,'p1');
 assert.equal(resolveProject({...base,project_id:'p2'},projects,[],'November Email Campaign').project_match,'uncertain');
 assert.equal(resolveProject(base,projects,[],'Something else').project_match,'uncertain');
});
test('new initiative is proposed only with evidence and duplicate project names resolve to existing',()=>{
 const p={...base,project_id:null,new_project_name:'Holiday campaign',project_evidence:'Launch our Holiday campaign'};
 assert.equal(resolveProject(p,projects,[],'Launch our Holiday campaign next month').project_match,'new');
 assert.equal(resolveProject(p,projects,[],'No evidence').new_project_name,null);
 assert.equal(resolveProject({...p,new_project_name:'november email campaign'},projects,[],'Launch our Holiday campaign').project_id,'p1');
});
test('subtasks and updates inherit the existing task project',()=>{
 const tasks=[{id:'root',client_id:'c1',project_id:'p1',parent_id:null}];
 assert.equal(resolveProject({...base,parent_id:'root',project_id:'p2',project_evidence:null},projects,tasks,'').project_id,'p1');
 assert.equal(resolveProject({...base,kind:'update',task_id:'root'},projects,tasks,'').project_id,'p1');
 assert.equal(resolveProject({...base,project_id:null,project_evidence:null},projects,tasks,'').project_match,'uncertain');
});
test('recurring event projects require evidence for the specific occurrence',()=>{
 const events=[{id:'oct',client_id:'c1',name:'October 11th 2026 Flea Market',stage:'active'},{id:'nov',client_id:'c1',name:'November 8th 2026 Flea Market',stage:'planned'}];
 const proposal={...base,project_id:'oct',project_evidence:'Arrival for November 8th 2026 Flea Market'};
 assert.equal(resolveProject(proposal,events,[],proposal.project_evidence).project_match,'uncertain');
 const right={...proposal,project_evidence:'Arrival for October 11, 2026 Flea Market'};
 assert.equal(resolveProject(right,events,[],right.project_evidence).project_id,'oct');
 assert.equal(resolveProject({...right,project_evidence:'Coordinate arrival'},events,[],'Coordinate arrival').project_match,'uncertain');
 assert.equal(resolveProject({...right,project_evidence:'October 11 and November 8'},events,[],'October 11 and November 8').project_match,'uncertain');
 assert.equal(resolveProject({...right,project_evidence:'2026-10-11'},events,[],'2026-10-11').project_id,'oct');
});
test('new dated projects and ambiguous annual repeats need matching event evidence',()=>{
 const p={...base,project_id:null,new_project_name:'November 8th 2026 Flea Market',project_evidence:'October 11th 2026 Flea Market'};
 assert.equal(resolveProject(p,[],[],p.project_evidence).project_match,'uncertain');
 const repeats=[2026,2027].map(y=>({id:String(y),client_id:'c1',name:`October 11th ${y} Flea Market`,stage:'active'}));
 assert.equal(resolveProject({...base,project_id:'2026',project_evidence:'October 11'},repeats,[],'October 11').project_match,'uncertain');
});
