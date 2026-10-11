import {useState} from 'react';
import {useAppState} from '../context/AppStateContext';
import {isInternalUser} from '../lib/permissions';
import {WorkEditor} from './WorkEditor';
export function ClientAddAction({clientId,defaultProjectId}:{clientId:string;defaultProjectId?:string}) {
 const {data,currentUser,supportSnapshot}=useAppState();const [open,setOpen]=useState(false);
 if(!isInternalUser(currentUser)||supportSnapshot||data.clients.find(c=>c.id===clientId)?.archivedAt)return null;
 return <><button className="btn btn-primary" onClick={()=>setOpen(true)}>Add action</button>{open&&<WorkEditor clientId={clientId} projectId={defaultProjectId} onClose={()=>setOpen(false)}/>}</>;
}
