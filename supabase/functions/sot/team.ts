// Account provisioning is independent of Gmail/AI. Never send invitation emails.
export async function createTeammate(db:any, actor:string, input:any, redirectTo:string) {
 const {data:r,error:prepareError}=await db.rpc('prepare_team_setup',{actor,request_id:input.requestId,member_email:input.email,member_name:input.name,member_role:input.role});
 if(prepareError)throw new Error(prepareError.message);
 if(r.user_id){
  const {data,error}=await db.auth.admin.getUserById(r.user_id);
  if(error)throw new Error('Could not verify this account. Retry shortly.');
  if(data.user.email_confirmed_at||data.user.last_sign_in_at)throw new Error('This teammate has already activated their account. Use Team to manage access.');
  const profile=await db.from('profiles').select('active').eq('id',r.user_id).single();
  if(profile.error||!profile.data?.active)throw new Error('This account is inactive. Manage access on Team.');
 }
 const {data,error}=await db.auth.admin.generateLink({type:'invite',email:r.email,options:{redirectTo,data:{display_name:r.display_name,team_setup_id:r.id}}});
 if(error||!data?.user?.id||!data.properties?.action_link)throw new Error('Could not prepare the setup link. Retry with the same email; no invitation email was sent.');
 if(data.user.user_metadata?.team_setup_id!==r.id || (r.user_id&&r.user_id!==data.user.id))throw new Error('This email belongs to another account. Manage it on Team.');
 const saved=await db.rpc('finish_team_setup',{actor,request_id:r.id,account_id:data.user.id});
 if(saved.error)throw new Error('Account setup is incomplete. Retry with the same email to finish safely.');
 return {id:data.user.id,name:r.display_name,role:r.role,email:r.email,setupLink:data.properties.action_link};
}
