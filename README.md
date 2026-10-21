# vqm-check

A free self-assessment for the **Vibe Quality Model (VibeQM)**: run it on a git
repository and it tells you the level the evidence supports, what is missing for
the next one, and how to close each gap.

The Vibe Quality Model takes AI-assisted development from ad-hoc to professional:
requirements, tests that can fail, real reviews, security scans and records, done
largely by the AI agent itself, at a quality that employers and customers can trust.
Five levels, each defined by evidence anyone can open. More at
[vibeqm.com](https://vibeqm.com).

## Run it

```bash
npx vqm-check            # in the repository to assess
npx vqm-check path/to/repo
npx vqm-check --json     # machine-readable results
npx vqm-check --out report.md   # write the report to a file (or report.json)
npx vqm-check --offline  # never ask the code host
npx vqm-check init       # create the Level 2 template files, after you confirm
npx vqm-check --help
```

Requires Node.js 20 or later and git.

## Read-only and private

- **It changes nothing on its own.** The tool reads the repository and its git
  history; it writes no files, commits, settings or hooks. There are two
  exceptions, both only when you ask: a report you request with `--out`, written
  where you say, and the template files `vqm-check init` creates after you
  confirm the list. Neither ever overwrites an existing file, and neither commits.
- **It sends nothing to us.** There is no account, no telemetry and no server of ours
  involved: the checks run on your machine, and the report is printed there.
- **The one outside call is optional and yours.** If the GitHub CLI (`gh`) is logged
  in, the tool asks GitHub, with your own login, for this repository's CI runs and
  merged pull requests, read-only, to see checks that failed and reviews that
  happened. `--offline` turns that off.
- The AI prompt it prints goes nowhere by itself; you decide whether to give it to
  your coding agent.

Inside an AI coding agent, run it as a shell command (in Claude Code:
`! npx vqm-check`). The report is written so the agent can act on it.

## Start from the templates

`npx vqm-check init` creates the files a repository needs for Level 2: a rules file
for AI agents (`AGENTS.md`), agent permissions, a CI workflow with secret scanning
and static security analysis, issue and pull request templates, and short
requirements, decisions and plan files under `VibeQM/`. It shows the list first,
skips files that already exist, and writes only after you say yes (`--yes` when not
run in a terminal). Fill every `<...>` with your repository's facts: the checks don't
count a file that still has them. The templates come from the
[companion repository](https://github.com/vibeqm/vqm).

## What you get

- **The level** your repository's evidence supports, Level 1 to 3. Levels 4 and 5
  need measurements over time, which this version does not yet compute.
- **Every check, with one of three results:**
  - **Met:** the evidence exists, and the report names it (a file, a setting, a hook,
    a commit).
  - **Not met:** the tool looked and the evidence is absent.
  - **Not visible:** the evidence lives outside the repository (for example settings
    on your code host). It counts as not met until a person attaches proof.
- **For every open check:** why it matters, concrete steps for this repository, how to
  confirm it worked, and an estimate in minutes.
- **A prompt** at the end that your AI coding agent can follow to close the gaps,
  cheapest first. The prompt tells the agent to produce real evidence, and to ask you
  before writing any proof on your behalf.

## What counts as a peer review

Review once per push or pull request, not per commit: one review covers every commit
since the last reviewed one, and nothing should reach staging or production
unreviewed. Commits not pushed yet are not counted until they are pushed. A commit
counts as reviewed when any of these holds:

- it carries a `Reviewed-by:` trailer naming a person (`Name <email>`) or a model from
  a company that did not write the change, and a review record exists: a review file
  added in the same commit, or a review file (under a `reviews/` folder) that names it;
- a pull request holding it was approved, or had changes requested, by someone other
  than its author (read from GitHub);
- a push-review record with a passing verdict, written by a hook for the range of
  commits being pushed, by a model from another company, covers it.

The reviewer doesn't have to cost money: a person counts, and so does an open-weight
model from another company run locally (for example with Ollama), or a free API tier such as Google's Gemini API (read its data terms: free-tier content may be used to improve Google's products).
A chat subscription alone gives no API a hook can call.

Review is measured from the first reviewed change: earlier history is never claimed as
reviewed. After 20 changes, all of them reviewed, the check reads **Met**. Any change
since then without a review reads **Not met**.

## Proof for what the tool can't see

Some evidence cannot be read from a repository: branch protection on your code host,
a planted-fault drill that predates the history, a note on how production is kept
apart. Record it in a `vqm-proof.json` file, in the repository or any parent folder
(files in parent folders are merged; for the same check, the nearest wins):

```json
{
  "proofs": [
    {
      "gate": "Checks seen to fail",
      "evidence": "Planted fault: broke a unit test, the pre-commit hook refused the commit",
      "by": "A. Person",
      "date": "2026-10-10",
      "ref": "docs/drills.md"
    }
  ]
}
```

A proof only turns **Not visible** into **Met (attested)**. It never overrides **Not
met**, because what the tool saw outranks what anyone says. Proof is signed by a
named person and expires after a year.

## In a GitHub workflow

Run the checks on every pull request, so a level that slips is noticed on the change
that caused it. The report appears on the run's summary page.

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }      # the checks sample history
- uses: vibeqm/vqm-check@v0.4.0
  with: { min-level: 2 }        # optional: fail the run below this level
```

To let the action read the repository's CI runs and pull requests, give the job
read access (`permissions: { contents: read, actions: read, pull-requests: read }`).
Pass `offline: true` to read the repository only.

## What it is, and what it is not

`vqm-check` is the scripted half of the VibeQM assessment procedure: the facts a command
can establish. A formal VibeQM assessment adds judgment by two AI models from different
companies, the lower result standing if they disagree, and a person's countersignature.
A result is stated as **"VibeQM self-assessed: Level N"**, with the date and the assessor.
No official body stands behind the levels, and a VibeQM level is not equivalent to a
level in any other model.

The Vibe Quality Model is an independent framework.

## Develop

```bash
npm install
npm test        # builds, then runs the tests: each check is tested against small
                # repositories built to pass or fail it
node dist/src/cli.js [path]
```

## License

MIT. See [LICENSE](LICENSE).
