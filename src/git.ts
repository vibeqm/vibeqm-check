import { execFileSync } from "node:child_process";

/** Run git in the repository; returns stdout, or null when git fails. */
export function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** Changed lines (added + deleted) per commit for the last `n` commits, newest first. */
export function commitSizes(root: string, n: number): number[] {
  const out = git(root, ["log", `-${n}`, "--numstat", "--format=format:@@COMMIT"]);
  if (!out) return [];
  const sizes: number[] = [];
  let current: number | null = null;
  for (const line of out.split("\n")) {
    if (line === "@@COMMIT") {
      if (current !== null) sizes.push(current);
      current = 0;
      continue;
    }
    const [added, deleted] = line.split("\t");
    if (current !== null && /^\d+$/.test(added ?? "") && /^\d+$/.test(deleted ?? "")) {
      current += Number(added) + Number(deleted);
    }
  }
  if (current !== null) sizes.push(current);
  return sizes;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
