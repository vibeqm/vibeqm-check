# Rules for agents working in this repository

<!-- VibeQM Level 2 rules file. Replace every <...> with this project's facts and delete
what doesn't apply. Keep it under 100 lines. Claude Code, Codex, Cursor and GitHub
Copilot all read AGENTS.md. -->

## What this is
<Two or three lines: what the system does, who uses it, what matters most.>

## Build and check
- Build: <command>
- Tests, linter, static analysis: <command>
- Security checks: <command>
- A task is done only when <command> passes.

## Where things are
- Code: <folder>. Tests: <folder>.
- Requirements, decisions and the plan: VibeQM/ (start at VibeQM/README.md).

## Environments
- Development: <where it runs: this machine, a dev address or a dev project>.
- Production: <the live address or project, or "nothing is live yet">.
- Never deploy or publish to production without my confirmation. Ask, then wait for my yes.

## How changes are made
- Start from a written requirement or issue with acceptance criteria. If there is
  none, draft one in VibeQM/requirements/ and ask me to confirm it.
- Work on a branch. Changes reach <main> only through <a pull request, or the
  solo-work exception in VibeQM/tailoring/>.
- Keep each change small: well under 400 changed lines. A high-risk change that is
  bigger gets split.
- Every push or pull request is reviewed before it lands: <by a person, or by an AI
  model from a different company than the one that wrote the change>.
- I own every change: commits carry my name as the author.

## Never without a person
- High-risk areas: <login and permissions, payments, personal data, deleting data,
  security settings, deployment, new dependencies, these rules and the agent's
  permissions>.
- Never weaken, skip or delete a test; propose it instead.
- Never force-push, skip the checks (`--no-verify`), or delete files outside this
  repository.
- Never read or print a secret: `.env` files, keys, tokens.

## Questions
When a requirement is unclear and the choice matters, ask me with two to four
options, your recommendation first and why. Record my answer with the requirement.

## Records
Every commit ends with a trailer naming the model and version that wrote it.
Decisions go in VibeQM/decisions/DECISIONS.md.
