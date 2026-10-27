// Level 3 (Standardized) fact checks, from ASSESSOR.md v0.3 §2. Where a script can't
// prove a gate, the check says what proof a person must attach ("not-visible").
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { git } from "../git.js";
import type { CheckResult } from "../types.js";

const SAMPLE = 100;
const RULES_LIMIT = 200; // VQM_SPEC §6: rules files stay within a stated size limit
const RULES_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".cursorrules", ".github/copilot-instructions.md"];
const L3_FOLDERS = ["requirements", "decisions", "plan", "risks", "quality", "tailoring"];

const r3 = (gate: string, status: CheckResult["status"], evidence: string): CheckResult => ({ level: 3, gate, status, evidence });
const vibeqm = (root: string) => join(root, "VibeQM");

function mdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...mdFiles(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

export function oneWrittenStandard(root: string): CheckResult {
  const gate = "One written standard";
  if (existsSync(join(vibeqm(root), "README.md"))) return r3(gate, "met", "VibeQM/README.md indexes the project's standard documents");
  return r3(gate, "not-visible", "no VibeQM/ folder; if the standard lives elsewhere (a shared standards repo), attach proof");
}

export function standardIsFollowed(_root: string): CheckResult {
  return r3("Standard is followed", "not-visible", "needs an audit or check that can fail (script, CI job, enforced checklist) and its record; attach proof");
}

/** Model and version recorded per change: a commit trailer naming a model with a version number. */
export function provenance(root: string): CheckResult {
  const gate = "Provenance";
  const bodies = (git(root, ["log", `-${SAMPLE}`, "--format=%B%x00"]) ?? "").split("\0").map((b) => b.trim()).filter(Boolean);
  if (!bodies.length) return r3(gate, "not-met", "no commits to sample");
  const trailer = /^(Model|AI-Model|Generated-by|Assisted-by|Co-Authored-By):.*\b(claude|opus|sonnet|haiku|gpt|o\d|gemini|glm|deepseek|llama|qwen|codex|copilot)\b.*\d/im;
  const withModel = bodies.filter((b) => trailer.test(b)).length;
  const share = withModel / bodies.length;
  const evidence = `${withModel} of ${bodies.length} sampled commits name a model and version in a trailer (e.g. "Model: claude-opus-5-5")`;
  return r3(gate, share >= 0.9 ? "met" : "not-met", evidence);
}

export function preflight(_root: string): CheckResult {
  return r3("Preflight beyond green builds", "not-visible", "needs a gate that inspects real output (rendered pages, artifacts, smoke tests); attach proof");
}

export function documentationStandard(root: string): CheckResult {
  const gate = "Documentation standard";
  const base = vibeqm(root);
  if (!existsSync(base)) return r3(gate, "not-visible", "no VibeQM/ folder; documents kept elsewhere need a tailoring record (attach proof)");
  const missing = L3_FOLDERS.filter((f) => !mdFiles(join(base, f)).length);
  const noFront = mdFiles(base).filter((p) => !readFileSync(p, "utf8").startsWith("---\n")).map((p) => relative(root, p));
  if (!missing.length && !noFront.length) return r3(gate, "met", `VibeQM/ has ${L3_FOLDERS.join(", ")}, all with front matter`);
  const parts = [];
  if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
  if (noFront.length) parts.push(`no front matter: ${noFront.slice(0, 5).join(", ")}${noFront.length > 5 ? "…" : ""}`);
  return r3(gate, "not-met", `${parts.join("; ")} (a tailoring record may cover them)`);
}

function settingsFiles(root: string): string[] {
  return [join(root, ".claude", "settings.json"), join(root, ".claude", "settings.local.json"), join(homedir(), ".claude", "settings.json")].filter(existsSync);
}

function readJson(p: string): any {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function criticalRulesEnforced(root: string): CheckResult {
  const gate = "Critical rules enforced";
  const found: string[] = [];
  for (const f of settingsFiles(root)) {
    const s = readJson(f);
    const pre = s?.hooks?.PreToolUse?.length ?? 0;
    const deny = s?.permissions?.deny?.length ?? 0;
    if (pre) found.push(`${pre} PreToolUse hook group(s) in ${f}`);
    if (deny) found.push(`${deny} deny rules in ${f}`);
  }
  const hooksPath = git(root, ["config", "core.hooksPath"])?.trim();
  if (hooksPath) found.push(`git hooks at ${hooksPath}`);
  if (!found.length) return r3(gate, "not-met", "no hooks, blocking git hooks or deny rules found");
  return r3(gate, "not-visible", `enforcement exists (${found.join("; ")}), but the mapping from each critical rule (covering every high-risk category) to its enforcement must be shown; attach proof`);
}

export function riskClasses(_root: string): CheckResult {
  return r3("Risk classes and peer review by risk", "not-visible", "the assessor re-sorts a sample of changes into risk classes and checks the required review; attach the result");
}

/** Rules files a session started in this repo loads: the repo's and its parent folders'. */
function loadedRulesFiles(root: string): string[] {
  const files: string[] = [];
  const stop = dirname(homedir());
  for (let dir = resolve(root); dir !== stop && dir !== dirname(dir); dir = dirname(dir)) {
    for (const f of RULES_FILES) if (existsSync(join(dir, f))) files.push(join(dir, f));
  }
  return files;
}

/** Each agent the repo is set up for must have a full model id with a version, not an alias. */
export function modelsPinned(root: string): CheckResult {
  const gate = "Models pinned";
  const rules = loadedRulesFiles(root).map((f) => f.split("/").pop());
  const agents: { name: string; pin: string | null }[] = [];
  if (rules.includes("CLAUDE.md")) {
    let pin: string | null = null;
    for (const f of settingsFiles(root)) {
      const m = readJson(f)?.model;
      if (typeof m === "string") { pin = `${m} (${f})`; break; }
    }
    agents.push({ name: "Claude Code", pin });
  }
  if (rules.includes("AGENTS.md")) {
    let pin: string | null = null;
    for (const f of [join(root, ".codex", "config.toml"), join(homedir(), ".codex", "config.toml")]) {
      const m = existsSync(f) ? readFileSync(f, "utf8").match(/^\s*model\s*=\s*"([^"]+)"/m) : null;
      if (m) { pin = `${m[1]} (${f})`; break; }
    }
    agents.push({ name: "Codex", pin });
  }
  if (!agents.length) return r3(gate, "not-visible", "no CLAUDE.md or AGENTS.md, so the agent in use is unknown; attach proof of the pinned model");
  const bad = agents.filter((a) => !a.pin || !/\d/.test(a.pin.split(" ")[0]!));
  const desc = agents.map((a) => `${a.name}: ${a.pin ?? "no model set (tool default)"}`).join("; ");
  return r3(gate, bad.length ? "not-met" : "met", desc + (bad.length ? ". A missing model or an alias without a version is not pinned" : ""));
}

/** Every rules file a session started in this repo loads: the repo's and its parent folders'. */
export function rulesShort(root: string): CheckResult {
  const gate = "Rules kept short and current";
  const files = loadedRulesFiles(root);
  if (!files.length) return r3(gate, "not-met", "no rules file found");
  const sizes = files.map((f) => ({ f, n: readFileSync(f, "utf8").split("\n").length }));
  const over = sizes.filter((s) => s.n > RULES_LIMIT);
  const fmt = (xs: typeof sizes) => xs.map((s) => `${s.f} (${s.n} lines)`).join("; ");
  if (!over.length) return r3(gate, "met", `all within ${RULES_LIMIT} lines: ${fmt(sizes)}`);
  const ok = sizes.filter((s) => s.n <= RULES_LIMIT);
  return r3(gate, "not-met", `over the ${RULES_LIMIT}-line limit: ${fmt(over)}${ok.length ? `. Within it: ${fmt(ok)}` : ""}`);
}

export function lessonsRecorded(root: string): CheckResult {
  const gate = "Lessons recorded";
  const candidates = [join(root, "LESSONS.md"), ...mdFiles(vibeqm(root)).filter((p) => /lesson/i.test(p))];
  for (let dir = dirname(resolve(root)); dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, "LESSONS.md"))) {
      candidates.push(join(dir, "LESSONS.md"));
      break;
    }
  }
  for (const f of candidates.filter(existsSync)) {
    const dated = (readFileSync(f, "utf8").match(/\b20\d\d-\d\d-\d\d\b/g) ?? []).length;
    if (dated) return r3(gate, "met", `${f}: ${dated} dated mentions`);
  }
  return r3(gate, "not-met", "no lessons log with dated entries (LESSONS.md, or a lessons file under VibeQM/)");
}

export function dataBoundary(root: string): CheckResult {
  const gate = "Data boundary";
  const hit = mdFiles(vibeqm(root)).find((p) => /data.?boundary/i.test(p) || /data boundary/i.test(readFileSync(p, "utf8")));
  if (hit) return r3(gate, "met", `${relative(root, hit)} mentions the data boundary (check it lists what may go to which AI company)`);
  return r3(gate, existsSync(vibeqm(root)) ? "not-met" : "not-visible", "no written data boundary: which code and data may go to which AI company");
}

const notVisible = (gate: string, need: string) => (_root: string) => r3(gate, "not-visible", need);

export const level3 = [
  oneWrittenStandard,
  standardIsFollowed,
  provenance,
  preflight,
  documentationStandard,
  criticalRulesEnforced,
  riskClasses,
  modelsPinned,
  rulesShort,
  lessonsRecorded,
  notVisible("Gates proven", "needs a record of each automated Level 2–3 check catching a planted fault; attach proof"),
  dataBoundary,
  notVisible("Agent plug-ins and tools", "outside plug-ins, tool servers and skills must be pinned and added as high-risk changes; attach proof"),
  notVisible("Parallel agents and rollback", "agents on separate branches through the same checks, and a tried rollback; attach proof"),
  notVisible("Generated-code licensing", "a license check on new code; attach proof"),
  notVisible("Reviewer proven", "the AI peer reviewer's model and version need a record of catching a planted-fault set (at least five known-bad changes, including a weakened test and a prompt-injection case), kept where the agent can't edit it; attach proof"),
  notVisible("Service-bound items (applicability)", "a product with no live production service states an equivalent or a not-applicable reason for each service-bound item, recorded as tailoring; attach proof"),
];
