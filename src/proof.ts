// Proof a person attaches for gates the tool can't see (ASSESSOR rule 6).
// A proof only upgrades "not-visible" to "met"; it never overrides "not-met", because
// what the tool saw fail outranks what anyone says. Proofs older than a year expire.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { git } from "./git.js";
import type { CheckResult } from "./types.js";

export interface Proof {
  gate: string;
  evidence: string;
  by: string;
  date: string; // YYYY-MM-DD
  ref?: string;
}

const NAMES = ["vqm-proof.json", join("VibeQM", "quality", "vqm-proof.json")];
const MAX_AGE_DAYS = 365;

/** Every proof file from the repo up to the filesystem root, nearest first: a
 * repository can add its own proofs to a shared file in a parent folder. */
export function findProofFiles(root: string): string[] {
  const found: string[] = [];
  let dir = resolve(root);
  for (;;) {
    for (const name of NAMES) {
      const p = join(dir, name);
      if (existsSync(p)) found.push(p);
    }
    const up = dirname(dir);
    if (up === dir) return found;
    dir = up;
  }
}

/** Proofs from several files; for the same gate, the nearest file wins. */
export function mergeProofs(files: string[]): { proofs: Proof[]; sources: Map<Proof, string> } {
  const proofs: Proof[] = [];
  const sources = new Map<Proof, string>();
  const seen = new Set<string>();
  for (const file of files) {
    for (const p of loadProofs(file)) {
      const key = p.gate.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      proofs.push(p);
      sources.set(p, file);
    }
  }
  return { proofs, sources };
}

/** The nearest proof file: the repo first, then each parent folder (a shared file). */
export function findProofFile(root: string): string | null {
  let dir = resolve(root);
  for (;;) {
    for (const name of NAMES) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function loadProofs(file: string): Proof[] {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const list: unknown = Array.isArray(data) ? data : data?.proofs;
  if (!Array.isArray(list)) throw new Error(`${file}: expected {"proofs": [...]}`);
  for (const p of list) {
    for (const k of ["gate", "evidence", "by", "date"]) {
      if (typeof p?.[k] !== "string" || !p[k].trim()) throw new Error(`${file}: every proof needs "${k}"`);
    }
  }
  return list as Proof[];
}

function ageDays(date: string, today: Date): number {
  return (today.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000;
}

/** Commit hashes a proof names that this repository doesn't have: a typo, or a commit
 * from another repository. Said beside the attestation, so a reader can check. */
export function unknownCommits(p: Proof, root: string): string[] {
  const tokens = `${p.evidence} ${p.ref ?? ""}`.match(/\b(?=[0-9]*[a-f])[0-9a-f]{7,40}\b/g) ?? [];
  return [...new Set(tokens)].filter((t) => git(root, ["cat-file", "-e", `${t}^{commit}`]) === null);
}

/** `checkHashes`: the repository to look commits up in, for proofs from a file inside it
 * (a shared file in a parent folder may name commits of other repositories). */
export function applyProofs(results: CheckResult[], proofs: Proof[], source: string, today = new Date(), checkHashes?: (p: Proof) => string | null): CheckResult[] {
  const warn = (p: Proof) => {
    const root = checkHashes?.(p);
    const bad = root ? unknownCommits(p, root) : [];
    return bad.length ? ` (warning: ${bad.join(", ")} named in this proof ${bad.length === 1 ? "is not a commit" : "are not commits"} in this repository)` : "";
  };
  return results.map((r) => {
    if (r.status !== "not-visible") return r;
    const p = proofs.find((x) => x.gate.toLowerCase() === r.gate.toLowerCase());
    if (!p) return r;
    const age = ageDays(p.date, today);
    if (!(age >= 0) || age > MAX_AGE_DAYS) {
      return { ...r, evidence: `${r.evidence}. Proof in ${source} dated ${p.date} is expired or invalid` };
    }
    return {
      ...r,
      status: "met",
      attested: true,
      evidence: `attested by ${p.by}, ${p.date}${p.ref ? ` (${p.ref})` : ""}: ${p.evidence}${warn(p)}`,
    };
  });
}
