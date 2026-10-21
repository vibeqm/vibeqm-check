import { agentPrompt, fixFor } from "./fixes.js";
import { homedir } from "node:os";
import { basename } from "node:path";
import { FRAMEWORK_VERSION, type CheckResult } from "./types.js";

/** Absolute home paths read better shortened: ~/.claude/settings.json. The
 * separator check keeps a sibling like /home/user2 from reading as ~/2. */
export const showPath = (s: string) => {
  const home = homedir();
  return s === home || s.startsWith(`${home}/`) || s.startsWith(`${home}\\`) ? `~${s.slice(home.length)}` : s;
};

const label = (r: CheckResult) =>
  r.status === "met" ? (r.attested ? "Met (attested)" : "Met") : r.status === "not-met" ? "Not met" : "Not visible";

/** Highest level whose checks, and all lower levels' checks, are met (staged rule). */
export function levelReached(results: CheckResult[]): number {
  let level = 1;
  for (const l of [2, 3, 4, 5]) {
    const at = results.filter((r) => r.level === l);
    if (!at.length || at.some((r) => r.status !== "met")) break;
    level = l;
  }
  return level;
}

const cell = (s: string) => s.replace(/\|/g, "\\|");

const LEVELS: Record<number, { name: string; what: string }> = {
  1: { name: "Unguided", what: "code is prompted, accepted and shipped when it runs" },
  2: { name: "Guarded", what: "every project has the professional basics (written requirements, a rules file, version control, a peer review and automated checks on every change, a security review before every push, development kept apart from production, limited agent permissions, and a human owner for every change)" },
  3: { name: "Standardized", what: "there is one standard across all projects, enforced by hooks, checks and permissions and audited, with traceable requirements, three environments, current dependencies, release and incident practices, and a record of which model wrote each change" },
  4: { name: "Measured", what: "quality and delivery are measured against limits, and the AI's right to merge stops automatically when a limit is crossed" },
  5: { name: "Self-Improving", what: "every escaped defect becomes a rule or check that makes it impossible to repeat" },
};

interface Parts { reached: number; next: number; open: CheckResult[]; minutes: number }

function parts(results: CheckResult[]): Parts {
  const reached = levelReached(results);
  const next = reached + 1;
  const open = results.filter((r) => r.status !== "met" && r.level === next);
  const minutes = open.reduce((n, r) => n + (fixFor(r)?.minutes ?? 0), 0);
  return { reached, next, open, minutes };
}

/** The answer first: the level, and what the next one takes, in a few sentences. */
/** Said on every report: what the tool touches and where data goes. */
export const PRIVACY =
  "Read-only and private: vqm-check changes no existing file in the repository (the only file it ever writes is a report you ask for, with --out) and sends nothing to us (no account, no telemetry). If the GitHub CLI is logged in, it asks GitHub, with your own login, for this repository's CI runs and pull requests; --offline turns that off.";

export function summary(repo: string, results: CheckResult[], date: string): string {
  const { reached, next, open, minutes } = parts(results);
  const now = LEVELS[reached];
  // The folder name, not the absolute path: a saved or shared report shouldn't carry
  // the person's account name (the terminal screen does the same).
  const out = [`# VibeQM self-assessment: ${basename(repo) || repo}, ${date}`, "", `_${PRIVACY}_`, "", `**You are on Level ${reached}, ${now.name}.**`];
  if (open.length) {
    const n = open.length;
    out.push(
      `You have met ${results.filter((r) => r.level === next && r.status === "met").length} of the ${results.filter((r) => r.level === next).length} Level ${next} items; meet ${n} more to reach Level ${next}, ${LEVELS[next].name}, where ${LEVELS[next].what}.`,
      `That is about ${minutes} minutes of work, most of which an AI coding agent can do.`,
    );
  } else if (results.some((r) => r.level === next)) {
    out.push(`Every Level ${next} check this tool runs is met.`);
  } else {
    out.push(`This version of the tool checks up to Level ${reached}; Levels above need measurements over time.`);
  }
  return out.join("\n");
}

/** The results of the scan, for the person. */
export function details(results: CheckResult[], proofFile: string | null = null): string {
  const { next, open } = parts(results);
  const attested = results.filter((r) => r.attested).length;
  const out = [
    `vqm-check against VibeQM v${FRAMEWORK_VERSION} (fact checks; a full VibeQM assessment adds the judgment questions, a second model from a`,
    `different company, and a person's countersignature). ${proofFile ? `Proof file: ${proofFile} (${attested} gate(s) attested).` : "No proof file."}`,
    "",
  ];
  if (open.length) {
    out.push(`## What it takes to reach Level ${next}`, "");
    for (const r of open) {
      const f = fixFor(r);
      out.push(`### ${r.gate}: ${label(r)}${f ? ` (~${f.minutes} min)` : ""}`, "", `Found: ${r.evidence}`, "");
      if (f) {
        out.push(`Why: ${f.why}`, "", ...f.steps.map((s) => `- ${s}`), "", `Verify: ${f.verify}`, "");
      }
    }
  }
  out.push(
    "## All checks",
    "",
    "| Level | Gate | Status | Evidence |",
    "|---|---|---|---|",
    ...results.map((r) => `| ${r.level} | ${r.gate} | ${label(r)} | ${cell(showPath(r.evidence))} |`),
    "",
    '"Not visible" counts as not met until a person attaches real proof. A proof never overrides "Not met".',
  );
  return out.join("\n");
}

/** The prompt an AI coding agent can follow to reach the next level; empty when nothing is open. */
export function aiPrompt(results: CheckResult[]): string {
  const { next, open } = parts(results);
  if (!open.length) return "";
  return [
    `## Prompt for your AI coding agent`,
    "",
    "Paste this into Claude Code, Codex or another agent working in this repository (or just say \"do it\" if the agent ran this report):",
    "",
    "```text",
    agentPrompt(open, next),
    "```",
  ].join("\n");
}

/** The whole report in one piece, for agents, pipes and CI: summary, details, then the prompt. */
export function markdown(repo: string, results: CheckResult[], date: string, proofFile: string | null = null): string {
  const note = [
    "> **AI agent reading this:** the prompt at the end of this report fixes the open gaps. Offer to run it,",
    "> then rerun `vqm-check`. Produce real evidence; never edit results or invent proof.",
  ].join("\n");
  return [summary(repo, results, date), note, details(results, proofFile), aiPrompt(results)].filter(Boolean).join("\n\n") + "\n";
}
