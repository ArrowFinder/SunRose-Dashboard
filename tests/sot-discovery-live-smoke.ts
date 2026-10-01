// Opt-in paid smoke test. Fabricated email only; never part of npm test.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {passInstructions,proposalSchema} from '../supabase/functions/sot/core.ts';
const env=await readFile(new URL('../.env.local',import.meta.url),'utf8');
const key=env.match(/^OPENAI_API_KEY\s*=\s*["']?([^\r\n"']+)/m)?.[1];
if(!key)throw Error('Missing local API credential');
const client='10000000-0000-4000-8000-000000000001';
const input=JSON.stringify({today:'2026-10-01',context:{mailbox:'owner@sunrosecreative.com',clients:[{id:client,name:'Example Media',domains:['media.example']}],tasks:[],review_history:[],matched_client:client},messages:[{source_message_id:'m1',from:'alex@media.example',to:'owner@sunrosecreative.com',cc:'',date:'2026-10-01',subject:'Sponsor logo',body:'Please add City of Example, our event sponsor, to the event landing page by October 5. Sunrose handles our event marketing. Thanks, Alex at Example Media.'}]});
for(const pass of ['clients','tasks'] as const){
 const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',store:false,instructions:passInstructions(pass),input,max_output_tokens:2400,text:{format:{type:'json_schema',name:'sot_suggestions',strict:true,schema:proposalSchema}}})});
 if(!r.ok)throw Error(`Provider returned ${r.status}`);
 const data=await r.json();assert.equal(data.status,'completed');
 const result=JSON.parse(data.output.flatMap((o:any)=>o.content||[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('')).suggestions;
 if(pass==='clients')assert.equal(result.length,0,'Sponsor must not become a client');
 else {assert.ok(result.length>0);assert.ok(result.every((p:any)=>p.kind==='task'&&p.client_id===client&&p.responsibility==='sunrose'));}
 console.log({pass,passed:true,suggestions:result.length});
}
