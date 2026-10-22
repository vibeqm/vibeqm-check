// Level 2 (Guarded) fact checks, from ASSESSOR.md v0.3 §2. Judgment questions are
// left to the AI assessor; this file only reports what a script can prove.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { commitSizes, git, median } from "../git.js";
import { defaultBranchRuns, mergedPullRequests } from "../host.js";
import { blanksNote, CHECK_COMMANDS, code, committedSettings, delegated, placeholders, RULES_FILES } from "./basics.js";
import type { CheckResult } from "../types.js";

const SMALL_BATCH_LIMIT = 400; // ASSESSOR §2: median changed lines per merged change
const SAMPLE = 100;

export function agentRulesFile(root: string): CheckResult {
  const present = RULES_FILES.filter((f) => existsSync(join(root, f)));
  // A rules file that is not committed stays on this machine: clones and CI never see it.
  // Outside git there is nothing to commit to, so a file on disk is all there is.
  const inGit = git(root, ["rev-parse", "--git-dir"]) !== null;
  // HEAD, not the index: a staged file is not in any clone yet. No commits yet means none.
  const tracked = new Set((git(root, ["ls-tree", "-r", "--name-only", "HEAD", "--", ...present]) ?? "").split("\n").filter(Boolean));
  const local = inGit ? present.filter((f) => !tracked.has(f)) : [];
  const found = present.filter((f) => !local.includes(f));
  const gate = "Agent rules file";
  if (!found.length) {
    const note = local.length ? `; ${local.join(", ")} exists but is not committed, so clones and CI don't have it` : "";
    return { level: 2, gate, status: "not-met", evidence: `none of ${RULES_FILES.join(", ")} found${note}` };
  }
  // A copied template still holding its blanks tells the agent nothing about this repository.
  const text = (f: string) => readFileSync(join(root, f), "utf8");
  const filled = found.filter((f) => !placeholders(text(f)).length);
  const blanks = found.filter((f) => !filled.includes(f)).map((f) => blanksNote(f, placeholders(text(f))));
  if (!filled.length) {
    return { level: 2, gate, status: "not-met", evidence: `${blanks.join("; ")}: fill them with this repository's facts, or delete what doesn't apply` };
  }
  const lines = filled.map((f) => `${f} (${text(f).split("\n").length} lines)`);
  return { level: 2, gate, status: "met", evidence: [...lines, ...blanks].join("; ") };
}

export function versionControl(root: string): CheckResult {
  const gate = "Version control + merge path";
  if (git(root, ["rev-parse", "--git-dir"]) === null) {
    return { level: 2, gate, status: "not-met", evidence: "not a git repository" };
  }
  const merges = (git(root, ["log", `-${SAMPLE}`, "--merges", "--format=%h"]) ?? "").split("\n").filter(Boolean);
  if (merges.length) {
    return { level: 2, gate, status: "met", evidence: `${merges.length} merge commits in the last ${SAMPLE} (e.g. ${merges[0]})` };
  }
  const prs = mergedPullRequests(root);
  if (prs?.length) {
    return { level: 2, gate, status: "met", evidence: `${prs.length} pull requests merged on the host (e.g. #${prs[0].number}, ${prs[0].mergedAt.slice(0, 10)})` };
  }
  return {
    level: 2,
    gate,
    status: "not-visible",
    evidence:
      "git repository, but no merge commits in the sample. Branch protection is set on the host (e.g. GitHub) and can't be read locally; a tailoring record may let a blocking pre-commit gate stand in for pull requests",
  };
}

function hooksDir(root: string): string | null {
  const configured = git(root, ["config", "core.hooksPath"])?.trim();
  if (configured) return configured.startsWith("/") ? configured : join(root, configured);
  const gitDir = git(root, ["rev-parse", "--absolute-git-dir"])?.trim();
  return gitDir ? join(gitDir, "hooks") : null;
}

export function checksBeforeMerge(root: string): CheckResult {
  const gate = "Checks before merge";
  const evidence: string[] = [];
  const workflows = join(root, ".github", "workflows");
  if (existsSync(workflows)) {
    const files = readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f));
    if (files.length) evidence.push(`CI workflows: ${files.join(", ")}`);
  }
  for (const f of [".gitlab-ci.yml", ".circleci/config.yml", "azure-pipelines.yml"]) {
    if (existsSync(join(root, f))) evidence.push(`CI config: ${f}`);
  }
  // A hook counts when it runs a test, lint or analyze command (itself or through
  // the Makefile or a repository script it calls); `exit 0` is not a gate.
  // core.hooksPath is per-clone config, so say where the hook lives.
  const hooks = hooksDir(root);
  const idle: string[] = [];
  for (const name of ["pre-commit", "pre-push"]) {
    const p = hooks ? join(hooks, name) : null;
    if (!p || !existsSync(p) || !(statSync(p).mode & 0o111)) continue;
    const text = readFileSync(p, "utf8");
    const runs = code(text + "\n" + delegated(root, text)).match(CHECK_COMMANDS)?.[0];
    if (!runs) {
      idle.push(name);
      continue;
    }
    const rel = relative(realpathSync(root), realpathSync(p));
    const where = rel.startsWith("..")
      ? "a shared hook outside the repository, enabled on this machine"
      : (git(root, ["ls-files", rel]) ?? "").trim()
        ? `committed in the repository (${rel}); each clone enables it with \`git config core.hooksPath\``
        : "enabled on this machine only, not committed";
    evidence.push(`blocking git hook ${name} runs \`${runs.trim()}\`: ${where}`);
  }
  if (idle.length && !evidence.length) {
    return { level: 2, gate, status: "not-met", evidence: `${idle.join(" and ")} hook found, but it runs no test, lint or analyze command this tool recognises` };
  }
  if (!evidence.length) {
    return { level: 2, gate, status: "not-met", evidence: "no CI configuration and no executable pre-commit/pre-push hook" };
  }
  // CI that runs is not the same as CI that blocks: required status checks live on the host.
  const onlyCi = !evidence.some((e) => e.startsWith("blocking git hook"));
  return {
    level: 2,
    gate,
    status: onlyCi ? "not-visible" : "met",
    evidence: evidence.join("; ") + (onlyCi ? ". Whether failing CI blocks the merge is a host setting; attach proof" : ""),
  };
}

export function smallBatches(root: string): CheckResult {
  const gate = "Small batches";
  const sizes = commitSizes(root, SAMPLE);
  if (!sizes.length) return { level: 2, gate, status: "not-met", evidence: "no commits to sample" };
  const m = median(sizes);
  return {
    level: 2,
    gate,
    status: m <= SMALL_BATCH_LIMIT ? "met" : "not-met",
    evidence: `median ${m} changed lines per commit over the last ${sizes.length} commits (limit ${SMALL_BATCH_LIMIT})`,
  };
}

export function ownerPerChange(root: string): CheckResult {
  const gate = "Owner per change";
  const authors = (git(root, ["log", `-${SAMPLE}`, "--format=%an <%ae>"]) ?? "").split("\n").filter(Boolean);
  if (!authors.length) return { level: 2, gate, status: "not-met", evidence: "no commits to sample" };
  const bots = authors.filter((a) => /\[bot\]|noreply@anthropic|claude|copilot|codex/i.test(a));
  const people = new Set(authors.filter((a) => !bots.includes(a)));
  // Agents often commit under the owner's name; their trailers say so. Ownership is then
  // explicit: the named author owns what the agent wrote.
  const agentWritten = (git(root, ["log", `-${SAMPLE}`, "--format=%(trailers:key=Co-Authored-By,key=Claude-Session,key=Generated-by,key=Model,valueonly,separator=;)%x1e"]) ?? "")
    .split("\x1e")
    .filter((t) => /claude|anthropic|copilot|codex|openai|gemini|cursor|aider|glm|deepseek|model/i.test(t)).length;
  return {
    level: 2,
    gate,
    status: bots.length ? "not-met" : "met",
    evidence: bots.length
      ? `${bots.length} of ${authors.length} commits authored by an agent account (e.g. ${bots[0]}); each change needs a named human owner`
      : `all ${authors.length} sampled commits have a human author: ${[...people].slice(0, 3).join(", ")}${agentWritten ? `; ${agentWritten} of them written with an AI agent (per their trailers), owned by that author` : ""}`,
  };
}

/** Claude Code deny rules or a sandbox, in settings committed to the repository. */
export function agentPermissions(root: string): CheckResult {
  const gate = "Agent permissions";
  const found: string[] = [];
  const machine: string[] = [];
  const unreadable: string[] = [];
  for (const { file, committed, text } of committedSettings(root)) {
    try {
      const s = JSON.parse(text ?? "");
      const deny: string[] = s?.permissions?.deny ?? [];
      const into = committed ? found : machine;
      if (deny.length) into.push(`${deny.length} deny rules in ${file}`);
      if (s?.sandbox?.enabled) into.push(`sandbox enabled in ${file}`);
    } catch {
      unreadable.push(`unreadable settings: ${file}`);
    }
  }
  if (!found.length) {
    // Limits on this machine are real here, but clones and CI don't have them: a person can attest them.
    const local = machine.length ? [`${machine.join("; ")}: this machine's settings, not committed, so other clones and CI don't have them; commit .claude/settings.json, or attach proof that every machine working on this repository has them`] : [];
    return {
      level: 2,
      gate,
      status: "not-visible",
      // An unreadable file is not a limit: it says so, and never meets the gate.
      evidence: [...unreadable, ...local, ...(local.length ? [] : ["no Claude Code deny rules or sandbox committed; other agents' settings are not read yet. Attach proof of limits"])].join("; "),
    };
  }
  return { level: 2, gate, status: "met", evidence: [...found, ...machine.map((m) => `also ${m} (this machine only)`), ...unreadable].join("; ") };
}

/** A CI run on the default branch that failed, then a later run of the same workflow
 * that passed: the checks refused a change and it was fixed. */
export function checksSeenToFail(root: string): CheckResult {
  const gate = "Checks seen to fail";
  const runs = defaultBranchRuns(root);
  if (runs) {
    const oldestFirst = [...runs].reverse();
    for (const [i, failed] of oldestFirst.entries()) {
      if (failed.conclusion !== "failure") continue;
      const fixed = oldestFirst.slice(i + 1).find((x) => x.workflowName === failed.workflowName && x.conclusion === "success");
      if (fixed) {
        return {
          level: 2,
          gate,
          status: "met",
          evidence: `CI run ${failed.databaseId} (${failed.workflowName}) failed on the default branch on ${failed.createdAt.slice(0, 10)}; a later run, ${fixed.databaseId}, passed (read from the host)`,
        };
      }
    }
  }
  return {
    level: 2,
    gate,
    status: "not-visible",
    evidence: `${runs ? `no failed-then-passed CI run in the default branch's last ${runs.length} runs; ` : ""}needs a CI run that blocked a change, or a recorded planted fault`,
  };
}

export const level2 = [agentRulesFile, versionControl, checksBeforeMerge, smallBatches, agentPermissions, ownerPerChange, checksSeenToFail];
