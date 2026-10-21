# Planted-fault drills

Each blocking check counts only after it has been seen to fail.

| Date | What was planted | What refused it |
|:--|:--|:--|
| 2026-10-10 | `test/level2.test.ts`: the rules-file test inverted to expect "met" for a repository with no rules file | The pre-commit hook ran `make check`; `npm test` failed and the commit was refused. File restored from HEAD. |
