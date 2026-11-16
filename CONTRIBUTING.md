# Contributing to vibeqm-check

Thank you for helping. vibeqm-check runs the fact checks of the Vibe Quality Model
(VibeQM). The most useful report is a check that got your repository wrong: run
`npx vibeqm-check` on a repository you know well and open a
[wrong result](https://github.com/vibeqm/vibeqm-check/issues/new?template=wrong-result.yml)
issue when a gate reads met, not met or not visible when it shouldn't.

## Where each kind of change goes

| You want to change | Where |
|:--|:--|
| A check that reads a repository wrong, a crash, the report | This repository: an issue, or a pull request with a test |
| The model itself: a level, a gate, a rule | [vibeqm/vqm](https://github.com/vibeqm/vqm/issues) (model feedback); the checks follow the model |
| The Level 2 templates `init` writes | [vibeqm/vqm](https://github.com/vibeqm/vqm), `templates/level-2/`; they are synced here |

## How a change gets in

`main` is protected for everyone, the maintainer included: nobody pushes to it directly.

1. **Fork** the repository (or, with write access, make a branch named for the change,
   for example `fix-lockfile-detection`).
2. **Build and test**: `npm ci`, then `make check` (Biome lint, then `npm test`: tsc and
   node:test). Enable the committed hooks once per clone, and they run on every commit:
   `git config core.hooksPath .githooks`.
3. **Every check change comes with a test**, and every check needs an entry in
   `src/fixes.ts` (a test enforces it). A check returns `met` only with evidence a
   person can open; what the tool can't see is `not-visible`.
4. **Open a pull request** against `main`, using the template (what, why, how tested;
   link the issue).
5. **CI must pass**: `test-and-check` (the tests, then this repository assessed with its
   own action) and `security` (gitleaks, Semgrep, npm audit). Every review conversation
   must be resolved.
6. **The maintainer reviews and merges** with a merge commit (squash and rebase are off,
   so each commit keeps its review record); the branch is deleted.

Releases are tagged on `main` after the merge (`v0.4.11` and later) and published to
npm by the maintainer; the GitHub Action is used by tag.

## Ground rules

- The tool is read-only: it changes no file in the repository it assesses (apart from
  what `init` creates after the person confirms, and a report asked for with `--out`)
  and sends nothing to us. Tests never call the host.
- Wording: "assessment" and "self-assessed", never "certified", "certification" or
  "appraisal".

## Security and conduct

Report a vulnerability privately, never in a public issue: see [SECURITY.md](SECURITY.md).
Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## License

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE), like the rest of this repository.
