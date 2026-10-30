import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PRIVACY, showPath } from "../src/report.js";
import { terminalDetails, terminalSummary } from "../src/terminal.js";
import { FRAMEWORK_VERSION, type CheckResult } from "../src/types.js";

process.env.VQM_OFFLINE = "1"; // the tests never ask a code host

const wide = { width: 100, color: false };

test("the lead says how far the next level is, who does what, and what it earns; the claim carries the profile at every level", () => {
  const results: CheckResult[] = [
    { level: 2, gate: "Agent rules file", status: "met", evidence: "AGENTS.md" },
    { level: 3, gate: "Models pinned", status: "not-met", evidence: "No models named." },
    { level: 3, gate: "Lessons recorded", status: "not-visible", evidence: "attach proof" },
    { level: 3, gate: "Data boundary", status: "met", evidence: "VibeQM/DATA_BOUNDARY.md" },
  ];
  const out = terminalSummary("/home/someone/shop", results, "2026-10-27", wide);
  assert.equal(out.split("\n")[3], "Nearly there: Level 3, Standardized, is 2 items away.");
  assert.match(out, /Already met, 1 of 3: Data boundary\./);
  assert.match(out, /Your AI agent can do all of them now \(about 25 minutes\)\./);
  assert.match(out.replace(/\n/g, " "), /Today's level: 2, Guarded\. Level 3 earns: the AI takes a task from an issue to a finished pull request/);
  assert.match(out, /Claim: VibeQM v[\d.]+ self-assessed: Level 2, 2026-10-27, vibeqm-check \(fact checks only\); Level 3: 2 of 3 items open\./);
  // The coverage note lives in the footer now, not on screen one.
  assert.ok(!out.includes("Levels 4 and 5 are not checked"));
  // Level 1 gets the same lead: the profile is for everyone, not only once Level 2 is met.
  const low = terminalSummary("/home/someone/shop", [{ level: 2, gate: "Agent rules file", status: "not-met", evidence: "none" }], "2026-10-27", wide);
  assert.equal(low.split("\n")[3], "Nearly there: Level 2, Guarded, is 1 item away.");
  assert.match(low, /Claim: .*Level 1, 2026-10-27, .*; Level 2: 1 of 1 items open\./);
});

test("a gate in place counts with use: the lead gives the countdown, the scorecard its own mark", () => {
  const results: CheckResult[] = [
    { level: 2, gate: "Agent rules file", status: "met", evidence: "AGENTS.md" },
    { level: 2, gate: "Peer review on every change", status: "in-place", evidence: "since review began (abc1234, 2026-10-20), 3 of 3 pushed changes were covered by a review; counts after 20 reviewed changes since adoption, 3 so far", progress: { done: 3, needed: 20, unit: "reviewed changes" } },
  ];
  const out = terminalSummary("/shop", results, "2026-10-30", wide);
  assert.match(out.replace(/\n/g, " "), /Level 2 is in place: 1 of 2 met, and peer review on every change counts after 20 reviewed changes \(3 so far\)\./);
  assert.match(out, /Claim: .*Level 2: 1 of 2 items open, peer review on every change in place, 3 of 20 reviewed changes\./);
  assert.match(out, /◐ Peer review on every change/);
  assert.match(out, /◐ in place: set up, counts with use/);
  const two = terminalDetails(results, null, wide);
  assert.match(two, /in place · ~30 min · counts with use/);
  // With one more gate open, the countdown follows the split.
  const mixed = terminalSummary("/shop", [...results, { level: 2, gate: "Small batches", status: "not-met", evidence: "median 900" }], "2026-10-30", wide);
  assert.match(mixed.replace(/\n/g, " "), /Level 2, Guarded, is 1 item away, plus 1 gate that counts with use\./);
  assert.match(mixed.replace(/\n/g, " "), /1 counts with use \(small batches\)\. Then peer review on every change counts after 20/);
});

test("when every fact check of the next level is met, the screen says what puts the level on the scorecard", () => {
  const results: CheckResult[] = [
    { level: 2, gate: "Agent rules file", status: "met", evidence: "AGENTS.md" },
    { level: 3, gate: "Models pinned", status: "met", evidence: "settings" },
    { level: 3, gate: "Lessons recorded", status: "met", evidence: "LESSONS.md" },
  ];
  // Level 3 reached and nothing above it checked: the tool says so.
  const out = terminalSummary("/shop", results, "2026-10-30", wide);
  assert.match(out, /You are on Level 3, Standardized\./);
  // Level 2 met in full with Level 3 gates open: the lead is the distance to Level 3, not a verdict.
  const l2 = terminalSummary("/shop", [results[0], { level: 3, gate: "Models pinned", status: "not-met", evidence: "none" }], "2026-10-30", wide);
  assert.match(l2, /Level 3, Standardized, is 1 item away\./);
});

test("screen one leads with the answer: level, gap, minutes", () => {
  const results: CheckResult[] = [
    { level: 2, gate: "Agent rules file", status: "not-met", evidence: "No rules file found." },
    { level: 2, gate: "Owner per change", status: "not-met", evidence: "No commits by a person." },
    { level: 3, gate: "Models pinned", status: "not-met", evidence: "No models named." },
  ];
  const out = terminalSummary("/home/someone/shop", results, "2026-10-13", wide);
  const lines = out.split("\n");
  assert.equal(lines[0], "VibeQM self-assessment: shop, 2026-10-13");
  assert.match(lines[1], /Read-only and private/);
  assert.equal(lines[3], "Nearly there: Level 2, Guarded, is 2 items away.");
  // 10 + 5 minutes for the two open gates, both the agent's.
  assert.match(out, /Your AI agent can do all of them now \(about 15 minutes\)\./);
  assert.match(out, /Start: in Claude Code, Codex or another agent, say "run vibeqm-check and do what it says/);
  // No rules file at all: init is the first step, said before the call to action.
  const bare = terminalSummary("/shop", [{ level: 2, gate: "Agent rules file", status: "not-met", evidence: "none of AGENTS.md, CLAUDE.md found" }], "2026-10-13", wide);
  assert.match(bare.replace(/\n/g, " "), /First: npx vibeqm-check init creates the starter files \(it shows the list and asks\)\. Start:/);
  assert.ok(!out.includes("vibeqm-check init"), "a repository with a rules file is not told to run init");
  assert.match(out, /Level 2 · Guarded\s+□□\s+0 of 2 met/);
  // Levels beyond the next one show only their bar.
  assert.match(out, /Level 3 · Standardized/);
  assert.match(out, /Listed in full once Level 2 is reached\./);
});

test("the scorecard marks attested gates and shows one sentence of evidence, home paths shortened", () => {
  const results: CheckResult[] = [
    {
      level: 2,
      gate: "Checks seen to fail",
      status: "met",
      attested: true,
      evidence: `${join(homedir(), "docs", "drills.md")} records the planted fault. The hook refused the commit.`,
    },
  ];
  const out = terminalSummary("/home/someone/shop", results, "2026-10-13", wide);
  assert.match(out, /attested · ~\/docs\/drills\.md records the planted fault\./);
  assert.ok(!out.includes("The hook refused"), "only the first sentence belongs on screen one");
  assert.ok(!out.includes(homedir()), "a home path reads as ~, never the account name");
});

test("long evidence is clipped at a word boundary", () => {
  const words = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november".split(" ");
  const results: CheckResult[] = [{ level: 2, gate: "Agent rules file", status: "not-met", evidence: `${words.join(" ")}. Second sentence.` }];
  const out = terminalSummary("/shop", results, "2026-10-13", { width: 60, color: false });
  const line = out.split("\n").find((l) => l.includes("…"));
  assert.ok(line, "expected a clipped evidence line");
  assert.ok(line.endsWith("…"), `clipped line should end with …: ${line}`);
  const shown = line.trim().slice(0, -1);
  assert.ok(shown.split(" ").every((w) => words.includes(w)), `cut mid-word: ${shown}`);
});

test("when the tool checks nothing above the level reached, the screen says so", () => {
  const results: CheckResult[] = [
    { level: 2, gate: "Agent rules file", status: "met", evidence: "AGENTS.md found." },
    { level: 3, gate: "Models pinned", status: "met", evidence: "Named in AGENTS.md." },
  ];
  const out = terminalSummary("/shop", results, "2026-10-13", wide);
  assert.match(out, /You are on Level 3, Standardized\./);
  assert.match(out, /This version of the tool checks up to Level 3; Levels above need measurements over time\./);
});

test("screen two is the to-do list, cheapest first, with the full privacy note as its footer", () => {
  const results: CheckResult[] = [
    { level: 2, gate: "Requirements first", status: "not-met", evidence: "No requirements found." },
    { level: 2, gate: "Agent rules file", status: "not-met", evidence: "No rules file found." },
  ];
  const out = terminalDetails(results, null, wide);
  assert.match(out, /TO REACH LEVEL 2: 2 items, about 25 minutes/);
  assert.ok(out.indexOf("Agent rules file") < out.indexOf("Requirements first"), "10 minutes before 15");
  assert.match(out, /Found: No rules file found\./);
  assert.match(out, /Why:/);
  assert.match(out, /Do:/);
  assert.match(out, /Check:/);
  assert.match(out, new RegExp(`Fact checks against VibeQM v${FRAMEWORK_VERSION}\\.`));
  assert.match(out, /No proof file\./);
  // The footer wraps the note to the width, so unwrap before matching it whole.
  assert.ok(out.replace(/\n/g, " ").includes(PRIVACY), "the footer carries the full privacy note");
});

test("screen two names the proof file when one was read", () => {
  const results: CheckResult[] = [{ level: 2, gate: "Agent rules file", status: "not-met", evidence: "No rules file found." }];
  const out = terminalDetails(results, "vqm-proof.json", wide);
  assert.match(out, /Proof: vqm-proof\.json\./);
});

test("showPath shortens home paths but not siblings or unrelated paths", () => {
  const home = homedir();
  assert.equal(showPath(home), "~");
  assert.equal(showPath(join(home, "docs", "drill.md")), "~/docs/drill.md");
  assert.equal(showPath(`${home}2/file`), `${home}2/file`);
  assert.equal(showPath("/opt/elsewhere/report.md"), "/opt/elsewhere/report.md");
});