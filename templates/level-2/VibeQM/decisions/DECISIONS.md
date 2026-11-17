# Decisions

One row per decision that shapes the project. IDs are never reused. Replace the
example row.

| ID | Date | Decision | Who decided |
|:--|:--|:--|:--|
| DEC-001 | <YYYY-MM-DD> | <What was decided, and why in a few words> | <name> |

## Comparing options (optional at Level 2, required at Level 3 for high-risk choices)

When a choice is about how to build something risky (login, payments, personal
data, deleting data, security settings, deployment, a new dependency), the agent
drafts a weighted matrix: criteria, a weight for each (1 to 5), a score for each
option (1 to 5), and the totals. Adjust the weights and scores, then decide. If you
pick an option without the highest total, say why in the decision row.

| Criterion | Weight | <Option A> | <Option B> | <Option C> |
|:--|:--|:--|:--|:--|
| <criterion> | <1–5> | <score> → <score × weight> | <score> → <score × weight> | <score> → <score × weight> |
| **Total** | | <sum> | <sum> | <sum> |
