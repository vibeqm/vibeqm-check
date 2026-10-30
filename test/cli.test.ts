import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FRAMEWORK_VERSION } from "../src/types.js";

process.env.VQM_OFFLINE = "1"; // the tests never ask a code host

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

// A small repository, as the check tests build theirs: one commit is enough for the CLI to run.
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "vqm-cli-"));
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

const run = (args: string[], cwd: string) => spawnSync(process.execPath, [CLI, "--offline", ...args], { cwd, encoding: "utf8" });

test("--json names the framework version, the date and the level, and carries a fix per open gate", () => {
  const root = repo();
  const r = run(["--json", root], root);
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.repo, resolve(root));
  assert.equal(j.vqm, FRAMEWORK_VERSION, "a claim names the version it is made against");
  assert.equal(j.date, new Date().toISOString().slice(0, 10));
  assert.equal(j.level, 1);
  assert.equal(j.next, 2);
  assert.equal(j.open, j.results.filter((x: { level: number; status: string }) => x.level === 2 && x.status !== "met").length);
  assert.ok(j.open > 0);
  for (const x of j.results) {
    if (x.status !== "met") {
      assert.ok(x.fix, `no fix for ${x.gate}`);
      assert.ok(Array.isArray(x.fix.steps) && x.fix.steps.length, `${x.gate}: steps`);
      assert.equal(typeof x.fix.minutes, "number", `${x.gate}: minutes`);
    }
  }
});

test("--out writes the report (named for the folder), and refuses to touch an existing file", () => {
  const root = repo();
  const first = run(["--out", "report.md", root], root);
  assert.equal(first.status, 0);
  assert.match(first.stderr, /Report written to/);
  const target = join(root, "report.md");
  const written = readFileSync(target, "utf8");
  assert.match(written, new RegExp(`^# VibeQM self-assessment: ${basename(root)}, `));
  assert.match(written, /\*\*Level 2, Guarded, is \d+ items away\.\*\*/);
  assert.match(written, /Today's level: 1, Unguided\. Level 2 earns:/);
  assert.match(written, /_Claim: VibeQM v[\d.]+ self-assessed: Level 1, \d{4}-\d\d-\d\d, vibeqm-check \(fact checks only\); Level 2: \d+ of 13 items open\._/);
  assert.ok(!written.includes(root), "the report names the folder, never the absolute path");
  const second = run(["--out", "report.md", root], root);
  assert.equal(second.status, 2);
  assert.match(second.stderr, /never overwrites/);
  assert.equal(readFileSync(target, "utf8"), written, "the refused run must leave the file untouched");
});

test("--out with a .json name writes the machine-readable results", () => {
  const root = repo();
  const r = run(["--out", "results.json", root], root);
  assert.equal(r.status, 0);
  const j = JSON.parse(readFileSync(join(root, "results.json"), "utf8"));
  assert.equal(j.vqm, FRAMEWORK_VERSION);
  assert.equal(j.level, 1);
  assert.ok(Array.isArray(j.results) && j.results.length > 0);
});

test("--help explains --out and the read-only promise", () => {
  const r = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--out/);
  assert.match(r.stdout, /only file the tool ever writes/);
  assert.match(r.stdout, /Read-only and private/);
});