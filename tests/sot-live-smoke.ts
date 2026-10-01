// Opt-in: one small API request using fabricated email only. Never part of npm test.
import { readFile } from 'node:fs/promises';
import { instructions, proposalSchema, validProposal } from '../supabase/functions/sot/core.ts';
const text=await readFile(new URL('../.env.local',import.meta.url),'utf8');
const key=text.match(/^OPENAI_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'');
if(!key)throw new Error('SOT API key unavailable');
const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',store:false,instructions,input:JSON.stringify({context:{clients:[],tasks:[]},messages:[{source_message_id:'fixture-1',date:'2026-10-01T12:00:00Z',from:'Alex <alex@acme.test>',to:'sierra@sunrosecreative.com',cc:'',subject:'Acme marketing retainer — November copy',body:'As your existing marketing client Acme Studio, please draft our November email campaign by November 10, 2026. Our budget allows two work hours for the draft. Thanks, Alex'}]}),max_output_tokens:2400,text:{format:{type:'json_schema',name:'sot_suggestions',strict:true,schema:proposalSchema}}})});
const data=await response.json();
if(!response.ok){console.log({ok:false,status:response.status,code:data.error?.code});process.exitCode=1;}
else{
 const output=data.output.flatMap((o:any)=>o.content||[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');
 const proposals=JSON.parse(output).suggestions;
 const valid=proposals.every((p:any)=>validProposal(p,['fixture-1'],['alex@acme.test']));
 console.log({ok:data.status==='completed',suggestions:proposals.length,allValid:valid,clientSuggested:proposals.some((p:any)=>p.kind==='client'),taskSuggested:proposals.some((p:any)=>p.kind==='task')});
 if(!valid){console.log('Synthetic fixture output:',proposals);process.exitCode=1;}
}
