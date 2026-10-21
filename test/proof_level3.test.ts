import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lessonsRecorded, provenance, rulesShort } from "../src/checks/level3.js";
import { applyProofs, findProofFile, loadProofs } from "../src/proof.js";
import type { CheckResult } from "../src/types.js";

function repo(message = "first"): string {
  const root = mkdtempSync(join(tmpdir(), "vqm-"));
  const g = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  g("init", "-q");
  g("config", "user.name", "Ada Person");
  g("config", "user.email", "ada@example.com");
  g("config", "commit.gpgsign", "false"); // a machine that signs every commit must not fail here
  writeFileSync(join(root, "a.txt"), "one\n");
  g("add", "-A");
  g("commit", "-q", "-m", message);
  return root;
}

const nv: CheckResult = { level: 2, gate: "Checks seen to fail", status: "not-visible", evidence: "x" };
const nm: CheckResult = { level: 2, gate: "Small batches", status: "not-met", evidence: "x" };
const proof = (gate: string, date: string) => ({ gate, evidence: "planted fault caught", by: "Ada Person", date });

test("proof upgrades not-visible to attested met", () => {
  const [r] = applyProofs([nv], [proof("checks seen to fail", "2026-10-05")], "f", new Date("2026-10-06"));
  assert.equal(r!.status, "met");
  assert.equal(r!.attested, true);
  assert.match(r!.evidence, /attested by Ada Person/);
});

test("proof never overrides not-met", () => {
  const [r] = applyProofs([nm], [proof("Small batches", "2026-10-05")], "f", new Date("2026-10-06"));
  assert.equal(r!.status, "not-met");
});

test("proof older than a year expires", () => {
  const [r] = applyProofs([nv], [proof("Checks seen to fail", "2025-01-01")], "f", new Date("2026-10-06"));
  assert.equal(r!.status, "not-visible");
  assert.match(r!.evidence, /expired/);
});

test("proof file is found in a parent folder and validated", () => {
  const parent = mkdtempSync(join(tmpdir(), "ws-"));
  const child = join(parent, "book");
  mkdirSync(child);
  writeFileSync(join(parent, "vqm-proof.json"), JSON.stringify({ proofs: [proof("Gates proven", "2026-10-05")] }));
  const f = findProofFile(child);
  assert.equal(f, join(parent, "vqm-proof.json"));
  assert.equal(loadProofs(f!).length, 1);
  writeFileSync(join(parent, "vqm-proof.json"), JSON.stringify({ proofs: [{ gate: "x" }] }));
  assert.throws(() => loadProofs(f!), /needs "evidence"/);
});

test("provenance: a model trailer with a version counts", () => {
  assert.equal(provenance(repo("work")).status, "not-met");
  assert.equal(provenance(repo("work\n\nModel: claude-opus-5-5")).status, "met");
});

test("rules kept short: a long rules file fails", () => {
  const root = repo();
  writeFileSync(join(root, "CLAUDE.md"), "rule\n".repeat(250));
  assert.equal(rulesShort(root).status, "not-met");
  writeFileSync(join(root, "CLAUDE.md"), "rule\n".repeat(20));
  assert.equal(rulesShort(root).status, "met");
});

test("lessons recorded: dated entries count", () => {
  const root = repo();
  assert.equal(lessonsRecorded(root).status, "not-met");
  writeFileSync(join(root, "LESSONS.md"), "## 2026-10-05 Hook caught a broken tag\n");
  assert.equal(lessonsRecorded(root).status, "met");
});

test("proofs: a repo file adds to a parent file, and the nearest wins per gate", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { findProofFiles, mergeProofs } = await import("../src/proof.js");
  const top = mkdtempSync(join(tmpdir(), "vqm-proofs-"));
  const repoDir = join(top, "book");
  mkdirSync(repoDir);
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(join(top, "vqm-proof.json"), JSON.stringify({ proofs: [
    { gate: "Checks seen to fail", evidence: "parent", by: "A", date: today },
    { gate: "Peer review on every change", evidence: "parent", by: "A", date: today },
  ] }));
  writeFileSync(join(repoDir, "vqm-proof.json"), JSON.stringify({ proofs: [
    { gate: "Peer review on every change", evidence: "repo", by: "B", date: today },
  ] }));
  const files = findProofFiles(repoDir);
  assert.equal(files[0], join(repoDir, "vqm-proof.json"));
  const { proofs } = mergeProofs(files.slice(0, 2));
  assert.equal(proofs.length, 2);
  assert.equal(proofs.find((p) => p.gate === "Peer review on every change")?.evidence, "repo");
  assert.equal(proofs.find((p) => p.gate === "Checks seen to fail")?.evidence, "parent");
});
