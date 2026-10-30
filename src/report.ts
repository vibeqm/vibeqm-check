import { agentPrompt, type Fix, fixOrder, NEEDS_LABEL, REUSE } from "./fixes.js";
import { homedir } from "node:os";
import { basename } from "node:path";
import { FRAMEWORK_VERSION, type CheckResult } from "./types.js";

/** Absolute home paths read better shortened: ~/.claude/settings.json. The
 * separator check keeps a sibling like /home/user2 from reading as ~/2. */
export const showPath = (s: string) => {
  const home = homedir();
  return s === home || s.startsWith(`${home}/`) || s.startsWith(`${home}\\`) ? `~${s.slice(home.length)}` : s;
};

export const label = (r: CheckResult) =>
  r.status === "met" ? (r.attested ? "Met (attested)" : "Met") : r.status === "not-met" ? "Not met" : r.status === "in-place" ? "In place" : "Not visible";

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

/** Each level: its name, what it means, and the autonomy it earns (VQM_SPEC §3), said
 * with every result so the person knows what finishing buys. */
export const LEVELS: Record<number, { name: string; what: string; earns: string }> = {
  1: { name: "Unguided", what: "code is prompted, accepted and shipped when it runs", earns: "nothing yet: everything the AI writes is a draft a person reads before it lands" },
  2: {
    name: "Guarded",
    what: "every project has the professional basics (written requirements, a rules file, version control, a peer review and automated checks on every change, a security review before every push, development kept apart from production, limited agent permissions, and a human owner for every change)",
    earns: "you approve every change after the checks and a review, instead of reading every line yourself; the AI keeps working on its own branch, and a bad change now meets a gate that can refuse it",
  },
  3: {
    name: "Standardized",
    what: "there is one standard across all projects, enforced by hooks, checks and permissions and audited, with traceable requirements, three environments, current dependencies, release and incident practices, and a record of which model wrote each change",
    earns: "the AI takes a task from an issue to a finished pull request on its own; a person approves every merge",
  },
  4: { name: "Measured", what: "quality and delivery are measured against limits, and the AI's right to merge stops automatically when a limit is crossed", earns: "the AI merges low-risk changes itself, after the checks and an AI peer review, while the numbers stay within their limits" },
  5: { name: "Self-Improving", what: "every escaped defect becomes a rule or check that makes it impossible to repeat", earns: "the AI merges low- and standard-risk changes under a written performance agreement, with an AI peer and a kill switch" },
};

/** What the person is asked for, per gate, when the fix needs an answer from them. */
const ASKS: Record<string, string> = {
  "Development apart from production": "what is live",
  "Requirements first": "the requirements to confirm",
  "Peer review on every change": "the review route",
  "Version control + merge path": "branch protection on the host",
};

export interface Parts {
  reached: number;
  next: number;
  at: CheckResult[]; // every gate of the next level
  met: CheckResult[];
  open: { r: CheckResult; f: Fix }[]; // not met, cheapest first
  inPlace: CheckResult[];
  minutes: number;
  agent: { r: CheckResult; f: Fix }[];
  answers: { r: CheckResult; f: Fix }[];
  host: { r: CheckResult; f: Fix }[];
  use: { r: CheckResult; f: Fix }[];
}

export function parts(results: CheckResult[]): Parts {
  const reached = levelReached(results);
  const next = reached + 1;
  const at = results.filter((r) => r.level === next);
  const met = at.filter((r) => r.status === "met");
  const open = fixOrder(at.filter((r) => r.status !== "met"));
  // The split counts what is still to do; a gate in place is already set up and waits for use.
  const todo = open.filter((x) => x.r.status !== "in-place");
  const by = (n: Fix["needs"]) => todo.filter((x) => x.f.needs === n);
  return {
    reached,
    next,
    at,
    met,
    open,
    inPlace: at.filter((r) => r.status === "in-place"),
    minutes: open.reduce((n, x) => n + x.f.minutes, 0),
    agent: by("agent"),
    answers: by("answer"),
    host: by("host"),
    use: by("use"),
  };
}

/** What the fact checks cover, said with every result so a level is not read as more than it is. */
export const COVERAGE =
  "This tool runs the fact checks of the 13 Level 2 gates (the README and the formatter configuration the specification also lists at Level 2 are not checked) and lists every Level 3 gate, checking about half of them from the repository (the rest need proof a person attaches); Levels 4 and 5 are not checked. The judgment questions, a second model and a countersignature are the rest of an assessment.";

export const PRIVACY =
  "Read-only and private: this check changes no file in the repository (the tool writes only what you ask for: a report with --out, or the starter files that init lists and you confirm) and sends nothing to us (no account, no telemetry). If the GitHub CLI is logged in, it asks GitHub, with your own login, for this repository's CI runs, pull requests and branch rules; --offline turns that off.";

/** The claim a scorecard carries (VQM_SPEC §13), with the progress profile at every level. */
export function claim(results: CheckResult[], date: string): string {
  const { reached, next, at, open, inPlace } = parts(results);
  const counting = inPlace.map((r) => (r.progress ? `${r.gate.toLowerCase()} in place, ${r.progress.done} of ${r.progress.needed} ${r.progress.unit}` : `${r.gate.toLowerCase()} in place`));
  const profile = at.length && open.length ? `; Level ${next}: ${open.length} of ${at.length} items open${counting.length ? `, ${counting.join(", ")}` : ""}` : "";
  return `VibeQM v${FRAMEWORK_VERSION} self-assessed: Level ${reached}, ${date}, vibeqm-check (fact checks only)${profile}`;
}

const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;

/** The answer first, in the order a person needs it: how far the next level is, what is
 * already there, who does the rest, what today's level is and what the next one earns.
 * Every sentence is computed from the run; nothing is canned praise. `headline` is the
 * line to show in bold; `lines` follow it; `cta` is the one thing to do now. */
export function lead(results: CheckResult[], cta: string): { headline: string; lines: string[] } {
  const p = parts(results);
  const now = LEVELS[p.reached];
  const up = LEVELS[p.next];
  const lines: string[] = [];
  if (!p.at.length) {
    return { headline: `You are on Level ${p.reached}, ${now.name}.`, lines: [`This version of the tool checks up to Level ${p.reached}; Levels above need measurements over time.`] };
  }
  if (!p.open.length) {
    return {
      headline: `Every Level ${p.next} fact check this tool runs is met.`,
      lines: [
        `To put Level ${p.next} on your scorecard: answer the judgment questions (the VibeQM plugin's judgment skill, or vibeqm.com/assessor, section 2), then write the claim below with your name as the assessor. Level ${p.next} earns: ${up.earns}.`,
      ],
    };
  }
  const waiting = p.open.filter((x) => x.r.status === "in-place");
  const todo = p.open.filter((x) => x.r.status !== "in-place");
  const nearly = todo.length <= 3 || p.met.length >= (p.at.length * 2) / 3;
  const countdown = waiting.map(({ r }) => (r.progress ? `${r.gate.toLowerCase()} counts after ${r.progress.needed} ${r.progress.unit} (${r.progress.done} so far)` : `${r.gate.toLowerCase()} counts with use`));
  const headline = !todo.length
    ? `Level ${p.next} is in place: ${p.met.length} of ${p.at.length} met, and ${countdown.join("; ")}.`
    : `${nearly ? "Nearly there: " : ""}Level ${p.next}, ${up.name}, is ${plural(todo.length, "item")} away${waiting.length ? `, plus ${plural(waiting.length, "gate")} that count${waiting.length === 1 ? "s" : ""} with use` : ""}.`;
  if (p.met.length) {
    const names = p.met.map((r) => r.gate);
    lines.push(`Already met, ${p.met.length} of ${p.at.length}: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` and ${names.length - 6} more` : ""}.`);
  }
  if (todo.length) {
    const split: string[] = [];
    const agentMinutes = p.agent.reduce((n, x) => n + x.f.minutes, 0);
    const confirms = p.agent.filter((x) => x.f.confirm).length;
    if (p.agent.length) split.push(`your AI agent can do ${p.agent.length === todo.length ? (todo.length === 1 ? "it" : "all of them") : `${p.agent.length} of them`} now${confirms ? `, asking you to confirm ${confirms === 1 ? "one record" : `${confirms} records`} as it goes` : ""} (about ${agentMinutes} minutes)`);
    const asks = p.answers.map(({ r }) => ASKS[r.gate] ?? r.gate.toLowerCase());
    if (p.answers.length) split.push(`${p.answers.length} need${p.answers.length === 1 ? "s" : ""} an answer from you (${asks.join(", ")})`);
    if (p.host.length) split.push(`${p.host.length} ${p.host.length === 1 ? "is" : "are"} a setting on the code host (${p.host.map(({ r }) => ASKS[r.gate] ?? r.gate.toLowerCase()).join(", ")})`);
    if (p.use.length) split.push(`${p.use.length} count${p.use.length === 1 ? "s" : ""} with use (${p.use.map(({ r }) => r.gate.toLowerCase()).join(", ")})`);
    const sentence = split.join("; ");
    // Peer review not set up yet still ends in the 20-change count: say so now, not at push 1.
    const review = todo.find(({ r }) => r.gate === "Peer review on every change");
    const ahead = review ? ` Then peer review counts over your next 20 reviewed changes: Level ${p.next} is met on the 20th, not in this session.` : "";
    lines.push(`${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}${split.length ? "." : ""}${waiting.length ? ` Then ${countdown.join("; ")}.` : ahead}`);
  }
  lines.push(`Today's level: ${p.reached}, ${now.name}. Level ${p.next} earns: ${up.earns}.`);
  // No rules file at all: init comes before the list, and the call to action says so.
  const bare = p.open.some(({ r }) => r.gate === "Agent rules file" && /^none of/.test(r.evidence));
  lines.push(bare ? `First: \`npx vibeqm-check init\` creates the starter files (it shows the list and asks). ${cta}` : cta);
  return { headline, lines };
}

export const CTA_REPORT = 'Start: say "do it" to the agent that ran this, or paste the prompt at the end of this report into Claude Code, Codex or another agent working in this repository. The agent does everything it can alone, then asks you everything in one message, and shows you each change before it commits.';

export function summary(repo: string, results: CheckResult[], date: string): string {
  // The folder name, not the absolute path: a saved or shared report shouldn't carry
  // the person's account name (the terminal screen does the same).
  const { headline, lines } = lead(results, CTA_REPORT);
  return [`# VibeQM self-assessment: ${basename(repo) || repo}, ${date}`, "", `_${PRIVACY}_`, "", `**${headline}**`, ...lines.map((l) => `\n${l}`), "", `_Claim: ${claim(results, date)}._`].join("\n");
}

/** The results of the scan, for the person. */
export function details(results: CheckResult[], proofFile: string | null = null): string {
  const { next, open } = parts(results);
  const attested = results.filter((r) => r.attested).length;
  const out = [
    `vibeqm-check against VibeQM v${FRAMEWORK_VERSION} (fact checks; a full VibeQM assessment adds the judgment questions, a second model from a`,
    `different company, and a person's countersignature). ${proofFile ? `Proof file: ${showPath(proofFile)} (${attested} gate(s) attested).` : "No proof file."}`,
    "",
    `_${COVERAGE}_`,
    "",
  ];
  if (open.length) {
    out.push(`## What it takes to reach Level ${next}`, "");
    for (const { r, f } of open) {
      out.push(`### ${r.gate}: ${label(r)} (~${f.minutes} min; ${NEEDS_LABEL[f.needs]})`, "", `Found: ${showPath(r.evidence)}`, "");
      out.push(`Why: ${f.why}`, "", ...f.steps.map((s) => `- ${s}`), "", `Verify: ${f.verify}`, "");
    }
    if (open.length >= 5) out.push(`_${REUSE}_`, "");
  }
  out.push(
    "## All checks",
    "",
    "| Level | Gate | Status | Evidence |",
    "|---|---|---|---|",
    ...results.map((r) => `| ${r.level} | ${r.gate} | ${label(r)} | ${cell(showPath(r.evidence))} |`),
    "",
    '"Not visible" counts as not met until a person attaches real proof; "In place" is set up and counts with use. A proof never overrides "Not met".',
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
    agentPrompt(
      open.map((x) => x.r),
      next,
    ),
    "```",
  ].join("\n");
}

/** The whole report in one piece, for agents, pipes and CI: summary, details, then the prompt. */
export function markdown(repo: string, results: CheckResult[], date: string, proofFile: string | null = null): string {
  const note = [
    "> **AI agent reading this:** the prompt at the end of this report fixes the open gaps. Offer to run it, then",
    "> rerun `vibeqm-check`. Do every item you can alone first, then ask the person for the rest in one message.",
    "> Produce real evidence; never edit results or invent proof.",
  ].join("\n");
  return [summary(repo, results, date), note, details(results, proofFile), aiPrompt(results)].filter(Boolean).join("\n\n") + "\n";
}

