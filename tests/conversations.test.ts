import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conversationSections,conversationPacket,restoreSourceIds} from '../supabase/functions/sot/conversations.ts';
const message=(id:string,body:string)=>({id,date:'2026-10-11T10:00:00Z',from:'client@example.test',to:'sierra@sunrosecreative.com',body});
test('ordinary conversations remain complete and source IDs round trip',()=>{
 const messages=[message('gmail-a','Please draft the launch copy.'),message('gmail-b','Cancel the launch copy request.')];
 const result=conversationPacket({payload:{messages}}, {clients:[],tasks:[],projects:[]});
 assert.equal(result.total,1);const input=JSON.parse(result.input);assert.equal(input.messages.length,2);assert.equal(input.messages[1].body,messages[1].body);
 assert.deepEqual(restoreSourceIds([{source_message_id:'email_2'}],result.aliases),[{source_message_id:'gmail-b'}]);
});
test('long thread splits without losing text and carries candidates until final section',()=>{
 const messages=[message('long','work detail '.repeat(9000))];
 const sections=conversationSections(messages);assert.ok(sections.length>1);
 const reconstructed=sections.flat().map(m=>m.body.slice(m.overlap)).join('');assert.equal(reconstructed,messages[0].body);
 const packet=conversationPacket({payload:{messages,analysis:{index:1,candidates:[{source_message_id:'long',title:'Draft copy'}]}}},{clients:[]});
 assert.equal(packet.index,1);assert.equal(JSON.parse(packet.input).previous_candidates[0].source_message_id,'email_1');assert.ok(Buffer.byteLength(packet.input)<=64000);
 const final=conversationPacket({payload:{messages,analysis:{index:sections.length-1,candidates:[]}}},{clients:[]});assert.equal(JSON.parse(final.input).section.final,true);
});
