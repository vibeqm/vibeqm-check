import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PRIVACY, showPath } from "../src/report.js";
import { terminalDetails, terminalSummary } from "../src/terminal.js";
import { FRAMEWORK_VERSION, type CheckResult } from "../src/types.js";

process.env.VQM_OFFLINE = "1"; // the tests never ask a code host

const wide = { width: 100, color: false };

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
  assert.equal(lines[3], "You are on Level 1, Unguided.");
  // 10 + 5 minutes for the two open gates, ordered cheapest first.
  assert.match(out, /0 of the 2 Level 2 items met — 2 more, about 15 minutes, to reach Level 2, Guarded\./);
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