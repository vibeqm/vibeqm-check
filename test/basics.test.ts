import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

process.env.VQM_OFFLINE = "1"; // the tests never ask a code host
import { agentPermissions, agentRulesFile } from "../src/checks/level2.js";
import { configurationBasics, devApartFromProd, diagrams, peerReview, placeholders, requirementsFirst, securityBeforePush, threeEnvironments, verificationTools } from "../src/checks/basics.js";

function repo(files: Record<string, string>, tag = false): string {
  const root = mkdtempSync(join(tmpdir(), "vqm-"));
  const g = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  g("init", "-q");
  g("config", "user.name", "Ada Person");
  g("config", "user.email", "ada@example.com");
  g("config", "commit.gpgsign", "false"); // a machine that signs every commit must not fail here
  for (const [f, c] of Object.entries({ "README.md": "x\n", ...files })) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), c);
  }
  g("add", "-A");
  g("commit", "-q", "-m", "first");
  if (tag) g("tag", "v1.0.0");
  return root;
}

test("security before push: secret scanning plus a review tool is met; one alone is not", () => {
  assert.equal(securityBeforePush(repo({})).status, "not-met");
  assert.equal(securityBeforePush(repo({ ".github/workflows/ci.yml": "steps:\n - uses: gitleaks/gitleaks-action\n" })).status, "not-met");
  assert.equal(securityBeforePush(repo({ ".github/workflows/ci.yml": "steps:\n - uses: gitleaks/gitleaks-action\n - uses: github/codeql-action/analyze\n" })).status, "met");
});

test("configuration basics: a manifest without a lockfile fails; with lockfile and tag passes", () => {
  assert.equal(configurationBasics(repo({ "package.json": "{}" }, true)).status, "not-met");
  assert.equal(configurationBasics(repo({ "package.json": "{}", "package-lock.json": "{}" }, true)).status, "met");
});

test("configuration basics: a committed private key is caught (planted fault)", () => {
  const r = configurationBasics(repo({ "key.txt": "-----BEGIN RSA " + "PRIVATE KEY-----\nabc\n"  /* split so the file itself holds no key */ }, true));
  assert.equal(r.status, "not-met");
  assert.match(r.evidence, /possible secrets committed in key\.txt/);
});

test("diagrams: a mermaid block counts", () => {
  assert.equal(diagrams(repo({})).status, "not-met");
  assert.equal(diagrams(repo({ "docs/flow.md": "```mermaid\ngraph TD; A-->B\n```\n" })).status, "met");
});

test("three environments: all three names needed", () => {
  assert.equal(threeEnvironments(repo({ ".github/workflows/deploy.yml": "environment: production\n" })).status, "not-met");
  // All three named: promotion and credentials kept from the agent need a person's proof.
  assert.equal(threeEnvironments(repo({ ".github/workflows/deploy.yml": "jobs:\n dev:\n  environment: development\n stage:\n  environment: staging\n prod:\n  environment: production\n" })).status, "not-visible");
});

test("security before push: checks a hook delegates to (make, a repo script) are seen", () => {
  const root = repo({
    ".githooks/pre-commit": "#!/bin/sh\nmake -C \"$root\" check\n",
    "Makefile": "check:\n\tgitleaks dir . --redact\n\tsemgrep scan --config p/python\n",
  });
  execFileSync("git", ["-C", root, "config", "core.hooksPath", ".githooks"]);
  assert.equal(securityBeforePush(root).status, "met");
});

test("security before push: ruff with the bandit rules counts as static security analysis", () => {
  const root = repo({
    ".githooks/pre-commit": "#!/bin/sh\nmake check\n",
    "Makefile": "check:\n\truff check .\n\tgitleaks dir .\n",
    "ruff.toml": "[lint]\nselect = [\"E\", \"F\", \"S\"]\n",
  });
  execFileSync("git", ["-C", root, "config", "core.hooksPath", ".githooks"]);
  assert.equal(securityBeforePush(root).status, "met");
  const noS = repo({ ".githooks/pre-commit": "make check\n", "Makefile": "check:\n\truff check .\n\tgitleaks dir .\n", "ruff.toml": "[lint]\nselect = [\"E\"]\n" });
  execFileSync("git", ["-C", noS, "config", "core.hooksPath", ".githooks"]);
  assert.equal(securityBeforePush(noS).status, "not-met");
});

test("verification: an .editorconfig is not a linter; a markdownlint config is", () => {
  assert.equal(verificationTools(repo({ ".editorconfig": "root = true\n" })).status, "not-met");
  assert.equal(verificationTools(repo({ ".markdownlint-cli2.jsonc": "{}\n" })).status, "met");
});

test("security before push: a tool named only in a comment does not count", () => {
  const ci = "steps:\n # TODO: add gitleaks\n - uses: github/codeql-action/analyze\n";
  assert.equal(securityBeforePush(repo({ ".github/workflows/ci.yml": ci })).status, "not-met");
});

test("verification: Dart's analyzer config, or an analyzer run in CI, counts", () => {
  assert.equal(verificationTools(repo({})).status, "not-met");
  // A formatter is not verification: Prettier alone never meets the gate.
  assert.equal(verificationTools(repo({ ".prettierrc": "{}\n" })).status, "not-met");
  assert.equal(verificationTools(repo({ "app/analysis_options.yaml": "analyzer:\n" })).status, "met");
  assert.equal(verificationTools(repo({ ".github/workflows/ci.yml": "steps:\n - run: cargo clippy -- -D warnings\n" })).status, "met");
  assert.equal(verificationTools(repo({ ".github/workflows/ci.yml": "steps:\n # run: cargo clippy\n" })).status, "not-met");
});

test("configuration basics: pubspec.yaml needs pubspec.lock", () => {
  assert.equal(configurationBasics(repo({ "pubspec.yaml": "name: a\n" }, true)).status, "not-met");
  assert.equal(configurationBasics(repo({ "pubspec.yaml": "name: a\n", "pubspec.lock": "x\n" }, true)).status, "met");
});

test("configuration basics: a test key the repository's gitleaks config lists as an exception is named and needs proof, not failed", () => {
  const key = "-----BEGIN RSA " + "PRIVATE KEY-----\nabc\n";
  const toml = "[allowlist]\ndescription = \"throwaway test keys\"\npaths = [\n  '''^test/fixtures/''',\n]\n";
  const r = configurationBasics(repo({ "test/fixtures/root.pem": key, ".gitleaks.toml": toml }, true));
  assert.equal(r.status, "not-visible");
  assert.match(r.evidence, /reviewed exceptions: test\/fixtures\/root\.pem/);
  const bare = configurationBasics(repo({ "test/fixtures/root.pem": key }, true));
  assert.equal(bare.status, "not-met");
  assert.match(bare.evidence, /all under test folders/);
});

function reviewedRepo(changes: { trailer?: string; record?: boolean }[]): string {
  const root = repo({});
  for (const [i, c] of changes.entries()) {
    writeFileSync(join(root, `f${i}.txt`), `${i}\n`);
    if (c.record) {
      mkdirSync(join(root, "reviews"), { recursive: true });
      writeFileSync(join(root, "reviews", `r${i}.md`), "Reviewer: GLM 5.3\nNo findings.\n");
    }
    execFileSync("git", ["-C", root, "add", "-A"]);
    execFileSync("git", ["-C", root, "commit", "-q", "-m", `change ${i}\n\n${c.trailer ?? ""}`]);
  }
  return root;
}

const AUTHOR = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
const GLM = { trailer: `Reviewed-by: GLM 5.3 (Zhipu AI)\n${AUTHOR}`, record: true };

test("peer review: a trailer without a review record does not count", () => {
  const r = peerReview(reviewedRepo([{ trailer: `Reviewed-by: GLM 5.3 (Zhipu AI)\n${AUTHOR}` }]));
  assert.equal(r.status, "not-visible");
  assert.match(r.evidence, /none has a matching review record/);
});

test("peer review: same-company models and unknown names that are not a person do not count", () => {
  for (const t of [`Reviewed-by: Claude Sonnet 5.5\n${AUTHOR}`, `Reviewed-by: GPT-5\n${AUTHOR}\nModel: gpt-5`, `Reviewed-by: SomeModel 2\n${AUTHOR}`]) {
    assert.match(peerReview(reviewedRepo([{ trailer: t, record: true }])).evidence, /none has a matching review record|no reviewed changes/);
  }
});

test("peer review: measured from adoption; needs 20 changes, then every one reviewed", () => {
  const few = peerReview(reviewedRepo([{}, GLM, GLM]));
  assert.equal(few.status, "not-visible");
  assert.match(few.evidence, /since review began \([0-9a-f]+, [0-9-]+\), 2 of 2 pushed commits were covered by a review; 20 changes since adoption are needed/);
  const enough = peerReview(reviewedRepo([{}, ...Array(20).fill({ trailer: "Reviewed-by: A. Person <a@example.com>", record: true })]));
  assert.equal(enough.status, "met");
  const gap = peerReview(reviewedRepo([GLM, {}, GLM]));
  assert.equal(gap.status, "not-met");
  assert.match(gap.evidence, /2 of 3 pushed commits were covered by a review; not reviewed: [0-9a-f]+/);
});

test("configuration basics: an allowlist outside test folders excuses nothing", () => {
  const key = "-----BEGIN RSA " + "PRIVATE KEY-----\nabc\n";
  const toml = "[allowlist]\npaths = [\n  '''.*''',\n]\n";
  assert.equal(configurationBasics(repo({ "config/prod.pem": key, ".gitleaks.toml": toml }, true)).status, "not-met");
});

test("peer review: a passing push-review record by another company counts on its own", () => {
  const root = reviewedRepo([{}, ...Array(21).fill({ trailer: AUTHOR })]);
  const [base, head] = [execFileSync("git", ["-C", root, "rev-parse", "HEAD~21"], { encoding: "utf8" }).trim(), execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()];
  const record = (verdict: string, model: string) =>
    `<!-- push review · ${base.slice(0, 10)}..${head.slice(0, 10)} -->\n<!-- model: ${model} · stage: push · 2026-10-11 16:39 -->\n\nNo findings.\n\nVERDICT: ${verdict}\n`;
  const add = (name: string, text: string) => {
    mkdirSync(join(root, "reviews", "push"), { recursive: true });
    writeFileSync(join(root, "reviews", "push", name), text);
    execFileSync("git", ["-C", root, "add", "-A"]);
    execFileSync("git", ["-C", root, "commit", "-q", "-m", "Push review recorded"]);
  };
  add("a.md", record("BLOCK", "deepseek-v4-pro:cloud"));
  assert.notEqual(peerReview(root).status, "met");
  add("b.md", record("PASS", "claude-sonnet-5-5"));
  assert.notEqual(peerReview(root).status, "met"); // same company as the author
  add("c.md", record("PASS", "deepseek-v4-pro:cloud"));
  const r = peerReview(root);
  assert.equal(r.status, "met");
  assert.match(r.evidence, /21 of 21 pushed commits were covered by a review/);
  // The review is due at the push. A new commit not pushed yet doesn't count
  // against the repository; once pushed without a review, it does.
  const remote = mkdtempSync(join(tmpdir(), "vqm-remote-"));
  execFileSync("git", ["-C", remote, "init", "-q", "--bare"]);
  execFileSync("git", ["-C", root, "remote", "add", "origin", remote]);
  execFileSync("git", ["-C", root, "push", "-q", "-u", "origin", "HEAD"], { stdio: "ignore" });
  writeFileSync(join(root, "new.txt"), "x\n");
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "work in progress"]);
  const local = peerReview(root);
  assert.equal(local.status, "met");
  assert.match(local.evidence, /1 not pushed yet, due at the next push/);
  execFileSync("git", ["-C", root, "push", "-q"], { stdio: "ignore" });
  assert.equal(peerReview(root).status, "not-met");
});

test("dev apart from prod: two named environments plus a confirmation rule; this machine's settings kept out", () => {
  process.env.HOME = mkdtempSync(join(tmpdir(), "vqm-home-")); // ignore the real ~/.claude/settings.json
  const rule = "- Never deploy or publish to production without the person's confirmation.\n";
  const envs = "Development runs on my laptop; production is the live site at https://example.com.\n";
  assert.equal(devApartFromProd(repo({})).status, "not-met");
  assert.equal(devApartFromProd(repo({ "CLAUDE.md": envs })).status, "not-met", "environments without the rule");
  assert.equal(devApartFromProd(repo({ "CLAUDE.md": rule })).status, "not-met", "the rule without environments");
  assert.equal(devApartFromProd(repo({ "CLAUDE.md": envs + rule })).status, "met");
  // Not live yet, said in so many words, with the rule ready.
  assert.equal(devApartFromProd(repo({ "CLAUDE.md": "Nothing is published yet.\n" + rule })).status, "met");
  // Config files show the environments; an ask rule in the project's settings is the rule.
  const settings = JSON.stringify({ permissions: { ask: ["Bash(firebase deploy*)"] } });
  assert.equal(devApartFromProd(repo({ ".firebaserc": JSON.stringify({ projects: { default: "app-dev", prod: "app-prod" } }), ".claude/settings.json": settings })).status, "met");
  assert.equal(devApartFromProd(repo({ "config/development.yaml": "a\n", "config/production.yaml": "b\n", "CLAUDE.md": rule })).status, "met");
  // A note counts by what it says, not by its name.
  assert.equal(devApartFromProd(repo({ "docs/DEV_AND_PRODUCTION.md": "\n", "CLAUDE.md": rule })).status, "not-met", "an empty note");
  assert.equal(devApartFromProd(repo({ "docs/ENVIRONMENTS.md": "Development: my laptop.\nProduction: the app store listing.\n", "CLAUDE.md": rule })).status, "met");
  // A note's name is not a pair of config files, and "never ... production" alone is not a publish rule.
  assert.equal(devApartFromProd(repo({ "docs/DEV_AND_PRODUCTION.md": "x\n", "CLAUDE.md": "never wire that flag into production\n" })).status, "not-met");
});

test("placeholders: a template's blanks are found; tags, links, code and comparisons are not", () => {
  assert.deepEqual(placeholders("- Build: <command>\n- High-risk areas: <login and permissions,\n  payments>.\n"), ["<command>", "<login and permissions, payments>"]);
  const real = [
    "Line one<br>two <br/> <br /> <hr /> <details><summary>More</summary></details>",
    "<blockquote>quoted</blockquote> <figure><figcaption>A</figcaption></figure> <samp>out</samp>",
    "See <https://vibeqm.com> or write to <ada@example.com>.",
    '<img src="logo.png"> <a href="x">link</a>',
    "Run `npm test -- <file>` before pushing.",
    "```\nlet x: Array<string> = f<T>(y);\n```",
    "<!-- fill in <command> later -->",
    "Keep it small: 0 < size and size > 0 both hold; Map<string, number> too.",
  ].join("\n");
  assert.deepEqual(placeholders(real), []);
});

test("requirements first: a requirements file still holding a template's blanks is not evidence", () => {
  const blank = "| REQ-001 | <What the system must do, in one sentence> | <A result someone can check> |\n";
  const filled = "| REQ-001 | Sign in with email | A wrong password is refused |\n";
  const issue = { ".github/ISSUE_TEMPLATE/change.md": "## Acceptance criteria\n- [ ] <A result someone can check>\n" };
  assert.equal(requirementsFirst(repo({ "VibeQM/requirements/REQUIREMENTS.md": blank })).status, "not-met");
  assert.match(requirementsFirst(repo({ "VibeQM/requirements/REQUIREMENTS.md": blank })).evidence, /still holds 2 template blanks/);
  assert.equal(requirementsFirst(repo({ "VibeQM/requirements/REQUIREMENTS.md": filled })).status, "met");
  // An issue template is meant to hold blanks, and counts alone...
  assert.equal(requirementsFirst(repo(issue)).status, "met");
  // ...but not beside a requirements file copied and left unfilled.
  assert.equal(requirementsFirst(repo({ ...issue, "VibeQM/requirements/REQUIREMENTS.md": blank })).status, "not-met");
});

test("dev apart from prod: a template's blank Environments section, or its 'nothing is live yet' option, names nothing", () => {
  process.env.HOME = mkdtempSync(join(tmpdir(), "vqm-home-"));
  const rule = "- Never deploy or publish to production without my confirmation.\n";
  const blank = "## Environments\n- Development: <where it runs>.\n- Production: <the live address, or \"nothing is live yet\">.\n" + rule;
  const r = devApartFromProd(repo({ "AGENTS.md": blank }));
  assert.equal(r.status, "not-met");
  assert.match(r.evidence, /"Environments" section still holds template blanks/);
  const filled = "## Environments\n- Development: this machine.\n- Production: https://example.com.\n" + rule;
  assert.equal(devApartFromProd(repo({ "AGENTS.md": filled })).status, "met");
  assert.equal(devApartFromProd(repo({ "AGENTS.md": "## Environments\n- Production: nothing is live yet.\n" + rule })).status, "met");
  // Two filled notes: the second is not reported as blank (it once threw).
  const note = "Development: my laptop.\nProduction: the live site.\n";
  assert.equal(devApartFromProd(repo({ "docs/ENVIRONMENTS.md": note, "ops/environments.md": note, "AGENTS.md": rule })).status, "met");
});

test("agent permissions: an unreadable settings file is not a limit", () => {
  process.env.HOME = mkdtempSync(join(tmpdir(), "vqm-home-"));
  const broken = agentPermissions(repo({ ".claude/settings.json": "{ not json" }));
  assert.equal(broken.status, "not-visible");
  assert.match(broken.evidence, /unreadable settings/);
  const denied = agentPermissions(repo({ ".claude/settings.json": JSON.stringify({ permissions: { deny: ["Bash(git push --force*)"] } }) }));
  assert.equal(denied.status, "met");
});

test("agent permissions and the publish rule: only settings committed to the repository count", () => {
  const home = mkdtempSync(join(tmpdir(), "vqm-home-"));
  process.env.HOME = home;
  const deny = JSON.stringify({ permissions: { deny: ["Bash(git push --force*)"], ask: ["Bash(npm publish*)"] } });
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), deny);
  // This machine's settings alone: real limits here, but clones and CI don't have them.
  const machine = agentPermissions(repo({}));
  assert.equal(machine.status, "not-visible");
  assert.match(machine.evidence, /not committed, so other clones and CI don't have them/);
  const envs = "## Environments\n- Development: this machine.\n- Production: https://example.com.\n";
  const dev = devApartFromProd(repo({ "AGENTS.md": envs }));
  assert.equal(dev.status, "not-met", "an ask rule on this machine only is not the repository's rule");
  assert.match(dev.evidence, /found only in .*which other clones and CI don't have/);
  // A project settings file that was never committed is this machine's too.
  const untracked = repo({});
  mkdirSync(join(untracked, ".claude"));
  writeFileSync(join(untracked, ".claude", "settings.json"), deny);
  assert.equal(agentPermissions(untracked).status, "not-visible");
  // Committed, it counts.
  assert.equal(agentPermissions(repo({ ".claude/settings.json": deny })).status, "met");
  assert.equal(devApartFromProd(repo({ "AGENTS.md": envs, ".claude/settings.json": deny })).status, "met");
});

test("agent rules file: a git-ignored or never-committed rules file does not count", () => {
  const ignored = agentRulesFile(repo({ ".gitignore": "CLAUDE.md\n", "CLAUDE.md": "# Rules\nRun the tests before every commit.\n" }));
  assert.equal(ignored.status, "not-met");
  assert.match(ignored.evidence, /not committed/);
  const untracked = repo({});
  writeFileSync(join(untracked, "AGENTS.md"), "# Rules\nRun the tests before every commit.\n");
  assert.equal(agentRulesFile(untracked).status, "not-met", "never committed, though not ignored");
  assert.equal(agentRulesFile(repo({ "CLAUDE.md": "# Rules\nRun the tests before every commit.\n" })).status, "met");
});

test("configuration basics: the tool's own source does not read as a secret", () => {
  const src = readFileSync(new URL("../../src/checks/basics.ts", import.meta.url), "utf8");
  const r = configurationBasics(repo({ "package.json": "{}\n", "package-lock.json": "{}\n", "src/basics.ts": src }, true));
  assert.doesNotMatch(r.evidence, /secret/i);
});
