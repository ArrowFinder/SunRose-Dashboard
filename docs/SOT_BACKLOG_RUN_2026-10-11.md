# SOT catch-up run — October 11, 2026

The owner authorized processing the 91 remaining queued conversations with a one-time USD 5 ceiling. This operation does not retry the 47 previously discarded conversations or change their skip markers.

## Production controls

- `sot_backlog_run_20261011` records the target conversation IDs, start time, expiration, spending ceiling, and stop time. Row-level security is enabled; public, anonymous, and authenticated clients have no table access.
- `sot_budget` uses the temporary dollar allowance while the run is active and target conversations remain ready. Paid jobs created since the run began count toward spending; jobs without reported cost reserve USD 0.50 each. The existing monthly reservation lock serializes spending decisions. The model remains GPT-4.1-mini with at most 6,000 output tokens. USD 0.50 exceeds the maximum cost of one request at the verified model rates and context limit.
- A temporary `sot-backlog-20261011` scheduler checks every five seconds. It invokes the existing authenticated dispatcher only when no mailbox scan lease is active. It stops itself when the targets are no longer ready, the dollar allowance cannot safely fund another call, or four hours elapse.
- The original normal dispatcher remains in place. Catch-up reservations are excluded from daily/rolling scheduled quotas, but remain counted in monthly usage and cost records. The previously approved Sunday schedule still releases three calls at 3 PM, 6 PM, and 9 PM. Normal daily limits return Monday.
- No suggestions are accepted or dismissed by this operation. Existing source validation and duplicate checks remain active; user review determines which saved proposals become work.

## Verification

The database captured exactly 91 target conversations. The first paid analysis saved a suggestion. Progress is checked against target queue states, paid-job states, usage, and newly saved suggestions. The run completed at 12:26:55 PM Pacific and was closed at 12:27:34 PM. All 91 target conversations (206 messages) were processed in 91 successful paid calls, with no processing failures. Recorded token-based cost was USD 0.2758712. It created 27 suggestions; at final verification 25 were pending, one accepted, and one dismissed.

The background HTTP dispatcher stopped advancing after 83 conversations; the final steps were completed through the dashboard's existing direct scan control, under the same dollar ceiling. The temporary scheduler was disabled and then removed. The original scheduler remains active, the next scan is 3 PM Pacific, and its three-call allowance was verified. Monthly usage is 512/600 including all catch-up calls. No waiting or focused-review conversations remained.

The temporary dollar override has been removed from `sot_budget`. The completed run record remains as accounting history and defines the catch-up reservation interval excluded from daily/rolling quotas. Original email content is not stored in that record.

Model pricing reference: https://developers.openai.com/api/docs/models/gpt-4.1-mini
