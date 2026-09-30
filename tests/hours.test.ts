import { test } from "node:test";
import assert from "node:assert/strict";
import { monthSnapshot } from "../src/lib/scopeMath";
import type { Client, WorkItem, TimeEntry } from "../src/lib/types";
const client: Client = {
  id: "a",
  name: "A",
  retainerHoursPerMonth: 10,
  shareToken: "a",
  createdAt: "",
};
const task: WorkItem = {
  id: "t",
  clientId: "a",
  yearMonth: "2026-09",
  title: "Task",
  description: "",
  source: "internal",
  status: "in_progress",
  scopeCategory: "in_scope",
  estimatedHours: 5,
  actualHours: 0,
  priority: 1,
  createdAt: "",
  updatedAt: "",
};
const entry: TimeEntry = {
  id: "e",
  workItemId: "t",
  userId: "u",
  startedAt: "2026-09-12T12:00:00Z",
  endedAt: "2026-09-12T14:00:00Z",
  durationMinutes: 120,
  billable: true,
  note: "",
  createdAt: "",
};
test("in-progress task does not count spent hours twice", () => {
  const s = monthSnapshot(client, [task], "2026-09", [entry]);
  assert.equal(s.used, 2);
  assert.equal(s.committed, 3);
  assert.equal(s.remainingAfterCommitted, 5);
});
test("time belongs to the month worked even when task is in another month", () => {
  assert.equal(
    monthSnapshot(client, [{ ...task, yearMonth: "2026-08" }], "2026-09", [
      entry,
    ]).used,
    2,
  );
  assert.equal(monthSnapshot(client, [task], "2026-10", [entry]).used, 0);
});
test("nonbillable work does not consume the retainer", () => {
  assert.equal(
    monthSnapshot(client, [task], "2026-09", [{ ...entry, billable: false }])
      .used,
    0,
  );
});
test("another client’s time is excluded", () => {
  assert.equal(
    monthSnapshot({ ...client, id: "b" }, [task], "2026-09", [entry]).used,
    0,
  );
});
test("legacy manual total is replaced by logged time rather than added to it", () => {
  assert.equal(
    monthSnapshot(client, [{ ...task, actualHours: 4 }], "2026-09", [entry])
      .used,
    2,
  );
  assert.equal(
    monthSnapshot(client, [{ ...task, actualHours: 4 }], "2026-09", []).used,
    4,
  );
});

test("overnight time is split across UTC month boundaries", () => {
  const overnight = {
    ...entry,
    startedAt: "2026-09-30T23:00:00Z",
    endedAt: "2026-10-01T01:00:00Z",
  };
  assert.equal(monthSnapshot(client, [task], "2026-09", [overnight]).used, 1);
  assert.equal(monthSnapshot(client, [task], "2026-10", [overnight]).used, 1);
});
test("voided time cannot resurrect a legacy manual total", () => {
  assert.equal(
    monthSnapshot(client, [{ ...task, actualHours: 4 }], "2026-09", [
      { ...entry, voidedAt: "2026-09-13T00:00:00Z" },
    ]).used,
    0,
  );
});

import { taskSummary, taskRootsForMonth } from '../src/lib/taskTree';
test('parent totals include previous direct time and child time without double counting the retainer',()=>{
  const parent={...task,estimatedHours:99};
  const child={...task,id:'child',parentId:task.id,estimatedHours:5,status:'planned' as const};
  const childEntry={...entry,id:'child-time',workItemId:'child',durationMinutes:60,endedAt:'2026-09-12T13:00:00Z'};
  const items=[parent,child]; const entries=[entry,childEntry];
  assert.equal(taskSummary(parent,items,entries).actual,3);
  assert.equal(taskSummary(parent,items,entries).estimated,5);
  assert.equal(monthSnapshot(client,items,'2026-09',entries).used,3);
  assert.equal(monthSnapshot(client,items,'2026-09',entries).committed,4);
});
test('cross-month children keep their parent discoverable and progress uses all children',()=>{
  const parent={...task,yearMonth:'2026-11'};
  const a={...task,id:'a',parentId:task.id,yearMonth:'2026-10',status:'done' as const};
  const b={...a,id:'b',yearMonth:'2026-11',status:'planned' as const};
  assert.deepEqual(taskRootsForMonth([parent,a,b],client.id,'2026-10').map(w=>w.id),[parent.id]);
  assert.equal(taskSummary(parent,[parent,a,b],[]).done,1);
  assert.equal(taskSummary(parent,[parent,a,b],[]).status,'in_progress');
  assert.equal(taskSummary(parent,[parent,a,{...b,status:'done'}],[]).status,'done');
});
test('client projection retains total progress even when child details are private',()=>{
  assert.equal(taskSummary({...task,totalSubtasks:4,completedSubtasks:3,status:'in_progress'},[],[]).total,4);
});
