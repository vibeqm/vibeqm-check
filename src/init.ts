// `vibeqm-check init`: create the Level 2 template files in a repository. It
// lists what it will create, skips what exists, and writes only after the
// person says yes: never over a file, never a commit, never a hook enabled (it
// writes .githooks/pre-commit; enabling it is one command the person runs).
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** The bundled templates: dist/src/init.js → <package>/templates/level-2. */
export const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates", "level-2");

// npm drops .gitignore files from a package, so the bundle names it "gitignore".
const RENAMED: Record<string, string> = { gitignore: ".gitignore" };

export interface InitFile {
  from: string; // absolute path in the bundle
  to: string; // path relative to the repository
  exists: boolean;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Every template file and where it would go; nothing is written. */
export function planInit(root: string, templates = TEMPLATES): InitFile[] {
  return walk(templates)
    .map((from) => {
      const rel = relative(templates, from);
      const to = RENAMED[rel] ?? rel;
      return { from, to, exists: existsSync(join(root, to)) };
    })
    .sort((a, b) => a.to.localeCompare(b.to));
}

/** What the repository already says about itself: the facts the templates' blanks
 * can be filled with, read from the build files. Only facts, never guesses: a blank
 * the repository doesn't answer stays a blank for the person or their agent. */
export interface Facts {
  test?: string; // the command that runs the tests (and the linter, when there is one)
  build?: string;
  description?: string;
}

const read = (root: string, f: string): string => {
  try {
    return readFileSync(join(root, f), "utf8");
  } catch {
    return "";
  }
};

export function detectFacts(root: string): Facts {
  const facts: Facts = {};
  const pkg = read(root, "package.json");
  if (pkg) {
    try {
      const j = JSON.parse(pkg);
      const scripts = j.scripts ?? {};
      const parts = [scripts.test ? "npm test" : "", scripts.lint ? "npm run lint" : ""].filter(Boolean);
      if (parts.length) facts.test = parts.join(" && ");
      if (scripts.build) facts.build = "npm run build";
      if (typeof j.description === "string" && j.description.trim()) facts.description = j.description.trim();
    } catch {
      /* not JSON: no facts from it */
    }
  }
  const make = read(root, "Makefile");
  if (make) {
    const targets = [...make.matchAll(/^([a-zA-Z][\w-]*):/gm)].map((m) => m[1]);
    const t = ["check", "test", "lint"].filter((x) => targets.includes(x));
    if (t.length && !facts.test) facts.test = t.map((x) => `make ${x}`).join(" && ");
    if (targets.includes("build") && !facts.build) facts.build = "make build";
  }
  if (!facts.test) {
    if (existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "pytest.ini")) || existsSync(join(root, "setup.cfg"))) facts.test = "pytest";
    else if (existsSync(join(root, "go.mod"))) facts.test = "go vet ./... && go test ./...";
    else if (existsSync(join(root, "Cargo.toml"))) facts.test = "cargo test";
    else if (existsSync(join(root, "Gemfile"))) facts.test = "bundle exec rake test";
    else if (existsSync(join(root, "pubspec.yaml"))) facts.test = "dart analyze && dart test";
  }
  return facts;
}

/** The blanks a fact fills, per file; a template line is replaced only when the
 * repository answered it. */
function fill(to: string, text: string, facts: Facts): string {
  if (to === "AGENTS.md") {
    if (facts.test) text = text.replace("- Tests, linter, static analysis: <command>", `- Tests, linter, static analysis: ${facts.test}`).replace("- A task is done only when <command> passes.", `- A task is done only when ${facts.test} passes.`);
    if (facts.build) text = text.replace("- Build: <command>", `- Build: ${facts.build}`);
    if (facts.description) text = text.replace("<Two or three lines: what the system does, who uses it, what matters most.>", `${facts.description}\n<Add who uses it and what matters most.>`);
  }
  if (to === ".githooks/pre-commit" && facts.test) text = text.replace("<the command that runs this project's tests and linter>", facts.test);
  return text;
}

/** Copy the files that don't exist yet, filling the blanks the repository answers.
 * COPYFILE_EXCL makes "never overwrite" hold even if a file appears between the plan
 * and the write; the fill then edits only a file this call created. Returns the paths written. */
export function writeInit(root: string, plan: InitFile[], facts: Facts = detectFacts(root)): string[] {
  const written: string[] = [];
  for (const f of plan.filter((x) => !x.exists)) {
    const target = join(root, f.to);
    mkdirSync(dirname(target), { recursive: true });
    try {
      copyFileSync(f.from, target, 1 /* fs.constants.COPYFILE_EXCL */);
      written.push(f.to);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      continue;
    }
    const text = readFileSync(target, "utf8");
    const filled = fill(f.to, text, facts);
    if (filled !== text) writeFileSync(target, filled);
    // A hook must be executable to run; npm and copies don't always keep the bit.
    if (f.to.startsWith(".githooks/")) chmodSync(target, 0o755);
  }
  return written;
}

export const NEXT_STEPS = `Next:
  1. Fill every <...> left in the new files with this repository's facts, and delete
     what doesn't apply. Your AI agent can do most of it: say "fill the VibeQM
     templates from this repository". vibeqm-check doesn't count a file that still
     has blanks.
  2. Enable the blocking hook, once per clone:  git config core.hooksPath .githooks
  3. In .github/workflows/checks.yml, uncomment or write your build, tests and
     linter. Add your package managers to .github/dependabot.yml.
  4. Commit the files. Then run vibeqm-check again to see what is still open.`;
