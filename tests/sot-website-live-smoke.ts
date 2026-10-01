// Opt-in paid website lookup using only a public business query, never private mail.
import {readFile} from 'node:fs/promises';
import {websiteRequest,websiteResult} from '../supabase/functions/sot/identity.ts';
const key=(await readFile(new URL('../.env.local',import.meta.url),'utf8')).match(/^OPENAI_API_KEY\s*=\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'');
if(!key)throw new Error('SOT API key unavailable');
const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(websiteRequest('OpenAI San Francisco artificial intelligence'))});
const data=await response.json();
if(!response.ok){console.log({ok:false,status:response.status,code:data.error?.code});process.exitCode=1;}
else {const result=websiteResult(data);console.log({ok:!!result.url,website:result.url,sourceCount:result.sources.length,searchCalls:data.output.filter((o:any)=>o.type==='web_search_call').length});if(!result.url){console.log({explanation:result.explanation});process.exitCode=1;}}
