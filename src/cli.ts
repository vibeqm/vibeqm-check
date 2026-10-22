#!/usr/bin/env node
// vibeqm-check [path] [--json] [--all] [--offline] [--proof <file>] [--out <file>]:
// run the VibeQM fact checks on a repository. vibeqm-check init [path] [--yes]: create the
// Level 2 template files.
import { existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { level2 } from "./checks/level2.js";
import { level3 } from "./checks/level3.js";
import { basics2, basics3 } from "./checks/basics.js";
import { fixFor } from "./fixes.js";
import { NEXT_STEPS, planInit, writeInit } from "./init.js";
import { offline } from "./host.js";
import { applyProofs, findProofFiles, mergeProofs } from "./proof.js";
import { aiPrompt, levelReached, markdown } from "./report.js";
import { terminalDetails, terminalSummary } from "./terminal.js";
import { FRAMEWORK_VERSION } from "./types.js";
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);

if (args[0] === "init") {
  const rest = args.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(`vibeqm-check init [path] [--yes]

Create the VibeQM Level 2 template files in a repository: a rules file for AI agents,
agent permissions, a CI workflow with security checks, issue and pull request
templates, and short requirements, decisions and plan files under VibeQM/.

It lists every file first, skips files that already exist, and writes only after you
say yes. It never overwrites a file, never commits, and installs no hooks.

  path    the repository (default: the current directory)
  --yes   create the files without asking (needed when not run in a terminal)
More: https://vibeqm.com`);
    process.exit(0);
  }
  const unknown = rest.filter((a) => a.startsWith("-") && a !== "--yes");
  if (unknown.length) {
    console.error(`vibeqm-check init: unknown option ${unknown[0]}; see vibeqm-check init --help`);
    process.exit(2);
  }
  const target = resolve(rest.find((a) => !a.startsWith("-")) ?? ".");
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    console.error(`vibeqm-check init: ${target} is not a folder`);
    process.exit(2);
  }
  const plan = planInit(target);
  const missing = plan.filter((f) => !f.exists);
  const present = plan.filter((f) => f.exists);
  console.log(`vibeqm-check init: the VibeQM Level 2 templates for ${target}\n`);
  if (present.length) console.log(`Already there, left as they are:\n${present.map((f) => `  ${f.to}`).join("\n")}\n`);
  if (!missing.length) {
    console.log("Nothing to create.");
    process.exit(0);
  }
  console.log(`Will create:\n${missing.map((f) => `  ${f.to}`).join("\n")}\n`);
  if (!rest.includes("--yes")) {
    if (!process.stdin.isTTY) {
      console.error("vibeqm-check init: not run in a terminal, so nothing was written. Pass --yes to create the files.");
      process.exit(2);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Create these ${missing.length} files? [y/N] `).catch(() => "");
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log("Nothing was written.");
      process.exit(0);
    }
  }
  const written = writeInit(target, plan);
  console.log(`\nCreated ${written.length} file${written.length === 1 ? "" : "s"}. Nothing was committed.\n\n${NEXT_STEPS}`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`vibeqm-check [path] [--json] [--all] [--offline] [--proof <file>] [--out <file>]
vibeqm-check init [path] [--yes]

Assess a git repository against the Vibe Quality Model (VibeQM) and print a report:
the level the evidence supports, every Level 2 and Level 3 check as Met, Not met
or Not visible, and for each open check why it matters, the steps to close it, how
to confirm it, and a prompt your AI coding agent can follow.

  path            the repository to assess (default: the current directory)
  --json          print the results as JSON instead of the report
  --all           print the whole report at once, without pausing
  --proof <file>  read proof from this file instead of the nearest vqm-proof.json
  --offline       read only the local repository; never ask the code host
  --out <file>    write the report to this file (Markdown, or JSON when the name
                  ends in .json); the only file the tool ever writes, and never
                  over an existing one
  -h, --help      show this help

  init            create the Level 2 template files, after you confirm; see
                  vibeqm-check init --help

Read-only and private. The tool reads the repository and its git history on this
machine, writes nothing except a report file you ask for with --out (or the
template files init creates after you confirm), and sends
nothing to us: no account, no telemetry. If the GitHub CLI (gh) is logged in, it
asks GitHub, with your own login, for this repository's CI runs and merged pull
requests, read-only; --offline turns that off.
More: https://vibeqm.com`);
  process.exit(0);
}
const json = args.includes("--json");
if (args.includes("--offline")) offline();
const pi = args.indexOf("--proof");
const proofArg = pi >= 0 ? args[pi + 1] : undefined;
const oi = args.indexOf("--out");
const outArg = oi >= 0 ? args[oi + 1] : undefined;
// "--out --json" must not write a file named --json, and a bare --out must not pass silently.
if (oi >= 0 && (!outArg || outArg.startsWith("-"))) {
  console.error("vibeqm-check: --out needs a file name, for example --out report.md");
  process.exit(2);
}
const root = resolve(args.find((a, i) => !a.startsWith("--") && (pi < 0 || i !== pi + 1) && (oi < 0 || i !== oi + 1)) ?? ".");

let results = [...level2, ...basics2, ...level3, ...basics3].map((check) => check(root));
const proofFiles = proofArg ? [resolve(proofArg)] : findProofFiles(root);
const proofFile = proofFiles.length ? proofFiles.join(", ") : null;
if (proofFiles.length) {
  try {
    const merged = mergeProofs(proofFiles);
    const inside = (f: string | undefined) => (f && resolve(f).startsWith(`${root}/`) ? root : null);
    results = applyProofs(results, merged.proofs, proofFile as string, new Date(), (p) => inside(merged.sources.get(p)));
  } catch (e) {
    console.error(`vibeqm-check: ${(e as Error).message}`);
    process.exit(2);
  }
}

const date = new Date().toISOString().slice(0, 10);
const reached = levelReached(results);
const next = reached + 1;
// Open gates carry their fix, so an agent reading JSON gets the same guidance as the report.
const withFixes = results.map((r) => (r.status === "met" ? r : { ...r, fix: fixFor(r) ?? undefined }));
const jsonOut = JSON.stringify(
  {
    repo: root,
    vqm: FRAMEWORK_VERSION, // the version the claim is made against (VQM_SPEC §13)
    date,
    level: reached,
    next,
    open: results.filter((r) => r.status !== "met" && r.level === next).length,
    proof: proofFiles,
    results: withFixes,
  },
  null,
  2,
);

if (outArg) {
  // The one write the tool ever makes, only because the person asked — and never
  // over an existing file, so the read-only promise holds on a second run too.
  const target = resolve(outArg);
  try {
    writeFileSync(target, `${/\.json$/i.test(target) ? jsonOut : markdown(root, results, date, proofFile)}\n`, { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      console.error(`vibeqm-check: ${target} already exists; --out never overwrites. Choose a new name.`);
      process.exit(2);
    }
    throw e;
  }
  console.error(`Report written to ${target}`); // stderr, so piped stdout stays machine-readable
}

if (json) {
  console.log(jsonOut);
} else if (process.stdin.isTTY && process.stdout.isTTY && !args.includes("--all")) {
  // A person at a terminal: the answer and the scorecard first, then the to-do list and
  // the AI prompt on request.
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const style = { width: process.stdout.columns ?? 100, color: !process.env.NO_COLOR };
  console.log(`${terminalSummary(root, results, date, style)}\n`);
  // Ctrl+D or Ctrl+C at a prompt ends the run quietly, not with a stack trace.
  const ask = (q: string) =>
    rl
      .question(q)
      .then((a) => {
        if (a.trim().toLowerCase() === "q") {
          rl.close();
          process.stdout.write("\n");
          process.exit(0);
        }
      })
      .catch(() => {
        rl.close();
        process.stdout.write("\n");
        process.exit(0);
      });
  const prompt = aiPrompt(results);
  // With nothing open at the next level there is no to-do list to wait for.
  if (prompt) await ask("Press Enter to show what to do next (q quits). ");
  console.log(`\n${terminalDetails(results, proofFile, style)}\n`);
  if (prompt) {
    await ask("Press Enter to show a prompt your AI can use to bring this repository to the next level (q quits). ");
    console.log(`\n${prompt}\n`);
  }
  rl.close();
} else {
  // Agents, pipes and CI: everything at once, in the same order.
  console.log(markdown(root, results, date, proofFile));
}
