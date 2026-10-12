import {cleanMessages} from '../supabase/functions/sot/sections.ts';
import {validateBatchThread} from '../supabase/functions/sot/validation.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conversationSections,conversationPacket,restoreSourceIds,hasQueuedMessages,prioritizeConversations,conversationSchema,conversationInstructions} from '../supabase/functions/sot/conversations.ts';
const message=(id:string,body:string)=>({id,date:'2026-10-11T10:00:00Z',from:'client@example.test',to:'sierra@sunrosecreative.com',body});
test('ordinary conversations remain complete and source IDs round trip',()=>{
 const messages=[message('gmail-a','Please draft the launch copy.'),message('gmail-b','Cancel the launch copy request.')];
 const result=conversationPacket({payload:{messages}}, {clients:[],tasks:[],projects:[]});
 assert.equal(result.total,1);const input=JSON.parse(result.input);assert.equal(input.messages.length,2);assert.equal(input.messages[1].body,messages[1].body);
 assert.deepEqual(restoreSourceIds([{source_message_id:'email_2'}],result.aliases),[{source_message_id:'gmail-b'}]);
});
test('long thread splits without losing text and carries candidates until final section',()=>{
 const messages=[message('long','work detail '.repeat(20000))];
 const sections=conversationSections(messages);assert.ok(sections.length>1);
 const reconstructed=sections.flat().map(m=>m.body.slice(m.overlap)).join('');assert.equal(reconstructed,messages[0].body);
 const packet=conversationPacket({payload:{messages,analysis:{format:2,index:1,candidates:[{source_message_id:'long',title:'Draft copy'}]}}},{clients:[]});
 assert.equal(packet.index,1);assert.equal(JSON.parse(packet.input).previous_candidates[0].source_message_id,'email_1');assert.ok(Buffer.byteLength(packet.input)<=208000);
 const final=conversationPacket({payload:{messages,analysis:{format:2,index:sections.length-1,candidates:[]}}},{clients:[]});assert.equal(JSON.parse(final.input).section.final,true);
});

test('legacy empty queue rows cannot enter analysis',()=>{
 for(const payload of [null,{}, {messages:[]},{messages:null}])assert.equal(hasQueuedMessages({payload}),false);
 assert.equal(hasQueuedMessages({payload:{messages:[message('a','Please write the copy.')]}}),true);
});

test('known client conversations get the limited calls before unrelated mail, newest client work first',()=>{
 const rows=[{id:'newsletter',client:false,payload:{messages:[{date:'2026-10-11T10:00Z'}]}},{id:'older-client',client:true,payload:{messages:[{date:'2026-10-10T10:00Z'}]}},{id:'newer-client',client:true,payload:{messages:[{date:'2026-10-11T09:00Z'}]}}];
 assert.deepEqual(prioritizeConversations(rows,r=>r.client).map(r=>r.id),['newer-client','older-client','newsletter']);
});

test('known client schema cannot return a duplicate client and only permits supplied contacts',()=>{
 const snapshot=conversationPacket({payload:{messages:[message('a','Please help capture event content.')] }},{allow_new_client:false,clients:[],tasks:[],projects:[]});
 const props=conversationSchema(snapshot).properties.suggestions.items.properties;
 assert.deepEqual(props.kind.enum,['project','task','update','complete']);
 assert.deepEqual(props.contact_email.enum,['client@example.test','sierra@sunrosecreative.com']);
 assert.deepEqual(props.source_message_id.enum,['email_1']);
 assert.match(conversationInstructions(snapshot),/Return ONLY kind=project, task, update or complete/);
});

test('an ongoing task can use project context from an earlier message in the same conversation',async()=>{
 const client={id:'c1',name:'Example Client'};
 const messages=[{...message('a','The October Launch campaign starts Monday.'),subject:'October Launch'},{...message('b',"Please help capture additional content."),subject:'Re: October Launch'}];
 const proposal:any={kind:'task',title:'Capture additional content',description:'Help capture additional content.',client_id:'c1',client_name:'Example Client',contact_email:'client@example.test',parent_id:null,task_id:null,due_date:null,estimated_hours:null,source_message_id:'b',evidence:messages[1].body,project_id:'p1',project_evidence:messages[0].body,new_project_name:null,work_state:'ongoing',responsibility:'sunrose',relationship_type:'client'};
 const context={projects:[{id:'p1',client_id:'c1',name:'October Launch',stage:'active'}]};
 const relationship={matched:client,candidates:[client],allowNewClient:false};
 const rows=await validateBatchThread([structuredClone(proposal)],messages,context,relationship,[client],[],[]);
 assert.equal(rows.length,1);assert.equal(rows[0].payload.project_id,'p1');
 const missing=await validateBatchThread([{...proposal,project_evidence:'Invented launch campaign'}],messages,context,relationship,[client],[],[]);
 assert.equal(missing[0].payload.project_id,null);
});


test('malformed optional deadlines preserve supported suggestions with a review caution',async()=>{
 const client={id:'c1',name:'Example Client'};
 const source={...message('commitment','I will send the materials for review by EOD.'),subject:'Materials for review'};
 const base:any={kind:'task',title:'Send materials for review',description:source.body,client_id:'c1',client_name:client.name,contact_email:'client@example.test',parent_id:null,task_id:null,due_date:null,estimated_hours:null,source_message_id:source.id,evidence:source.body,project_id:null,new_project_name:null,work_state:'outstanding',responsibility:'sunrose',relationship_type:'client',due_evidence:source.body,uncertainty:'Existing caution.'};
 const validate=(p:any)=>validateBatchThread([p],[source],{projects:[]},{matched:client,candidates:[client],allowNewClient:false},[client],[],[]);
 for(const date of ['EOD','2026-10-12T23:59:00Z','2026-02-30','2026-13-01','',undefined,123]){
  const proposal={...base,due_date:date};const rows=await validate(proposal);
  assert.equal(rows.length,1,String(date));assert.equal(rows[0].payload.due_date,null);assert.equal(rows[0].payload.due_evidence,null);
  assert.match(rows[0].payload.uncertainty,/No due date was set/);assert.match(rows[0].payload.uncertainty,/Existing caution/);
  assert.equal(proposal.due_date,date,'validation does not rewrite source proposal');
 }
 const datedSource={...source,body:'Send the materials by 2026-10-12.'};
 const dated={...base,due_date:'2026-10-12',evidence:datedSource.body,due_evidence:datedSource.body};
 const datedRows=await validateBatchThread([dated],[datedSource],{projects:[]},{matched:client,candidates:[client],allowNewClient:false},[client],[],[]);
 assert.equal(datedRows[0].payload.due_date,'2026-10-12');
 const noDate=await validate({...base,due_date:null});assert.doesNotMatch(noDate[0].payload.uncertainty,/No due date was set/);
 assert.equal((await validate({...base,due_date:'EOD',evidence:'Invented request to deliver a campaign.'})).length,0);
 assert.equal((await validate({...base,kind:'update',work_state:'changed',task_id:'missing',due_date:'EOD'})).length,0);
});

// Synthetic counterpart of a renewed materials request; no private mailbox content.
test('a renewed delivery commitment survives old completion history and a scheduling reply',async()=>{
 const client={id:'c1',name:'Example Foundation'};
 const messages=cleanMessages([
  {...message('request','Would Wednesday at 9:30 work? Please share the current materials for our review.'),date:'2026-10-12T17:10:00Z'},
  {...message('reply','9:30 works. Please send the invite. I will send the current materials by EOD!'),date:'2026-10-12T17:15:00Z',from:'sierra@sunrosecreative.com',to:'client@example.test'}
 ]);
 const context={allow_new_client:false,clients:[client],projects:[],tasks:[],review_history:[{decision:'dismissed',reason:'already_done',title:'Share materials',reviewed_at:'2026-10-11T19:58:00Z'}]};
 const snapshot=conversationPacket({payload:{messages}},context);
 const packet=JSON.parse(snapshot.input);
 assert.equal(packet.messages.length,2);
 assert.match(packet.messages[1].body,/I will send the current materials by EOD!/);
 assert.equal(packet.context.review_history[0].reviewed_at,'2026-10-11T19:58:00Z');
 assert.match(conversationInstructions(snapshot),/newer explicit request, renewed request, or promise/);
 const proposal:any={kind:'task',title:'Send current materials for review',description:'Send current materials to the reviewer.',client_id:'c1',client_name:client.name,contact_email:'client@example.test',parent_id:null,task_id:null,due_date:null,estimated_hours:null,source_message_id:'reply',evidence:'I will send the current materials by EOD!',project_id:null,new_project_name:null,work_state:'outstanding',responsibility:'sunrose',relationship_type:'client'};
 const relationship={matched:client,candidates:[client],allowNewClient:false};
 assert.equal((await validateBatchThread([proposal],messages,context,relationship,[client],[],[])).length,1);
 assert.equal((await validateBatchThread([{...proposal,kind:'complete',work_state:'completed',task_id:'not-a-real-task'}],messages,context,relationship,[client],[],[])).length,0);
});
