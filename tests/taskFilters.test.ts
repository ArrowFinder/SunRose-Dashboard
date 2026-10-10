import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultTaskFilters,filterTasks} from '../src/lib/taskFilters.ts';
import type {AppBundle,WorkItem} from '../src/lib/types.ts';
const task=(id:string,patch:Partial<WorkItem>={}):WorkItem=>({id,clientId:'a',projectId:'p',yearMonth:'2026-10',title:id,description:'',source:'internal',status:'planned',scopeCategory:'in_scope',estimatedHours:0,actualHours:0,priority:10,createdAt:'',updatedAt:'2026-10-01',...patch});
const data:AppBundle={clients:[{id:'a',name:'Client A',retainerHoursPerMonth:0,shareToken:'',createdAt:''},{id:'b',name:'Client B',retainerHoursPerMonth:0,shareToken:'',createdAt:'',archivedAt:'2026-10-01'}],users:[],projects:[],timeEntries:[],taskTemplates:[],workItems:[task('undated'),task('today',{dueDate:'2026-10-10',assignedUserId:'person'}),task('past',{dueDate:'2026-10-09'}),task('done',{status:'done',dueDate:'2026-10-08'}),task('archived',{archivedAt:'2026-10-01'}),task('archived-client',{clientId:'b'}),task('parent',{dueDate:'2026-10-09'}),task('child',{parentId:'parent',status:'done'})]};
const titles=(f={})=>filterTasks(data,{...defaultTaskFilters,...f},'2026-10-10').map(t=>t.id);
test('default tasks exclude completed parents, completed children and archived work; undated sorts last',()=>assert.deepEqual(titles(),['past','today','undated']));
test('deadline, assignee and project filters combine',()=>{
 assert.deepEqual(titles({due:'today',assignee:'person',project:'p'}),['today']);
 assert.deepEqual(titles({due:'overdue'}),['past']);
 assert.deepEqual(titles({due:'undated',assignee:'unassigned'}),['undated']);
 assert.deepEqual(titles({from:'2026-10-10',to:'2026-10-10'}),['today']);
});
test('search, archive opt-in, status and hierarchy filters work independently',()=>{
 assert.deepEqual(titles({search:'client a',due:'today'}),['today']);
 assert.deepEqual(titles({status:'done',kind:'subtask'}),['child']);
 assert.ok(titles({archived:true}).includes('archived-client'));
 assert.deepEqual(titles({project:'wrong'}),[]);
 assert.deepEqual(titles({from:'2026-11-01',to:'2026-10-01'}),[]);
});
