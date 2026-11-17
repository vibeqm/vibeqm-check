# Changes

The agent writes a row here before it starts a high-risk change (login and
permissions, payments, personal data, deleting data, security settings, deployment,
a new dependency), and the actual time and cost when it is done. At Level 2 this is
a head start; at Level 3 every high-risk change needs one. Replace the example row.

| Change | Requirement | What it touches | What could break | Tested by | Rollback | Estimate (time, AI cost) | Actual |
|:--|:--|:--|:--|:--|:--|:--|:--|
| CHG-001 | <REQ-001> | <files, services, data> | <the worst realistic failure> | <the test or check> | <how to undo it> | <2 h, $1> | <filled in when done> |
