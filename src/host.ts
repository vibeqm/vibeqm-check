// Read-only facts from the code host, through the GitHub CLI when the person is logged
// in: CI runs and merged pull requests. Every call can fail (no gh, no login,
// no GitHub remote, offline) and then returns null, and the checks fall back to what the
// repository shows. Nothing here writes to the host.
import { execFileSync } from "node:child_process";

let disabled = false;

/** `--offline`: never call the host. */
export function offline(): void {
  disabled = true;
}

function gh<T>(root: string, args: string[]): T | null {
  if (disabled || process.env.VQM_OFFLINE === "1") return null;
  try {
    const out = execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

export interface Run {
  databaseId: number;
  workflowName: string;
  conclusion: string;
  createdAt: string;
  headSha: string;
}

const cache = new Map<string, unknown>();
function once<T>(key: string, f: () => T): T {
  if (!cache.has(key)) cache.set(key, f());
  return cache.get(key) as T;
}

/** The default branch's recent CI runs, newest first; null when the host can't be read. */
export function defaultBranchRuns(root: string): Run[] | null {
  return once(`runs:${root}`, () => {
    const repo = gh<{ defaultBranchRef: { name: string } }>(root, ["repo", "view", "--json", "defaultBranchRef"]);
    const branch = repo?.defaultBranchRef?.name;
    if (!branch) return null;
    return gh<Run[]>(root, ["run", "list", "--branch", branch, "--limit", "200", "--json", "databaseId,workflowName,conclusion,createdAt,headSha"]);
  });
}

export interface MergedPr {
  number: number;
  mergedAt: string;
  author: { login: string } | null;
  reviews: { author: { login: string } | null; state: string }[];
  commits: { oid: string }[];
}

/** Recently merged pull requests with their reviews and commits; null when unreadable. */
export function mergedPullRequests(root: string): MergedPr[] | null {
  return once(`prs:${root}`, () => gh<MergedPr[]>(root, ["pr", "list", "--state", "merged", "--limit", "100", "--json", "number,mergedAt,author,reviews,commits"]));
}

/** Tag names on the host, to tell pushed releases from local-only tags; null when unreadable. */
export function hostTags(root: string): string[] | null {
  return once(`tags:${root}`, () => gh<{ name: string }[]>(root, ["api", "repos/{owner}/{repo}/tags", "--paginate"])?.map((t) => t.name) ?? null);
}
