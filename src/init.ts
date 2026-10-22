// `vibeqm-check init`: create the Level 2 template files in a repository. It
// lists what it will create, skips what exists, and writes only after the
// person says yes: never over a file, never a commit, never a hook.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
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

/** Copy the files that don't exist yet. COPYFILE_EXCL makes "never overwrite" hold even
 * if a file appears between the plan and the write. Returns the paths written. */
export function writeInit(root: string, plan: InitFile[]): string[] {
  const written: string[] = [];
  for (const f of plan.filter((x) => !x.exists)) {
    const target = join(root, f.to);
    mkdirSync(dirname(target), { recursive: true });
    try {
      copyFileSync(f.from, target, 1 /* fs.constants.COPYFILE_EXCL */);
      written.push(f.to);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  return written;
}

export const NEXT_STEPS = `Next:
  1. Fill every <...> in the new files with this repository's facts, and delete
     what doesn't apply. vibeqm-check doesn't count a file that still has them.
  2. In .github/workflows/checks.yml, uncomment or write your build, tests and
     linter. Add your package managers to .github/dependabot.yml.
  3. Commit the files, and make the checks required on your main branch.
  4. Run vibeqm-check again to see what is still open.`;
