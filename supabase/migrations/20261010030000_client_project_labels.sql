begin;
create or replace function public.client_task_items(cid uuid, month text default null) returns jsonb
language sql stable security definer set search_path=public as $$
 with selected_roots as (
  select w.id from public.work_items w where w.client_id=cid and w.parent_id is null and w.client_visible and w.archived_at is null
   and (month is null or w.year_month=month or exists(select 1 from public.work_items c where c.parent_id=w.id and c.year_month=month))
 ), summaries as (
  select parent_id,count(*)::int as total,count(*) filter(where status='done')::int as done,
    bool_or(status='in_progress') as running,bool_or(status='planned') as planned
  from public.work_items where client_id=cid and archived_at is null and parent_id is not null group by parent_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'clientId',w.client_id,'yearMonth',w.year_month,
  'projectId',w.project_id,'projectName',(select name from public.projects where id=w.project_id),'title',w.title,'status',case when s.total>0 then case when s.done=s.total then 'done' when s.done>0 or s.running then 'in_progress' when s.planned then 'planned' else 'backlog' end else w.status end,
  'dueDate',w.due_date,'parentId',w.parent_id,'totalSubtasks',coalesce(s.total,0),'completedSubtasks',coalesce(s.done,0)) order by w.priority,w.title),'[]'::jsonb)
 from public.work_items w left join summaries s on s.parent_id=w.id
 where w.client_id=cid and w.client_visible and w.archived_at is null and (w.id in (select id from selected_roots) or w.parent_id in (select id from selected_roots));
$$;

commit;
