import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supportedProposal,duplicateWork,proposalIdentity} from '../supabase/functions/sot/truth.ts';
import type {Proposal} from '../supabase/functions/sot/core.ts';
const p:Proposal={kind:'task',title:'Review the Inspirational Women press release',description:'Review requested copy',client_name:'LA Times Studios',client_id:'lat',contact_email:'client@latimes.com',parent_id:null,task_id:null,project_id:'iw',new_project_name:null,due_date:null,estimated_hours:null,evidence:'Please review the press release.',source_message_id:'m1',work_state:'outstanding'};
test('actual quotations are required, not invented or footer-only evidence',()=>{
 assert.ok(supportedProposal(p,{subject:'Press release',body:p.evidence}));
 assert.equal(supportedProposal(p,{subject:'Press release',body:'No request here'}),false);
 assert.equal(supportedProposal({...p,evidence:'Copyright 2026 LA Times Studios'},{subject:'',body:'Copyright 2026 LA Times Studios'}),false);
});
test('sent, cancelled and unknown work cannot become a new task; completion requires completed state',()=>{
 for(const quote of ['We sent the Premium Seating email yesterday.','Already completed the copy.','The campaign is cancelled.'])assert.equal(supportedProposal({...p,evidence:quote},{subject:'',body:quote}),false);
 assert.equal(supportedProposal({...p,work_state:'unknown'},{subject:'',body:p.evidence}),false);
 assert.equal(supportedProposal({...p,kind:'complete'},{subject:'',body:p.evidence}),false);
 assert.ok(supportedProposal({...p,kind:'complete',work_state:'completed',evidence:'The copy has been delivered.'},{subject:'',body:'The copy has been delivered.'}));
});
test('project scope is independent of task extraction and needs a confirmed client and project quote',()=>{
 const project={...p,kind:'project' as const,work_state:'ongoing' as const,title:'Inspirational Women 2026',project_evidence:'Our Inspirational Women campaign includes newsletters.'};
 const body=p.evidence+' '+project.project_evidence;
 assert.ok(supportedProposal(project,{subject:'',body}));
 assert.equal(supportedProposal({...project,client_id:null},{subject:'',body}),false);
 assert.equal(supportedProposal({...project,project_evidence:'Invented scope'},{subject:'',body}),false);
});
test('exact repeats dedupe across messages but distinct clients, events and deadlines remain separate',()=>{
 const known={...p,id:'existing'};
 assert.equal(duplicateWork({...p,title:'Review the Inspirational Women press release!'},[known])?.exact,true);
 assert.equal(proposalIdentity(p),proposalIdentity({...p,source_message_id:'another-thread'}));
 for(const patch of [{client_id:'other'},{project_id:'tech'},{due_date:'2026-11-01'},{parent_id:'parent'}])assert.equal(duplicateWork({...p,...patch},[known]),null);
 assert.notEqual(proposalIdentity({...p,kind:'project',title:'October 11 2026 Flea Market'}),proposalIdentity({...p,kind:'project',title:'November 8 2026 Flea Market'}));
});
