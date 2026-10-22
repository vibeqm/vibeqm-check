import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.VQM_OFFLINE = "1"; // the tests never ask a code host
import { agentRulesFile, checksBeforeMerge, ownerPerChange, smallBatches } from "../src/checks/level2.js";
import { levelReached } from "../src/report.js";

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "vqm-"));
  const g = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  g("init", "-q");
  g("config", "user.name", "Ada Person");
  g("config", "user.email", "ada@example.com");
  g("config", "commit.gpgsign", "false"); // a machine that signs every commit must not fail here
  writeFileSync(join(root, "a.txt"), "one\ntwo\n");
  g("add", "-A");
  g("commit", "-q", "-m", "first");
  return root;
}

/** Write and commit a file: the rules-file check counts only committed files. */
function commit(root: string, f: string, text: string): void {
  writeFileSync(join(root, f), text);
  execFileSync("git", ["-C", root, "add", f], { stdio: "ignore" });
  execFileSync("git", ["-C", root, "commit", "-q", "-m", `add ${f}`], { stdio: "ignore" });
}

test("rules file: a copied template still holding its blanks is not met", () => {
  const root = repo();
  commit(root, "AGENTS.md", "# Rules\n- Build: <command>\n");
  const r = agentRulesFile(root);
  assert.equal(r.status, "not-met");
  assert.match(r.evidence, /AGENTS\.md still holds 1 template blank \(e\.g\. "<command>"\)/);
  commit(root, "CLAUDE.md", "# Rules\n- Build: make\n");
  assert.equal(agentRulesFile(root).status, "met", "one filled rules file is enough; the blank one is named");
  assert.match(agentRulesFile(root).evidence, /CLAUDE\.md \(3 lines\); AGENTS\.md still holds/);
});

test("rules file: missing is not met, present is met", () => {
  const root = repo();
  assert.equal(agentRulesFile(root).status, "not-met");
  writeFileSync(join(root, "AGENTS.md"), "# Rules\n");
  assert.equal(agentRulesFile(root).status, "not-met", "on disk but never added to git");
  execFileSync("git", ["-C", root, "add", "AGENTS.md"], { stdio: "ignore" });
  assert.equal(agentRulesFile(root).status, "not-met", "staged is not committed: clones don't have it");
  commit(root, "AGENTS.md", "# Rules\n");
  assert.equal(agentRulesFile(root).status, "met");
});

test("small batches: a tiny commit passes", () => {
  const r = smallBatches(repo());
  assert.equal(r.status, "met");
  assert.match(r.evidence, /median 2 changed lines/);
});

test("checks before merge: a hook that runs a check counts; `exit 0` does not; CI alone is not visible", () => {
  const root = repo();
  assert.equal(checksBeforeMerge(root).status, "not-met");
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), "on: push\n");
  assert.equal(checksBeforeMerge(root).status, "not-visible");
  const hook = join(root, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\n# TODO: run make check\nexit 0\n");
  chmodSync(hook, 0o755);
  assert.equal(checksBeforeMerge(root).status, "not-visible");
  writeFileSync(hook, '#!/bin/sh\necho "run make check"\nexit 0\n');
  assert.equal(checksBeforeMerge(root).status, "not-visible");
  writeFileSync(hook, "#!/bin/sh\nmake check\n");
  const r = checksBeforeMerge(root);
  assert.equal(r.status, "met");
  assert.match(r.evidence, /runs `make check`: enabled on this machine only/);
});

test("checks before merge: a hook that runs nothing is not met on its own", () => {
  const root = repo();
  const hook = join(root, ".git", "hooks", "pre-commit");
  writeFileSync(hook, "#!/bin/sh\nexit 0\n");
  chmodSync(hook, 0o755);
  assert.equal(checksBeforeMerge(root).status, "not-met");
});

test("owner per change: human authors are met", () => {
  assert.equal(ownerPerChange(repo()).status, "met");
});

test("staged rule: one unmet Level 2 check keeps the level at 1", () => {
  assert.equal(levelReached([{ level: 2, gate: "x", status: "met", evidence: "" }]), 2);
  assert.equal(
    levelReached([
      { level: 2, gate: "x", status: "met", evidence: "" },
      { level: 2, gate: "y", status: "not-visible", evidence: "" },
    ]),
    1,
  );
});
