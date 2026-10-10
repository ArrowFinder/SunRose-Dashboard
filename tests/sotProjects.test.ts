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
