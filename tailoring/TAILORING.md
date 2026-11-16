---
id: tailoring
version: 1.0
status: active
date: 2026-11-16
---

# Tailoring record — vibeqm-check

What this repository changes from the Vibe Quality Model's Level 2 practices, and why.

| ID | Date | Standard item | Change | Reason | Approved by |
|:--|:--|:--|:--|:--|:--|
| TLR-001 | 2026-11-16 | Level 2 "Version control + merge path" | Changes are committed straight to `main`; the committed blocking hooks in `.githooks/` (pre-commit and pre-push run `make check`) stand in for pull requests | One maintainer, so a pull request has nobody to go to; the hooks are the gate that can refuse a change, the agent may not skip them (`git commit --no-verify` is denied in `.claude/settings.json`), and every push gets an AI peer review by a model from another company (`reviews/push/`) | Eduardo Sanchez, 2026-11-16 |
