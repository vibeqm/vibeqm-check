// A scan laid out for a person at a terminal, in two screens: first the answer
// (the lead and a scorecard per level), then on request a numbered to-do list
// for the next level. Agents, pipes and CI get the Markdown report instead (report.ts).
import { NEEDS_LABEL, REUSE } from "./fixes.js";
import { basename } from "node:path";
import { claim, COVERAGE, lead, levelReached, parts, PRIVACY, showPath } from "./report.js";
import { FRAMEWORK_VERSION, type CheckResult } from "./types.js";

export interface Style {
  width: number;
  color: boolean;
}

const LEVEL_NAMES: Record<number, string> = { 1: "Unguided", 2: "Guarded", 3: "Standardized", 4: "Measured", 5: "Self-Improving" };

function paint(style: Style) {
  const c = (code: string) => (s: string) => (style.color ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { bold: c("1"), dim: c("2"), green: c("32"), red: c("31"), yellow: c("33"), cyan: c("36") };
}

/** Markdown inline marks a terminal would print literally: `code` and **bold**. */
function plain(s: string, p: ReturnType<typeof paint>): string {
  return s.replace(/`([^`]+)`/g, (_, code: string) => p.cyan(code)).replace(/\*\*([^*]+)\*\*/g, (_, b: string) => p.bold(b));
}

// Color codes take no room on screen; strip them when measuring.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const visible = (s: string) => s.replace(ANSI, "").length;

/** Word-wrap to the width, with a first-line prefix and an indent for the rest. */
function wrap(text: string, width: number, first: string, rest: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = first;
  let empty = true;
  for (const w of words) {
    if (!empty && visible(line) + 1 + visible(w) > width) {
      lines.push(line);
      line = rest + w;
    } else {
      line += (empty ? "" : " ") + w;
    }
    empty = false;
  }
  lines.push(line);
  return lines;
}

function clip(s: string, max: number): string {
  if (max <= 1) return "";
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  // Cut at a word boundary when one is close enough to keep; never mid-word by default.
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The evidence is prose written for the report; the scorecard wants its first sentence. */
function firstSentence(s: string): string {
  const cut = s.search(/[.!?] /);
  return cut < 0 ? s : s.slice(0, cut + 1);
}

/** One line of evidence for the scorecard: paths shortened, first sentence only,
 * proof-attested gates marked so a person's word never reads as what the tool saw. */
function briefEvidence(r: CheckResult, max: number): string {
  return clip(`${r.attested ? "attested · " : ""}${showPath(firstSentence(r.evidence))}`, max);
}

const widthOf = (style: Style) => Math.max(40, Math.min(style.width, 110));
const markOf = (p: ReturnType<typeof paint>) => (r: CheckResult) =>
  r.status === "met" ? p.green("✓") : r.status === "not-met" ? p.red("✗") : r.status === "in-place" ? p.cyan("◐") : p.yellow("○");

export const CTA_TERMINAL = 'Start: in Claude Code, Codex or another agent, say "run vibeqm-check and do what it says, asking me before each change". Or press Enter for the list and the prompt to paste.';

/** Screen one: the answer first — how far the next level is, who does what, what it
 * earns — then the scorecard. The full privacy note stays in the footer (terminalDetails),
 * so screen one spends its lines on the person's own results; the one dim line keeps the
 * promise visible up front. */
export function terminalSummary(repo: string, results: CheckResult[], date: string, style: Style): string {
  const p = paint(style);
  const width = widthOf(style);
  const name = basename(repo) || repo;
  const out: string[] = [];

  out.push(p.bold(`VibeQM self-assessment: ${name}, ${date}`));
  out.push(p.dim("Read-only and private · no account, no telemetry · the full note is at the end of the report"));
  out.push("");
  const { headline, lines } = lead(results, CTA_TERMINAL);
  out.push(...wrap(headline, width, "", "").map((l) => p.bold(l)));
  for (const line of lines) out.push(...wrap(plain(line, p), width, "", ""));
  out.push(p.dim(`Claim: ${claim(results, date)}.`));
  out.push("", scorecard(results, style));
  return out.join("\n");
}

function scorecard(results: CheckResult[], style: Style): string {
  const p = paint(style);
  const width = widthOf(style);
  const next = levelReached(results) + 1;
  const mark = markOf(p);
  const out: string[] = [];

  // Levels up to the next one list every check, open ones first;
  // levels beyond it show only their bar, so the list stays on what matters now.
  out.push(p.bold("SCORECARD"), "");
  const levels = [...new Set(results.map((r) => r.level))].sort();
  const nameWidth = Math.min(36, Math.max(...results.map((r) => r.gate.length)));
  const oneLine = width - 4 - nameWidth - 2 >= 40; // room for the evidence beside the name
  for (const level of levels) {
    const at = results.filter((r) => r.level === level);
    const met = at.filter((r) => r.status === "met").length;
    const bar = p.green("■".repeat(met)) + p.dim("□".repeat(at.length - met));
    out.push(`${p.bold(`Level ${level} · ${LEVEL_NAMES[level] ?? ""}`)}  ${bar}  ${met} of ${at.length} met`);
    if (level > next) {
      out.push(p.dim(`  Listed in full once Level ${level - 1} is reached.`), "");
      continue;
    }
    for (const r of [...at].sort((a, b) => Number(a.status === "met") - Number(b.status === "met"))) {
      if (oneLine) {
        const name = clip(r.gate, nameWidth).padEnd(nameWidth);
        out.push(`  ${mark(r)} ${name}  ${p.dim(briefEvidence(r, width - 4 - nameWidth - 2))}`);
      } else {
        out.push(`  ${mark(r)} ${r.gate}`, `    ${p.dim(briefEvidence(r, width - 4))}`);
      }
    }
    out.push("");
  }
  out.push(
    p.dim(
      wrap(
        `${p.green("✓")} met   ${p.red("✗")} not met   ${p.cyan("◐")} in place: set up, counts with use   ${p.yellow("○")} not visible: counts as not met until a person attaches proof   attested · = met by a person's proof`,
        width,
        "",
        "",
      ).join("\n"),
    ),
  );
  return out.join("\n");
}

/** Screen two: the to-do list for the next level, then the footer. */
export function terminalDetails(results: CheckResult[], proofFile: string | null, style: Style): string {
  const p = paint(style);
  const width = widthOf(style);
  const { next, open, minutes } = parts(results);
  const mark = markOf(p);
  const word = (r: CheckResult) =>
    r.status === "met" ? (r.attested ? "met, attested" : "met") : r.status === "not-met" ? "not met" : r.status === "in-place" ? "in place" : "not visible";
  const out: string[] = [];

  // The to-do list for the next level, cheapest first (the AI prompt's order).
  if (open.length) {
    out.push(p.bold(`TO REACH LEVEL ${next}: ${open.length} item${open.length === 1 ? "" : "s"}, about ${minutes} minutes`), "");
    open.forEach(({ r, f }, i) => {
      const n = `${i + 1}.`.padEnd(4);
      out.push(`${n}${mark(r)} ${p.bold(r.gate)}  ${p.dim(`${word(r)} · ~${f.minutes} min · ${NEEDS_LABEL[f.needs]}`)}`);
      const pad = "      ";
      out.push(...wrap(plain(showPath(r.evidence), p), width, `${pad}${p.dim("Found:")} `, `${pad}       `));
      out.push(...wrap(plain(f.why, p), width, `${pad}${p.dim("Why:")}   `, `${pad}       `));
      out.push(`${pad}${p.dim("Do:")}`);
      for (const s of f.steps) out.push(...wrap(plain(s, p), width, `${pad}  • `, `${pad}    `));
      out.push(...wrap(plain(f.verify, p), width, `${pad}${p.dim("Check:")} `, `${pad}       `));
      out.push("");
    });
    if (open.length >= 5) out.push(...wrap(REUSE, width, "", ""), "");
  }

  out.push(
    p.dim(
      wrap(
        `Fact checks against VibeQM v${FRAMEWORK_VERSION}. A formal VibeQM assessment adds judgment by two AI models from different companies and a person's countersignature. ${proofFile ? `Proof: ${showPath(proofFile)}.` : "No proof file."} ${COVERAGE} ${PRIVACY}`,
        width,
        "",
        "",
      ).join("\n"),
    ),
  );
  return out.join("\n");
}
