# Changes

The agent writes a row here before it starts each task: its estimate of the time and
AI cost, then the actual when it is done. For a high-risk change (login and
permissions, payments, personal data, deleting data, security settings, deployment,
a new dependency) it also fills what the change touches, what could break, the test
and the rollback; for other tasks those columns can say "—". At Level 2 this is a
head start; at Level 3 both are required. Replace the example row.

| Change | Requirement | What it touches | What could break | Tested by | Rollback | Estimate (time, AI cost) | Actual |
|:--|:--|:--|:--|:--|:--|:--|:--|
| CHG-001 | <REQ-001> | <files, services, data> | <the worst realistic failure> | <the test or check> | <how to undo it> | <2 h, $1> | <filled in when done> |
