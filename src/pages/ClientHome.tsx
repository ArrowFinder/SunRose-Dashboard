import { ClientAddAction } from "../components/ClientAddAction";
import { ClientProjects } from "../components/ClientProjects";
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { isInternalUser, isOwnerOrAdmin, userCanAccessClient } from '../lib/permissions';
import { CalendarPage } from './CalendarPage';
import { ClientWorkspace } from './ClientWorkspace';
import { ClientEditor } from './CloudClientsPage';
import { ClientIdentityCard } from '../components/ClientIdentityCard';
export function ClientHome({details=false,projects=false}:{details?:boolean;projects?:boolean}) {
 const {clientId}=useParams();const [params]=useSearchParams();
 const {data,currentUser,cloud}=useAppState();const client=data.clients.find(c=>c.id===clientId);
 if(!isInternalUser(currentUser))return <ClientWorkspace/>;
 if(!client||!userCanAccessClient(currentUser,client.id))return <div className="card"><h1>Client unavailable</h1><Link to="/clients">Back to clients</Link></div>;
 const oldTask=params.get('task');
 if(oldTask)return <Navigate to={`/client/${client.id}/task/${oldTask}`} replace/>;
 return <div className="stack"><Link to="/clients">← Clients</Link><h1>{client.name}</h1><ClientAddAction clientId={client.id}/>
  <nav className="row" aria-label="Client sections"><Link className={`btn ${!details&&!projects?'btn-primary':''}`} to={`/client/${client.id}`}>Calendar</Link><Link className="btn" to={`/client/${client.id}/projects`}>Projects</Link><Link className={`btn ${details?'btn-primary':''}`} to={`/client/${client.id}/details`}>Details</Link><Link className="btn" to={`/client/${client.id}/tasks`}>Manage tasks & time</Link></nav>
  {client.archivedAt&&<p className="card">This client is archived. Use Details to restore it. Task and time history remains available under Manage tasks & time.</p>}
  {projects?<ClientProjects clientId={client.id}/>:details?<>{isOwnerOrAdmin(currentUser)?<ClientEditor key={client.id} client={client}/>:<p className="muted">Only the owner and admins can change billing and client details.</p>}{cloud&&<ClientIdentityCard key={client.id} clientId={client.id}/>}</>:<CalendarPage clientId={client.id}/>}
 </div>;
}
