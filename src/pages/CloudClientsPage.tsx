import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAppState } from "../context/AppStateContext";
import { isOwnerOrAdmin } from "../lib/permissions";
import { getSupabase } from "../lib/supabaseClient";
import { downloadBackup } from "../lib/storage";
import { hexOrDefault } from "../lib/color";
import type { Client } from "../lib/types";
export function ClientEditor({ client }: { client: Client }) {
  const navigate=useNavigate();
  const [confirmAction,setConfirmAction]=useState<"archive"|"restore"|"delete"|null>(null);
  const [acting,setActing]=useState(false);
  const {
    data,refresh,cloud,
    updateClient,
    deleteClient,
    regenerateShareToken,
    saving,
    currentUser,
  } = useAppState();
  const [name, setName] = useState(client.name);
  const [hours, setHours] = useState(client.retainerHoursPerMonth);
  const [billingType,setBillingType]=useState(client.billingType??'retainer');
  const [limited,setLimited]=useState(client.hourLimitEnabled??client.retainerHoursPerMonth>0);
  const [rate,setRate]=useState(client.hourlyRate?.toString()??'');
  const [fee,setFee]=useState(client.monthlyFee?.toString()??'');
  const [overage,setOverage]=useState(client.overageRate?.toString()??'');
  const [color, setColor] = useState(hexOrDefault(client));
  const [notice, setNotice] = useState("");
  const manage = isOwnerOrAdmin(currentUser);
  const url = `${location.origin}${location.pathname}#/c/${client.shareToken}`;
  async function run(
    action: () => unknown | Promise<unknown>,
    success: string,
  ) {
    setNotice("");
    try {
      await action();
      setNotice(success);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save.");
    }
  }
  return (
    <section className="card">
      <h2>
        <Link to={`/client/${client.id}`}>{client.name}</Link>
      </h2>
      {manage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                updateClient(client.id, {
                  name,
                  retainerHoursPerMonth: hours,
                  color, billingType, hourLimitEnabled:limited,
                  hourlyRate:rate===''?null:Number(rate),monthlyFee:fee===''?null:Number(fee),overageRate:overage===''?null:Number(overage),
                }),
              "Client saved.",
            );
          }}
        >
          <fieldset disabled={saving} style={{ border: 0, padding: 0 }}>
            <div className="row">
              <label>
                Name
                <input
                  className="input"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>Billing type<select className="input" value={billingType} onChange={e=>setBillingType(e.target.value as 'hourly'|'retainer')}><option value="retainer">Retainer</option><option value="hourly">Hourly</option></select></label>
              {billingType==='hourly'?<label>Hourly rate (USD)<input className="input" type="number" min="0" max="999999" step="0.01" value={rate} onChange={e=>setRate(e.target.value)} placeholder="Optional"/></label>:<><label>Monthly fee (USD)<input className="input" type="number" min="0" max="999999" step="0.01" value={fee} onChange={e=>setFee(e.target.value)} placeholder="Optional"/></label><label>Overage rate per hour (USD)<input className="input" type="number" min="0" max="999999" step="0.01" value={overage} onChange={e=>setOverage(e.target.value)} placeholder="Optional"/></label></>}
              <label><input type="checkbox" checked={limited} onChange={e=>setLimited(e.target.checked)}/> Set a monthly hour allowance</label>
              <label>
                {billingType==='hourly'?'Monthly hour budget':'Included hours'}
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.25"
                  required
                  disabled={!limited}
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                />
              </label>
              <label>
                Calendar color
                <input
                  className="input"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </label>
              <button className="btn" type="submit">
                Save changes
              </button>
            </div>
          </fieldset>
        </form>
       )}
      <p className="muted">Billing details are internal. Time tracking is available for both billing types; these settings do not issue invoices.</p>
      {manage && (
        <>
          <p>
            Only tasks marked “Show this task in the client view” appear at this
            link. Anyone with the link can view them and submit requests. Keep
            internal details out of shared task titles.
          </p>
          <button
            className="btn"
            disabled={saving}
            onClick={() =>
              void run(
                () => navigator.clipboard.writeText(url),
                "Client link copied.",
              )
            }
          >
            Copy client link
          </button>{" "}
          <button
            className="btn"
            disabled={saving}
            onClick={() => {
              if (
                confirm(
                  "Replace the client link? The old link will stop working.",
                )
              )
                void run(
                  () => regenerateShareToken(client.id),
                  "Link replaced. Copy the new link.",
                );
            }}
          >
            Replace link
          </button>{" "}
          <button className="btn" disabled={saving||acting} onClick={()=>setConfirmAction(client.archivedAt?'restore':'archive')}>{client.archivedAt?'Restore client':'Archive client'}</button>
          <button className="btn btn-danger" disabled={saving||acting||data.workItems.some(w=>w.clientId===client.id)} onClick={()=>setConfirmAction('delete')}>Delete empty client</button>
          {data.workItems.some(w=>w.clientId===client.id)&&<p className="muted">This client has tasks. Archive the client to hide it while preserving its tasks and time history.</p>}
          {confirmAction&&<div className="action-confirm"><p>{confirmAction==='delete'?`Permanently delete ${client.name}?` : confirmAction==='archive'?`Archive ${client.name}? It will leave the active client list and calendar. Time history is retained and client sharing is disabled.`:'Restore this client to the active list? Tasks remain private until shared again.'}</p><button className="btn btn-primary" disabled={acting} onClick={async()=>{setActing(true);await run(async()=>{
            if(confirmAction==='delete'){await deleteClient(client.id);navigate('/clients');}
            else if(cloud){const r=await getSupabase().rpc('set_client_archived',{client_id:client.id,archived:confirmAction==='archive'});if(r.error)throw new Error(r.error.message);await refresh?.();}
            else await updateClient(client.id,{archivedAt:confirmAction==='archive'?new Date().toISOString():null});
            setConfirmAction(null);
          },'Client updated.');setActing(false);}}>Confirm {confirmAction}</button><button className="btn" disabled={acting} onClick={()=>setConfirmAction(null)}>Cancel</button></div>}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
export function CloudClientsPage() {
  const { data, currentUser, addClient, saving } = useAppState();
  const [showArchived,setShowArchived]=useState(false);
  const [name, setName] = useState("");
  const [hours, setHours] = useState(0);
  const [error, setError] = useState("");
  if (currentUser?.role === "client") return <Navigate to="/" replace />;
  const manage = isOwnerOrAdmin(currentUser);
  return (
    <div className="stack">
      <h1>Clients</h1>
      {manage && <details className="card"><summary>Add a client</summary>
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await addClient(name, hours);
              setName("");
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not add client.",
              );
            }
          }}
        >
          <h2>Add client</h2>
          <fieldset disabled={saving} style={{ border: 0, padding: 0 }}>
            <div className="row">
              <label>
                Client name
                <input
                  className="input"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Monthly retainer hours
                <input
                  className="input"
                  required
                  type="number"
                  min="0"
                  step="0.25"
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                />
              </label>
              <button className="btn btn-primary">Add client</button>
            </div>
          </fieldset>
          {error && <p role="alert">{error}</p>}
        </form>
      </details>}
      <label><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/> Show archived clients</label>
      <div className="client-directory">{data.clients.filter(c=>showArchived||!c.archivedAt).sort((a,b)=>a.name.localeCompare(b.name)).map(c=><Link className="card client-directory-card" key={c.id} to={`/client/${c.id}`} style={{borderLeft:`4px solid ${hexOrDefault(c)}`}}><h2>{c.name}{c.archivedAt?" · Archived":""}</h2><p className="muted">{c.billingType==='hourly'?'Hourly':'Retainer'} · {data.workItems.filter(w=>w.clientId===c.id&&!w.archivedAt&&!w.parentId&&w.status!=='done').length} open main tasks</p><span>Open client calendar →</span></Link>)}</div>
      {manage && (
        <section className="card">
          <h2>Backup</h2>
          <p>
            Download a copy of the currently loaded clients, tasks, team,
            templates, and time entries (including voided entries). This does
            not include private SOT context, login credentials, or the database audit history.
          </p>
          <button className="btn" onClick={() => downloadBackup(data)}>
            Download workspace copy
          </button>
          <p>
            Browser-only backups must be migrated deliberately so they cannot
            overwrite the shared team’s work.
          </p>
        </section>
      )}
    </div>
  );
}
