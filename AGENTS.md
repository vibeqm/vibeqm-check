# AGENTS.md — vibeqm-check

Notes for AI coding agents (and people) working on this repository.

- vibeqm-check runs the fact checks of the Vibe Quality Model (VibeQM). The checks mirror
  `framework/ASSESSOR.md` §2 in the companion repository
  ([vibeqm/vqm](https://github.com/vibeqm/vqm)); cite it, never invent gates.
- A check returns `met` only with evidence a person can open; what the tool can't see
  is `not-visible`. A proof file (`vqm-proof.json`) upgrades `not-visible` only, never
  `not-met`.
- The tool is read-only: it changes no existing file in the repository it assesses
  (apart from the new files `vibeqm-check init` creates after the person confirms, the
  only file it writes is a report the person asks for, with `--out`) and sends
  nothing to us. Host facts come through the person's own `gh` login, read-only;
  `--offline` turns that off. Tests never call the host (`VQM_OFFLINE`).
- Every check needs an entry in `src/fixes.ts` (a test enforces it): why, steps that
  produce real evidence, how to verify, minutes.
- Wording: "assessment" and "self-assessed"; the short name is "VibeQM".
- Build and test: `make check` (Biome lint, then `npm test`: tsc and node:test).
  Run: `node dist/src/cli.js <repo>`.
- The Level 2 templates in `templates/level-2/` come from the companion repository:
  edit them there, then run `scripts/sync-templates.sh` (it bundles `.gitignore` as
  `gitignore`, since npm drops .gitignore files).
- Workflow (the same as `CONTRIBUTING.md`): `main` is protected for everyone, the
  maintainer included, so never push to it. Work on a branch named for the change, run
  `make check`, push the branch, and open a pull request with `gh pr create` using the
  template. Wait for CI (`test-and-check`, `security`) to pass and every review thread
  to be resolved; merge with a merge commit (`gh pr merge --merge --delete-branch`)
  only after the person confirms in the session. Tag a release on `main` after the
  merge, never before; the author publishes to npm.
  On the maintainer's machine every push is peer reviewed by a model from another company
  and leaves a record in `reviews/push/`: commit that record to the same branch and push
  again (a push that only adds review records is not reviewed again) before opening or
  merging the pull request. Fetch `origin` first, so a new branch is compared with the
  current `main`. The ruleset lives on GitHub; its settings are
  recorded in `.github/rulesets/protect-main.json` (update the file when it changes).
- Keep this file under 200 lines.
