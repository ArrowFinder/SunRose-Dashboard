import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTeammate} from '../supabase/functions/sot/team.ts';
function stub({activated=false,deny=false,finishFail=false}={}){
 const calls:any[]=[];const r={id:'request',user_id:'user',email:'new@example.test',display_name:'New person',role:'employee'};
 const db={
  rpc:async(name:string,args:any)=>{calls.push({name,args});return name==='prepare_team_setup'?{data:r,error:deny?{message:'Owner required'}:null}:{error:finishFail?{message:'unavailable'}:null};},
  from:()=>({select:()=>({eq:()=>({single:async()=>({data:{active:true}})})})}),
  auth:{admin:{
   getUserById:async()=>({data:{user:{email_confirmed_at:activated?'date':null}}}),
   generateLink:async(args:any)=>{calls.push({name:'generateLink',args});return {data:{user:{id:'user',user_metadata:{team_setup_id:'request'}},properties:{action_link:'https://auth.example.test/setup'}}};}
  }}
 };
 return {calls,db};
}
test('teammate creation generates a manual invite and finishes access before returning it',async()=>{const {db,calls}=stub();const result=await createTeammate(db,'owner',{requestId:'request',email:'new@example.test',name:'New person',role:'employee'},'https://dashboard.example.test');assert.equal(result.id,'user');assert.equal(calls[1].name,'generateLink');assert.equal(calls[1].args.type,'invite');assert.equal(calls[2].name,'finish_team_setup');});
test('permission denial never generates a link',async()=>{const {db,calls}=stub({deny:true});await assert.rejects(createTeammate(db,'employee',{},''),/Owner/);assert.equal(calls.length,1);});
test('activated accounts cannot get an admin-generated setup link',async()=>{const {db,calls}=stub({activated:true});await assert.rejects(createTeammate(db,'owner',{},''),/already activated/);assert.equal(calls.length,1);});
test('failed role setup does not disclose a login link',async()=>{const {db}=stub({finishFail:true});await assert.rejects(createTeammate(db,'owner',{},''),/incomplete/);});
