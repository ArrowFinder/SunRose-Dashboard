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
