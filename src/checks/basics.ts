// VibeQM v0.4 basics (VQM_SPEC §6): the industry practices added to Levels 2
// and 3. What a script can see in a repository is checked; the rest is "not-visible"
// and needs proof (ASSESSOR rule 6).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { git } from "../git.js";
import { hostTags, type MergedPr, mergedPullRequests } from "../host.js";
import type { CheckResult } from "../types.js";

/** The rules files coding agents read, at the repository root. */
export const RULES_FILES = ["AGENTS.md", "CLAUDE.md", ".cursorrules", ".github/copilot-instructions.md", "GEMINI.md", ".windsurfrules"];

const r = (level: number, gate: string, status: CheckResult["status"], evidence: string): CheckResult => ({ level, gate, status, evidence });

/** Every tracked file path (relative), from git; empty if not a repository. */
function tracked(root: string): string[] {
  return (git(root, ["ls-files"]) ?? "").split("\n").filter(Boolean);
}

function read(root: string, f: string): string {
  try {
    const p = join(root, f);
    return statSync(p).size < 2_000_000 ? readFileSync(p, "utf8") : "";
  } catch {
    return "";
  }
}

const ciText = (root: string, files: string[]) =>
  files.filter((f) => /^\.github\/workflows\/.*\.ya?ml$|^\.gitlab-ci\.yml$|^\.circleci\/|^azure-pipelines\.yml$|^Jenkinsfile$/.test(f)).map((f) => read(root, f)).join("\n");

export function hookText(root: string): string {
  const configured = git(root, ["config", "core.hooksPath"])?.trim();
  const gitDir = git(root, ["rev-parse", "--absolute-git-dir"])?.trim();
  const dir = configured ? (configured.startsWith("/") ? configured : join(root, configured)) : gitDir ? join(gitDir, "hooks") : null;
  if (!dir || !existsSync(dir)) return "";
  const hooks = readdirSync(dir).filter((n) => !n.endsWith(".sample")).map((n) => read(dir, n)).join("\n");
  return hooks + "\n" + delegated(root, hooks);
}

/** What a hook delegates to: the repository's Makefile when it calls make, and
 * repository scripts it names as "$root/<path>" (one level further through
 * "$(dirname "$0")/<file>"). Hooks often run `make check` or a book-local script,
 * and the checks live there, not in the hook file. */
export function delegated(root: string, hooks: string): string {
  const parts: string[] = [];
  if (/\bmake\b/.test(hooks)) parts.push(read(root, "Makefile"));
  for (const m of hooks.matchAll(/"?\$root"?\/([\w./-]+)/g)) {
    const rel = m[1];
    const text = read(root, rel);
    parts.push(text);
    for (const n of text.matchAll(/\$\(dirname "\$0"\)\/([\w.-]+)/g)) parts.push(read(root, join(dirname(rel), n[1])));
  }
  return parts.join("\n");
}

/** Text without comment lines, trailing " # …" comments and echo/printf lines, so a
 * note such as "# TODO: add gitleaks" or `echo "run pytest"` is not read as a run. */
export function code(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*(#|\/\/|rem\b|(@?echo|printf)\b)/i.test(l))
    .map((l) => l.replace(/\s#\s.*$/, ""))
    .join("\n");
}

// HTML tags a Markdown file may really use: "<details>" is a tag, "<command>" a blank.
const HTML_TAGS = new Set(
  "a abbr article aside audio b blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i iframe img input ins kbd label li main mark nav ol p picture pre q s samp section small source span strong sub summary sup table tbody td textarea tfoot th thead tr u ul var video wbr".split(" "),
);

/** Template blanks left in a document, such as "<command>" or "<Two or three lines:
 * what the system does>". Code (fenced blocks, inline spans) and HTML comments are left
 * out, and so are tags, links, email addresses, comparisons and generics such as
 * Array<string>. A copied template that still holds its blanks is not evidence. */
export function placeholders(text: string): string[] {
  const prose = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^(```|~~~)[\s\S]*?^\1/gm, " ")
    .replace(/`[^`\n]*`/g, " ");
  const found: string[] = [];
  for (const m of prose.matchAll(/(?<![\w<])<([^\s<>](?:[^<>]{0,400}?[^\s<>])?)>/g)) {
    const inner = m[1].replace(/\/$/, "").trim(); // "<br />" is a tag too
    if (/^[/!?]/.test(inner) || inner.includes("=") || /^(https?|mailto|ftp):/i.test(inner) || /^[^\s@]+@[^\s@]+$/.test(inner)) continue;
    if (HTML_TAGS.has(inner.toLowerCase())) continue;
    found.push(m[0].replace(/\s+/g, " "));
  }
  return found;
}

/** "AGENTS.md still holds 12 template blanks (e.g. "<command>")". */
export function blanksNote(file: string, blanks: string[]): string {
  return `${file} still holds ${blanks.length} template blank${blanks.length === 1 ? "" : "s"} (e.g. "${blanks[0].slice(0, 60)}")`;
}

/** Commands that run a test suite, linter or analyzer, as they appear in a hook,
 * a Makefile or CI: "Checks before merge" requires the hook to run one. */
export const CHECK_COMMANDS =
  /\b(make\s+(check|test|lint|verify|ci)|(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|check|typecheck)|npx\s+(eslint|biome|tsc|vitest|jest)|pytest|tox|nox|ruff\s+check|mypy|pyright|flake8|pylint|cargo\s+(test|clippy|check)|go\s+(test|vet)|golangci-lint|dart\s+(analyze|test)|flutter\s+(analyze|test)|swift\s+test|swiftlint|xcodebuild\s+test|gradlew?\s+\S*(test|check|lint|detekt)|mvnw?\s+\S*(test|verify)|dotnet\s+(test|build)|phpunit|phpstan|psalm|rspec|rubocop|rake\s+test|mix\s+(test|credo)|tsc\b|eslint|biome\s+(lint|check|ci)|markdownlint|shellcheck|sqlfluff)/;

/** Analyzer commands only (a test runner is not a linter): for "Verification on every
 * change", one run from a hook (or what it delegates to) or CI counts like its config. */
const ANALYZE_COMMANDS =
  /\b(ruff\s+check|mypy|pyright|flake8|pylint|cargo\s+clippy|go\s+vet|golangci-lint|dart\s+analyze|flutter\s+analyze|swiftlint|detekt|ktlint|phpstan|psalm|rubocop|mix\s+credo|tsc\s+--noEmit|eslint|biome\s+(lint|check|ci)|npm\s+run\s+lint|shellcheck|sqlfluff\s+lint|clang-tidy|dotnet\s+format\s+--verify-no-changes)\b/;

/** Ruff configured with the bandit rule set ("S") is static security analysis. */
function ruffSecurity(root: string, files: string[]): boolean {
  const cfg = ["ruff.toml", ".ruff.toml", "pyproject.toml"].filter((f) => files.includes(f)).map((f) => read(root, f)).join("\n");
  return /select\s*=\s*\[[^\]]*"S"/.test(cfg);
}

// ---------------- Level 2 ----------------

export function requirementsFirst(root: string): CheckResult {
  const files = tracked(root);
  // A VibeQM template set (templates/level-N/) is handed out, not this project's records.
  const all = files.filter((f) => /^\.github\/ISSUE_TEMPLATE\/|^VibeQM\/requirements\/|(^|\/)REQUIREMENTS\.md$|(^|\/)requirements\/.*\.md$/i.test(f) && !/(^|\/)templates\/level-\d\//.test(f));
  // An issue template is meant to hold blanks; a requirements document still holding
  // a template's blanks says nothing yet.
  const unfilled = all.filter((f) => !f.startsWith(".github/ISSUE_TEMPLATE/") && placeholders(read(root, f)).length);
  const found = all.filter((f) => !unfilled.includes(f));
  const gate = "Requirements first";
  const note = unfilled.length ? `${blanksNote(unfilled[0], placeholders(read(root, unfilled[0])))}${unfilled.length > 1 ? `, and ${unfilled.length - 1} more file(s) do too` : ""}` : "";
  // An issue template beside an unfilled requirements file is a template set copied
  // and not filled in yet: it doesn't carry the gate alone.
  const filledDocs = found.filter((f) => !f.startsWith(".github/ISSUE_TEMPLATE/"));
  if (found.length && (filledDocs.length || !unfilled.length)) return r(2, gate, "met", `requirements or issue templates in the repository: ${found.slice(0, 3).join(", ")}${found.length > 3 ? "…" : ""}${note ? `; ${note}` : ""}. Whether each change traces to one is a judgment question of the full assessment`);
  if (unfilled.length) return r(2, gate, "not-met", `${note}: fill it with this project's requirements, or delete it`);
  return r(2, gate, "not-visible", "no requirements file or issue templates in the repository; if requirements live in an issue tracker, attach proof that every change traces to one and that unclear requests get clarifying questions with options");
}

// The company behind a model named in a trailer, to tell an AI peer review from a
// model reviewing its own company's work (VQM_SPEC §4 rule 3).
const VENDORS: [RegExp, string][] = [
  [/claude|anthropic/i, "Anthropic"],
  [/gpt|openai|codex|\bo[134]\b/i, "OpenAI"],
  [/gemini|gemma|google/i, "Google"],
  [/glm|zhipu|z\.ai/i, "Zhipu"],
  [/deepseek/i, "DeepSeek"],
  [/grok|xai/i, "xAI"],
  [/llama|\bmeta\b/i, "Meta"],
  [/mistral|codestral/i, "Mistral"],
  [/qwen|alibaba/i, "Alibaba"],
  [/kimi|moonshot/i, "Moonshot"],
  [/\bphi-?\d|microsoft/i, "Microsoft"],
];
const vendorOf = (s: string) => VENDORS.find(([re]) => re.test(s))?.[1];
const REVIEW_PATH = /(^|\/)reviews?\/.+\.(md|txt)$/i;
const MIN_SINCE = 20; // changes after adoption before review coverage counts

/** Peer review on every change. A change counts as reviewed when it carries a
 * `Reviewed-by:` trailer naming a person ("Name <email>") or a model from a company that
 * did not write it, AND a review record exists: a review file added in the same commit,
 * or a tracked review file naming the commit or a range that holds it. A merged pull
 * request with an independent review on the host also counts, and so does a push-review
 * record with a passing verdict by a model from another company. Review is measured from the
 * first reviewed change in the sample (adoption), once 20 changes have followed it;
 * commits that only add review records need no review of their own. */
export function peerReview(root: string): CheckResult {
  const gate = "Peer review on every change";
  const log = git(root, ["log", "-100", "--no-merges", "--name-only", "--format=%x1e%H%x1f%h%x1f%cs%x1f%(trailers:key=Reviewed-by,valueonly,separator=%x1d)%x1f%(trailers:key=Co-Authored-By,key=Model,key=Claude-Session,valueonly,separator=%x1d)%x1f"]) ?? "";
  const files = tracked(root);
  // A push review writes its record after the commits it covers, so the newest record is
  // often not committed yet: untracked review files are read too.
  const untracked = (git(root, ["ls-files", "--others", "--exclude-standard"]) ?? "").split("\n").filter(Boolean);
  const reviewFiles = [...files, ...untracked].filter((f) => REVIEW_PATH.test(f));
  const named = new Set<string>();
  const inRange = new Set<string>();
  // Push-review records: a hook reviews the outgoing range and writes the
  // record, so a passing one counts without a trailer; hash → reviewing company.
  const pushPassed = new Map<string, string>();
  for (const f of reviewFiles) {
    const text = read(root, f);
    const push = text.match(/push review · ([0-9a-f]{7,40})\.\.([0-9a-f]{7,40})/);
    const model = text.match(/model: ([^·\n]+)/)?.[1] ?? "";
    if (push && vendorOf(model) && /VERDICT:\s*PASS\s*$/.test(text.trimEnd())) {
      for (const h of (git(root, ["rev-list", `${push[1]}..${push[2]}`]) ?? "").split("\n").filter(Boolean)) pushPassed.set(h, vendorOf(model) as string);
    }
    for (const m of text.matchAll(/\b([0-9a-f]{7,40})\.\.\.?([0-9a-f]{7,40})\b/g)) {
      for (const h of (git(root, ["rev-list", `${m[1]}..${m[2]}`]) ?? "").split("\n").filter(Boolean)) inRange.add(h);
    }
    for (const m of `${f} ${text}`.matchAll(/\b(?=[0-9]*[a-f])[0-9a-f]{7,40}\b/g)) named.add(m[0]);
  }
  // A pull request review counts when someone other than its author approved it or
  // asked for changes; a comment, or the author reviewing their own pull request, does not.
  const independent = (p: MergedPr) =>
    p.reviews.some((v) => ["APPROVED", "CHANGES_REQUESTED"].includes(v.state) && v.author?.login && v.author.login !== p.author?.login);
  const prReviewed = new Set((mergedPullRequests(root) ?? []).filter(independent).flatMap((p) => p.commits.map((c) => c.oid)));
  const commits = log
    .split("\x1e")
    .filter((c) => c.trim())
    .map((c) => {
      const [hash, short, date, reviewers, authors, rest] = c.split("\x1f");
      const changed = (rest ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
      const by = new Set((authors ?? "").split("\x1d").map(vendorOf).filter(Boolean));
      const trailer = (reviewers ?? "")
        .split("\x1d")
        .map((x) => x.trim())
        .filter(Boolean)
        .some((rev) => {
          const v = vendorOf(rev);
          // A person is written "Name <email>"; anything else must be a model from a
          // company the tool knows and that did not write the change (fails closed).
          return v ? !by.has(v) : /<[^<>@\s]+@[^<>\s]+>/.test(rev);
        });
      const record = changed.some((f) => REVIEW_PATH.test(f) && read(root, f).trim().length > 0) || inRange.has(hash) || [...named].some((t) => hash.startsWith(t));
      const pushBy = pushPassed.get(hash);
      const reviewed = (trailer && record) || prReviewed.has(hash) || (pushBy !== undefined && !by.has(pushBy));
      const recordsOnly = changed.length > 0 && changed.every((f) => REVIEW_PATH.test(f));
      return { hash, short, date, trailer, record, reviewed, recordsOnly };
    });
  // The review is due when commits leave the machine, at a push or a pull request:
  // commits not pushed yet are not counted against the repository.
  const unpushed = new Set((git(root, ["rev-list", "@{u}..HEAD"]) ?? "").split("\n").filter(Boolean));
  const due = (c: { hash: string }) => !unpushed.has(c.hash);
  const need = "pull request reviews on a host this tool can't read need proof that every sampled change had a human peer review or an AI peer review by a model from a different company";
  if (!commits.length) return r(2, gate, "not-visible", need);
  const firstAt = commits.map((c) => c.reviewed && !c.recordsOnly).lastIndexOf(true);
  if (firstAt < 0) {
    const trailers = commits.filter((c) => c.trailer).length;
    return r(2, gate, "not-visible", `${trailers ? `${trailers} of the last ${commits.length} commits carry a \`Reviewed-by:\` trailer, but none has a matching review record (a review file in the commit, or one naming it)` : `no reviewed changes found in the last ${commits.length} commits (a \`Reviewed-by:\` trailer plus a review record, or a reviewed pull request)`}; ${need}`);
  }
  // One unreviewed pushed change after adoption restarts the count at the next
  // reviewed change (DEC-148): the gate names the change that broke the run, and the
  // person recovers by reviewing from then on, instead of waiting for the sample to forget.
  const window = commits.slice(0, firstAt + 1);
  const brokeAt = window.findIndex((c) => !c.recordsOnly && due(c) && !c.reviewed);
  let startAt = firstAt;
  let restart = "";
  if (brokeAt >= 0) {
    const broke = window[brokeAt];
    const resumed = window.slice(0, brokeAt).map((c) => c.reviewed && !c.recordsOnly).lastIndexOf(true);
    const note = `${broke.short} (${broke.date}${broke.trailer ? ", trailer but no review record" : ""})`;
    if (resumed < 0) return r(2, gate, "not-met", `review began at ${commits[firstAt].short} (${commits[firstAt].date}), but the latest pushed change was not reviewed: ${note}; the count restarts at the next reviewed change`);
    startAt = resumed;
    restart = ` (restarted at ${window[resumed].short} after the unreviewed change ${note})`;
  }
  const first = commits[startAt];
  const since = commits.slice(0, startAt + 1).filter((c) => !c.recordsOnly && due(c));
  const waiting = commits.slice(0, startAt + 1).filter((c) => !c.recordsOnly && !due(c) && !c.reviewed).length;
  const head = `since review began (${first.short}, ${first.date})${restart}, ${since.length} of ${since.length} pushed changes were covered by a review${waiting ? ` (${waiting} not pushed yet, due at the next push)` : ""}`;
  if (since.length < MIN_SINCE) {
    // Review is set up and every pushed change since has one: the gate is in place
    // and counts once 20 reviewed changes have followed adoption (ASSESSOR §2, DEC-087).
    return {
      ...r(2, gate, "in-place", `${head}; counts after ${MIN_SINCE} reviewed changes since adoption, ${since.length} so far; one unreviewed push restarts the count (earlier history needs proof)`),
      progress: { done: since.length, needed: MIN_SINCE, unit: "reviewed changes" },
    };
  }
  return r(2, gate, "met", `${head} (a push review, a reviewed pull request, or a trailer with a review record); earlier history is not claimed`);
}

export function verificationTools(root: string): CheckResult {
  const files = tracked(root);
  const lint = files.filter((f) =>
    /(^|\/)(\.eslintrc[^/]*|eslint\.config\.[cm]?[jt]s|biome\.jsonc?|ruff\.toml|\.ruff\.toml|\.flake8|\.pylintrc|mypy\.ini|\.mypy\.ini|\.golangci\.ya?ml|\.rubocop\.yml|\.swiftlint\.yml|checkstyle\.xml|\.clang-tidy|\.markdownlint(-cli2)?\.(jsonc?|ya?ml|cjs|mjs)|\.markdownlintrc|analysis_options\.yaml|detekt(-config)?\.ya?ml|\.?clippy\.toml|phpstan\.neon(\.dist)?|psalm\.xml|\.credo\.exs|\.sqlfluff)$/.test(f),
  );
  const pyproject = files.includes("pyproject.toml") && /\[tool\.(ruff|pylint|mypy|black)\]/.test(read(root, "pyproject.toml"));
  const pkg = files.includes("package.json") && /"(lint|typecheck)"\s*:/.test(read(root, "package.json"));
  const cargo = files.filter((f) => /(^|\/)Cargo\.toml$/.test(f)).some((f) => /^\[(workspace\.)?lints/m.test(read(root, f)));
  const tsStrict = files.filter((f) => /(^|\/)tsconfig[^/]*\.json$/.test(f)).some((f) => /"strict"\s*:\s*true/.test(read(root, f)));
  const wired = code(ciText(root, files) + "\n" + hookText(root));
  const run = wired.match(ANALYZE_COMMANDS)?.[0];
  // The gate is that the checks run on every change: a hook or CI job must run the
  // analyzer, or at least the project's test or lint command, beside the configuration.
  const runs = wired.match(CHECK_COMMANDS)?.[0];
  const gate = "Verification on every change";
  const ev = [
    ...lint.slice(0, 3),
    ...(pyproject ? ["pyproject.toml lint/type config"] : []),
    ...(pkg ? ["package.json lint script"] : []),
    ...(cargo ? ["Cargo.toml [lints]"] : []),
    ...(tsStrict ? ["tsconfig strict mode"] : []),
    ...(run ? [`\`${run.trim()}\` runs in a hook or CI`] : []),
  ];
  if (ev.length && (run || runs)) return r(2, gate, "met", `linter or static-analysis configuration: ${ev.join(", ")}; a hook or CI job runs \`${(run ?? runs ?? "").trim()}\` (that a failure blocks the change is the "Checks before merge" gate)`);
  if (ev.length) return r(2, gate, "not-met", `linter or static-analysis configuration: ${ev.join(", ")}, but no enabled hook or CI job runs it or the tests: add the command to .githooks/pre-commit (enabled with \`git config core.hooksPath .githooks\`) or to the CI workflow`);
  return r(
    2,
    gate,
    "not-met",
    "no linter or static-analysis configuration found, and no analyzer command in a hook or CI. If the project uses an analyzer this tool does not recognise, run it from the pre-commit hook or CI (e.g. `dart analyze`, `cargo clippy`, `tsc --noEmit`) and it will be found",
  );
}

export function securityBeforePush(root: string): CheckResult {
  const files = tracked(root);
  const text = code(ciText(root, files) + "\n" + hookText(root) + "\n" + files.filter((f) => /pre-commit-config\.ya?ml$/.test(f)).map((f) => read(root, f)).join("\n"));
  const tools = ["security-review", "gitleaks", "trufflehog", "detect-secrets", "git-secrets", "codeql", "semgrep", "snyk", "bandit", "osv-scanner", "npm audit", "pip-audit", "trivy", "dependency-review"].filter((tool) => text.toLowerCase().includes(tool));
  if (/\bruff\b/.test(text) && ruffSecurity(root, files)) tools.push("ruff security rules (bandit)");
  const dependabot = files.some((f) => /^\.github\/dependabot\.ya?ml$/.test(f));
  const gate = "Security review before push";
  if (!tools.length && !dependabot) return r(2, gate, "not-met", "no security review, secret scanning or dependency scanning found in hooks, pre-commit config or CI");
  const hasSecrets = tools.some((x) => ["gitleaks", "trufflehog", "detect-secrets", "git-secrets"].includes(x));
  const hasReview = ["security-review", "codeql", "semgrep", "snyk", "bandit", "ruff security rules (bandit)"].some((x) => tools.includes(x));
  // Semgrep's rules are thin for some languages; say so when it is the only review.
  const thin = [".dart", ".ex", ".exs", ".clj", ".hs", ".zig", ".nim"];
  const code_ = files.filter((f) => /\.[a-z]+$/.test(f) && !/\.(md|json|ya?ml|txt|lock|toml)$/.test(f));
  const thinShare = code_.length ? code_.filter((f) => thin.some((e) => f.endsWith(e))).length / code_.length : 0;
  const reviewTools = ["security-review", "codeql", "semgrep", "snyk", "bandit", "ruff security rules (bandit)"].filter((x) => tools.includes(x));
  const note = reviewTools.length === 1 && reviewTools[0] === "semgrep" && thinShare > 0.3 ? " (note: Semgrep's rules barely cover this repository's main language; an AI security review of each push covers it better)" : "";
  const secretTools = tools.filter((x) => ["gitleaks", "trufflehog", "detect-secrets", "git-secrets"].includes(x));
  const depTools = [...tools.filter((x) => ["osv-scanner", "npm audit", "pip-audit", "trivy", "dependency-review", "snyk"].includes(x)), ...(dependabot ? ["dependabot"] : [])];
  const ev = [
    `secret scanning: ${secretTools.join(", ") || "none"}`,
    `security review of each change (an AI review or static security analysis): ${reviewTools.join(", ") || "none"}${note}`,
    `dependency scan: ${depTools.join(", ") || "none"}${depTools.length ? " (whether it blocks on critical findings is a CI or host setting, not checked)" : ""}`,
  ].join("; ");
  if (hasSecrets && hasReview) return r(2, gate, "met", ev);
  return r(2, gate, "not-met", `${ev}; missing ${[!hasReview ? "an AI or static security review of each change" : "", !hasSecrets ? "secret scanning" : ""].filter(Boolean).join(" and ")}`);
}

// Development apart from production at Level 2: the repository names a
// development and a production environment, and the agent publishes live only after the
// person confirms. Credentials kept from the agent and pipeline-only deploys are Level 3.
const PUBLISH = /\b(deploy\w*|publish\w*|releas\w*|go(es|ing)? live|push\w* to production)\b/i;
const CONFIRM = /\b(confirm\w*|approv\w*|ask(s|ing)? (me|the (person|developer|owner|user|author))|permission|sign[- ]off)\b/i;
const FORBID = /\b(never|do not|don't|must not)\W+(\w+\W+){0,3}(deploy|publish|release|go live|push to production)/i;
const DEPLOY_COMMAND = /deploy|publish|release|wrangler|vercel|netlify|firebase|flyctl|\bfly\b|heroku|kubectl|terraform apply|helm|eas (submit|update|build)|fastlane|gcloud|\baws\b|supabase|railway|render|\bgh release\b|docker push|twine|serverless|\bsls\b|amplify|surge/i;
const NOT_LIVE = /\b(not (yet )?(published|deployed|live|released)|nothing is (yet )?(published|deployed|live)|no production (environment )?yet)\b/i;

/** Where the repository names its environments: a note, or config files that show them. */
function environmentsShown(root: string, files: string[], unfilled: string[] = []): string[] {
  const shown: string[] = [];
  // A note by its name counts only when its text names both environments, and a
  // template's blanks don't name anything.
  const notes = files.filter(
    (f) =>
      /(^|\/)[^/]*(environments?|dev[_ -]?(and|&|vs)[_ -]?prod(uction)?)[^/]*\.(md|txt)$/i.test(f) &&
      /\b(dev|development)\b/i.test(read(root, f)) &&
      /\b(prod|production|live)\b/i.test(read(root, f)),
  );
  const note = notes.find((f) => !placeholders(read(root, f)).length);
  for (const f of notes.filter((f) => f !== note)) {
    const blanks = placeholders(read(root, f)); // a second filled note has none
    if (blanks.length) unfilled.push(blanksNote(f, blanks));
  }
  if (note) shown.push(`a note: ${note}`);
  const docs = [...RULES_FILES, "README.md"].filter((f) => files.includes(f) || existsSync(join(root, f)));
  for (const f of docs) {
    const lines = read(root, f).split("\n");
    let heading = lines.find((l) => /^#+\s.*\b(environments?|development and production|dev(elopment)? (and|vs\.?|\/) prod(uction)?)\b/i.test(l));
    // The section under the heading must be filled in: a template's "Environments"
    // heading over its blanks names nothing.
    if (heading) {
      const at = lines.indexOf(heading);
      const depth = heading.match(/^#+/)?.[0].length ?? 1;
      const end = lines.findIndex((l, i) => i > at && (l.match(/^(#+)\s/)?.[1].length ?? 99) <= depth);
      const blanks = placeholders(lines.slice(at + 1, end < 0 ? undefined : end).join("\n"));
      if (blanks.length) {
        unfilled.push(`${f}'s "${heading.replace(/^#+\s*/, "").trim().slice(0, 40)}" section still holds template blanks (e.g. "${blanks[0].slice(0, 60)}")`);
        heading = undefined;
      }
    }
    // Or one line naming both and where they are: "development runs on my laptop;
    // production is the live site".
    const both = lines.find(
      (l) =>
        /\b(dev|development)\b/i.test(l) &&
        /\b(prod|production|live)\b/i.test(l) &&
        /\b(environment|server|site|project|database|account|laptop|machine|local|https?:)/i.test(l) &&
        !placeholders(l).length,
    );
    if (heading) shown.push(`${f}: "${heading.replace(/^#+\s*/, "").trim().slice(0, 60)}"`);
    else if (both) shown.push(`${f}: "${both.trim().slice(0, 80)}"`);
  }
  // Config files: a dev/prod pair of files (.env.development and .env.production,
  // main_dev.dart and main_prod.dart, config/dev.json and config/prod.json), or one file
  // that defines both (Firebase aliases, wrangler environments). .env files are often
  // untracked, so their names are looked for on disk; they are never read.
  const names = [...files, ...[".env.development", ".env.dev", ".env.production", ".env.prod"].filter((f) => existsSync(join(root, f)))];
  const tok = (re: string) => new RegExp(`(^|[/._-])(${re})([/._-]|$)`, "i");
  const config = names.filter((f) => !/\.(md|txt|rst|adoc)$|node_modules\//i.test(f));
  const isDev = (f: string) => tok("dev|development").test(f) && !tok("prod|production").test(f);
  const isProd = (f: string) => tok("prod|production").test(f) && !tok("dev|development").test(f);
  const dev = config.find(isDev);
  const prod = config.find((f) => isProd(f) && dirname(f) === dirname(dev ?? "")) ?? config.find(isProd);
  if (dev && prod) shown.push(`config files: ${dev} and ${prod}`);
  const firebaserc = files.includes(".firebaserc") ? read(root, ".firebaserc") : "";
  try {
    const projects = Object.keys(JSON.parse(firebaserc || "{}").projects ?? {});
    if (projects.length >= 2) shown.push(`.firebaserc: projects ${projects.join(", ")}`);
  } catch {
    /* not JSON: ignore */
  }
  for (const w of files.filter((f) => /(^|\/)wrangler\.(toml|jsonc?)$/.test(f))) {
    if (/\[env\.\w+\]|"env"\s*:/.test(read(root, w))) shown.push(`${w}: named environments`);
  }
  return shown;
}

/** Claude Code settings files that count as the repository's: committed in HEAD, read as
 * committed (uncommitted edits are not in any clone). The user's ~/.claude/settings.json
 * and an uncommitted project file limit this machine only. A file that can't be read
 * has text null. */
export function committedSettings(root: string): { file: string; committed: boolean; text: string | null }[] {
  const project = [".claude/settings.json", ".claude/settings.local.json"];
  const inHead = new Set((git(root, ["ls-tree", "-r", "--name-only", "HEAD", "--", ...project]) ?? "").split("\n").filter(Boolean));
  const disk = (file: string) => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  };
  // A committed file is named by its path in the repository, never by this machine's
  // absolute path: the evidence goes into reports people share.
  return [
    ...project.map((f) => (inHead.has(f) ? { file: f, committed: true, text: git(root, ["show", `HEAD:${f}`]) } : { file: f, committed: false, text: disk(join(root, f)) })),
    { file: join(homedir(), ".claude", "settings.json"), committed: false, text: disk(join(homedir(), ".claude", "settings.json")) },
  ].filter((s) => s.committed || existsSync(s.file.startsWith("/") ? s.file : join(root, s.file)));
}

/** Where the agent is told, or made, to ask before publishing live. */
function confirmationRule(root: string): { found: string[]; machineOnly: string[] } {
  const found: string[] = [];
  const machineOnly: string[] = [];
  const rules = RULES_FILES.filter((f) => existsSync(join(root, f)));
  for (const f of rules) {
    const line = read(root, f)
      .split("\n")
      .find((l) => ((PUBLISH.test(l) && CONFIRM.test(l)) || FORBID.test(l)) && !/^\s*#/.test(l) && !placeholders(l).length);
    if (line) found.push(`${f}: "${line.replace(/^[-*\s]+/, "").trim().slice(0, 100)}"`);
  }
  // Only settings committed to the repository count; this machine's settings are named, not counted.
  for (const { file, committed, text } of committedSettings(root)) {
    try {
      const p = JSON.parse(text ?? "")?.permissions ?? {};
      const hits = [...(p.ask ?? []), ...(p.deny ?? [])].filter((x: unknown) => typeof x === "string" && /^Bash\(/.test(x) && DEPLOY_COMMAND.test(x));
      if (!hits.length) continue;
      const list = `${hits.slice(0, 3).join(", ")}${hits.length > 3 ? "…" : ""}`;
      if (committed) found.push(`publish commands that stop for the person or are refused in ${file}: ${list}`);
      else machineOnly.push(`${file} (this machine's settings, not committed): ${list}`);
    } catch {
      /* unreadable settings: agentPermissions reports it */
    }
  }
  return { found, machineOnly };
}

export function devApartFromProd(root: string): CheckResult {
  const gate = "Development apart from production";
  const files = tracked(root);
  const unfilled: string[] = [];
  const envs = environmentsShown(root, files, unfilled);
  // "<the live address, or "nothing is live yet">" is a template's choice, not a statement.
  const notLive = [...RULES_FILES, "README.md"].map((f) => read(root, f).split("\n").find((l) => NOT_LIVE.test(l) && !placeholders(l).length)).find(Boolean);
  const { found: confirm, machineOnly } = confirmationRule(root);
  const shownEnvs = envs.length ? envs : notLive ? [`not live yet: "${notLive.trim().slice(0, 80)}"`] : [];
  const ev = [
    shownEnvs.length
      ? `environments: ${shownEnvs.slice(0, 2).join("; ")}`
      : `no development and production environments named in the repository (in the rules file, the README or a note) or shown by config files${unfilled.length ? `: ${unfilled[0]}` : ""}`,
    confirm.length ? `confirmation before publishing live: ${confirm.slice(0, 2).join("; ")}` : `no rule that the agent publishes live only after the person confirms (a line in the rules file, or an ask or deny rule on publish commands in the agent's settings committed to the repository)${machineOnly.length ? `; found only in ${machineOnly[0]}, which other clones and CI don't have` : ""}`,
  ].join("; ");
  return r(2, gate, shownEnvs.length && confirm.length ? "met" : "not-met", ev);
}

// The dashes are counted ({5}) so this file does not hold a key header and flag itself.
const SECRET = /-{5}BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-{5}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9_-]{32,}|xox[baprs]-[A-Za-z0-9-]{10,}/;
const LOCKS: Record<string, string[]> = {
  "package.json": ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock"],
  "pyproject.toml": ["poetry.lock", "uv.lock", "pdm.lock", "requirements.txt"],
  "Gemfile": ["Gemfile.lock"],
  "go.mod": ["go.sum"],
  "Cargo.toml": ["Cargo.lock"],
  "composer.json": ["composer.lock"],
  "pubspec.yaml": ["pubspec.lock"],
  "Package.swift": ["Package.resolved"],
  "mix.exs": ["mix.lock"],
};

const TEST_PATH = /(^|\/)(tests?|spec|fixtures?|testdata|__tests__)\//i;

/** Files the repository's own secret scanner was told to skip after a review:
 * gitleaks' allowlist paths in .gitleaks.toml and the paths in .gitleaksignore.
 * They are named in the evidence, so the exception stays visible. */
function reviewedExceptions(root: string, files: string[]): (f: string) => boolean {
  if (!files.includes(".gitleaks.toml") && !files.includes(".gitleaksignore")) return () => false;
  const patterns: RegExp[] = [];
  for (const block of read(root, ".gitleaks.toml").matchAll(/^\s*paths\s*=\s*\[([\s\S]*?)\]/gm)) {
    for (const m of block[1].matchAll(/'''(.*?)'''|"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) {
      const src = m[1] ?? m[2]?.replace(/\\\\/g, "\\") ?? m[3];
      try {
        patterns.push(new RegExp(src));
      } catch {
        // A pattern JavaScript can't read is skipped, never trusted.
      }
    }
  }
  const ignored = new Set(
    read(root, ".gitleaksignore")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.split(":"))
      .map((p) => (p.length >= 4 && /^[0-9a-f]{7,40}$/.test(p[0]) ? p[1] : p[0])),
  );
  return (f) => ignored.has(f) || patterns.some((re) => re.test(f));
}

export function configurationBasics(root: string): CheckResult {
  const files = tracked(root);
  const gate = "Configuration basics";
  const problems: string[] = [];
  const ok: string[] = [];
  for (const [manifest, locks] of Object.entries(LOCKS)) {
    if (!files.includes(manifest)) continue;
    const lock = locks.find((l) => files.includes(l));
    if (lock) ok.push(`${manifest} → ${lock}`);
    else problems.push(`${manifest} has no committed lockfile`);
  }
  const tags = (git(root, ["tag", "--list"]) ?? "").split("\n").filter(Boolean);
  const remote = tags.length ? hostTags(root) : null;
  const versions = tags.filter((t) => /^v?\d+(\.\d+)+/.test(t));
  // Nothing released yet, said in the rules file or the README, needs no tag (DEC-147);
  // the first release is tagged. A template's blank is a choice, not a statement.
  const notLive = [...RULES_FILES, "README.md"].map((f) => read(root, f).split("\n").find((l) => NOT_LIVE.test(l) && !placeholders(l).length)).find(Boolean);
  if (!tags.length && notLive) ok.push(`no release tags yet, and the repository says nothing is released: "${notLive.trim().slice(0, 60)}" (tag the first release)`);
  else if (!tags.length) problems.push("no release tags (if nothing is released yet, say so in the rules file or the README: \"nothing is live yet\")");
  else if (remote && !tags.some((t) => remote.includes(t))) problems.push(`${tags.length} release tag(s) here, none pushed to the host`);
  else ok.push(`${tags.length} release tag(s)${remote ? ", pushed" : ""}${versions.length ? "" : " (none looks like a version, e.g. v1.2.0)"}`);
  const found = files.filter((f) => !/\.(png|jpe?g|gif|pdf|zip|lock|woff2?)$/i.test(f)).filter((f) => SECRET.test(read(root, f)));
  // A repository's allowlist is its own claim, so it only excuses files under test
  // folders: an allowlist of ".*" or "config/" must not hide a live credential.
  const listed = reviewedExceptions(root, files);
  const excepted = (f: string) => TEST_PATH.test(f) && listed(f);
  const reviewed = found.filter(excepted);
  const leaks = found.filter((f) => !excepted(f));
  if (reviewed.length) ok.push(`key material in ${reviewed.length} file(s) the repository's gitleaks configuration lists as reviewed exceptions: ${reviewed.slice(0, 3).join(", ")}${reviewed.length > 3 ? "…" : ""}`);
  if (leaks.length) {
    const fixtures = leaks.every((f) => TEST_PATH.test(f));
    problems.push(
      `possible secrets committed in ${leaks.slice(0, 3).join(", ")}${leaks.length > 3 ? "…" : ""}${fixtures ? " (all under test folders: if they are throwaway test keys, list them in .gitleaks.toml's allowlist with a reason)" : ""}`,
    );
  }
  if (problems.length) return r(2, gate, "not-met", problems.join("; ") + (ok.length ? ` (ok: ${ok.join("; ")})` : ""));
  // The tool can't tell a throwaway test key from a live one: a person says which.
  if (reviewed.length) return r(2, gate, "not-visible", `${ok.join("; ")}. That they are throwaway test keys needs a person's proof`);
  return r(2, gate, "met", ok.join("; ") || "no dependency manifests; tags present");
}

// ---------------- Level 3 ----------------

export function diagrams(root: string): CheckResult {
  const files = tracked(root);
  const mmd = files.filter((f) => /\.(mmd|mermaid|puml|plantuml|drawio)$/i.test(f));
  const inMd = files.filter((f) => f.endsWith(".md") && /```mermaid/.test(read(root, f)));
  const gate = "Requirement visualizations";
  const all = [...mmd, ...inMd];
  if (all.length) return r(3, gate, "met", `diagrams in the repository: ${all.slice(0, 3).join(", ")}${all.length > 3 ? "…" : ""} (that they are current is a judgment)`);
  return r(3, gate, "not-met", "no workflow or architecture diagrams found (Mermaid, PlantUML or draw.io files, or ```mermaid blocks)");
}

export function threeEnvironments(root: string): CheckResult {
  const files = tracked(root);
  const text = (ciText(root, files) + "\n" + files.join("\n")).toLowerCase();
  const has = (re: RegExp) => re.test(text);
  const envs = [has(/\b(dev|development)\b/) && "development", has(/\b(staging|stage|test|testing|qa|uat)\b/) && "testing/staging", has(/\b(prod|production)\b/) && "production"].filter(Boolean) as string[];
  const gate = "Three environments";
  if (envs.length === 3) return r(3, gate, "not-visible", "development, testing/staging and production named in the pipeline or environment files; that the pipeline promotes changes through them and that the agent holds no production credentials needs a person's proof");
  return r(3, gate, envs.length ? "not-met" : "not-visible", envs.length ? `only ${envs.join(" and ")} found in the pipeline or environment files` : "no environment definitions found; if they live in another repository, attach proof");
}

export function currency(root: string): CheckResult {
  const files = tracked(root);
  const sbom = files.filter((f) => /(sbom|bom)\.(json|xml|spdx)$|\.spdx(\.json)?$|cyclonedx/i.test(f));
  const updater = files.filter((f) => /^\.github\/dependabot\.ya?ml$|(^|\/)renovate\.json5?$|^\.renovaterc/.test(f));
  const policy = files.filter((f) => /update[-_ ]?policy|UPDATE_POLICY/i.test(f));
  const gate = "Platform and dependency currency";
  const ev = [...sbom.slice(0, 1), ...updater.slice(0, 1), ...policy.slice(0, 1)];
  if (sbom.length && updater.length && policy.length) return r(3, gate, "met", `inventory, update tool and policy: ${ev.join(", ")} (patch windows and end-of-life status need the inventory's dates)`);
  const missing = [!sbom.length && "a software inventory (SBOM)", !updater.length && "automated update proposals (Dependabot or Renovate)", !policy.length && "a written update policy"].filter(Boolean);
  return r(3, gate, "not-met", `missing ${missing.join(", ")}${ev.length ? ` (found: ${ev.join(", ")})` : ""}`);
}

export function securityEngineering(root: string): CheckResult {
  const files = tracked(root);
  const text = ciText(root, files).toLowerCase();
  const found = ["codeql", "semgrep", "sonar", "snyk", "trivy", "grype", "osv-scanner", "dependency-review"].filter((x) => text.includes(x));
  const gate = "Security engineering";
  const sast = found.some((x) => ["codeql", "semgrep", "sonar", "snyk"].includes(x));
  const deps = found.some((x) => ["snyk", "trivy", "grype", "osv-scanner", "dependency-review"].includes(x));
  if (sast && deps) return r(3, gate, "not-visible", `scanning in CI: ${found.join(", ")}; threat models for high-risk changes and the secret manager need proof`);
  return r(3, gate, "not-met", `CI lacks ${[!sast && "static analysis (SAST)", !deps && "dependency or container scanning"].filter(Boolean).join(" and ")}${found.length ? ` (found: ${found.join(", ")})` : ""}`);
}

export function releaseManagement(root: string): CheckResult {
  const files = tracked(root);
  const changelog = files.filter((f) => /(^|\/)(CHANGELOG|CHANGES|HISTORY|RELEASES?)(\.md|\.txt)?$/i.test(f));
  const tags = (git(root, ["tag", "--list"]) ?? "").split("\n").filter(Boolean);
  const gate = "Release management";
  if (changelog.length && tags.length) return r(3, gate, "not-visible", `${changelog[0]} and ${tags.length} tag(s); the rollback drill needs proof`);
  return r(3, gate, "not-met", `missing ${[!changelog.length && "a changelog", !tags.length && "release tags"].filter(Boolean).join(" and ")}`);
}

const nv = (gate: string, need: string) => (_root: string) => r(3, gate, "not-visible", need);

export const basics2 = [requirementsFirst, peerReview, verificationTools, securityBeforePush, devApartFromProd, configurationBasics];
export const basics3 = [
  nv("Requirements management", "attach proof that requirements trace to design, tests and changes, and that non-functional requirements are stated and tested"),
  diagrams,
  nv("Decision records with options", "attach the decision records showing options considered, recommendation and choice"),
  nv("V&V before deployment", "attach the verification and validation record of a recent production release"),
  threeEnvironments,
  currency,
  securityEngineering,
  releaseManagement,
  nv("Operations", "attach proof of monitoring and alerting, the incident response, a postmortem, and a tested backup restore"),
  nv("Training", "attach the training record for the standard and the AI tools"),
];

