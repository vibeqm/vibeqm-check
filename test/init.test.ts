import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.VQM_OFFLINE = "1"; // the tests never ask a code host
import { requirementsFirst } from "../src/checks/basics.js";
import { agentRulesFile } from "../src/checks/level2.js";
import { planInit, TEMPLATES, writeInit } from "../src/init.js";

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const init = (args: string[]) => spawnSync(process.execPath, [CLI, "init", ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const empty = () => mkdtempSync(join(tmpdir(), "vqm-init-"));

test("init: the bundle holds the Level 2 templates, with .gitignore under its real name", () => {
  const to = planInit(empty()).map((f) => f.to);
  for (const f of ["AGENTS.md", ".claude/settings.json", ".github/workflows/checks.yml", ".gitignore", "VibeQM/requirements/REQUIREMENTS.md", "vqm-proof.json"]) {
    assert.ok(to.includes(f), `${f} is in the bundle (${TEMPLATES})`);
  }
  assert.ok(!to.includes("gitignore"));
});

test("init: writes only missing files and never overwrites one", () => {
  const root = empty();
  writeFileSync(join(root, "AGENTS.md"), "# Our own rules\n");
  const plan = planInit(root);
  assert.equal(plan.find((f) => f.to === "AGENTS.md")?.exists, true);
  const written = writeInit(root, plan);
  assert.ok(!written.includes("AGENTS.md"));
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), "# Our own rules\n");
  assert.ok(existsSync(join(root, ".claude", "settings.json")));
  // A file that appears after the plan was made is still not overwritten.
  const late = empty();
  const plan2 = planInit(late);
  writeFileSync(join(late, "vqm-proof.json"), "mine\n");
  assert.ok(!writeInit(late, plan2).includes("vqm-proof.json"));
  assert.equal(readFileSync(join(late, "vqm-proof.json"), "utf8"), "mine\n");
});

test("init (CLI): outside a terminal it writes nothing without --yes; with --yes it writes, and a second run has nothing to do", () => {
  const root = empty();
  const no = init([root]);
  assert.equal(no.status, 2);
  assert.match(no.stderr, /nothing was written\. Pass --yes/);
  assert.deepEqual(readdirSync(root), []);
  const yes = init([root, "--yes"]);
  assert.equal(yes.status, 0, yes.stderr);
  assert.match(yes.stdout, /Created \d+ files\. Nothing was committed\./);
  assert.ok(existsSync(join(root, "AGENTS.md")));
  const again = init([root, "--yes"]);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /Nothing to create\./);
  assert.equal(init([root, "--force"]).status, 2, "an unknown option is refused, not ignored");
  const file = join(root, "AGENTS.md");
  const notDir = init([file, "--yes"]);
  assert.equal(notDir.status, 2, "a file is not a repository");
  assert.match(notDir.stderr, /is not a folder/);
});

test("init: the files it writes still hold their blanks, so they don't pass the checks until filled", () => {
  const root = empty();
  const g = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  g("init", "-q");
  g("config", "user.name", "Ada Person");
  g("config", "user.email", "ada@example.com");
  g("config", "commit.gpgsign", "false");
  writeInit(root, planInit(root));
  g("add", "-A");
  g("commit", "-q", "-m", "templates");
  assert.equal(agentRulesFile(root).status, "not-met");
  assert.equal(requirementsFirst(root).status, "not-met");
});

test("requirements first: a VibeQM template set (templates/level-N/) is not the project's records; other templates/ folders still count", () => {
  const root = empty();
  const g = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  g("init", "-q");
  g("config", "user.name", "Ada Person");
  g("config", "user.email", "ada@example.com");
  g("config", "commit.gpgsign", "false");
  mkdirSync(join(root, "templates", "level-2", "VibeQM", "requirements"), { recursive: true });
  writeFileSync(join(root, "templates", "level-2", "VibeQM", "requirements", "REQUIREMENTS.md"), "| REQ-001 | <What> |\n");
  g("add", "-A");
  g("commit", "-q", "-m", "templates");
  assert.equal(requirementsFirst(root).status, "not-visible", "no requirements of its own, and the template is not counted either way");
  mkdirSync(join(root, "templates", "requirements"), { recursive: true });
  writeFileSync(join(root, "templates", "requirements", "orders.md"), "| REQ-001 | Orders are saved | A saved order reloads |\n");
  g("add", "-A");
  g("commit", "-q", "-m", "real requirements under templates/");
  assert.equal(requirementsFirst(root).status, "met");
});
