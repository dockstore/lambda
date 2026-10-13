# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A monorepo of small, independent AWS Lambda functions used by Dockstore ("backup and document AWS lambdas"). There is no shared build: each function has its own runtime, toolchain and tests. The SAM-based ones each have a `template.yaml` (Handler/Runtime defined there) and sample `events/`.

| Directory | Runtime | Purpose |
|---|---|---|
| `checkUrlExists/` | Node 22 (`lambda/index.js`) | Checks a URL (http/https/ftp/sftp) is reachable; always returns 200, body is true/false |
| `cwlpack/` | Python 3.12 (`cwl_pack_function/app.py`) | Clones a git repo with pygit2 and packs a CWL descriptor with sbpack |
| `wdl-parsing/` | Java 21 (`WDLParsingFunction`, Maven) | Parses WDL descriptors |
| `nextflow-parsing/` | Java 21 (`NextflowParsingFunction`, Maven) | Parses Nextflow descriptors |
| `cloud-watch-to-slack-testing/`, `upsertGitHubTag/` | Node (`deployment/index.js`) | Not SAM; zipped and uploaded to S3 by CircleCI. `upsertGitHubTag` relays API Gateway -> SQS -> Lambda -> Dockstore webservice |

## Commands

Root (JS tooling for the Node lambdas, husky and git-secrets):
- `npm ci` then `npm run lint` (eslint + prettier), `npm test` (jasmine)
- Jasmine picks up `**/deployment/*.[sS]pec.js` and `**/tests/**/test-handler.js` (see `spec/support/jasmine.json`). `checkUrlExists/lambda` has its own `package.json`: run `npm --prefix checkUrlExists/lambda ci` first.
- Single Node test: `npx jasmine path/to/test-handler.js`
- `npm run install-git-secrets` installs git-secrets; the pre-commit hook (husky) runs it. Add false positives to `.gitallowed`.

`cwlpack` (run from `cwlpack/`, Python 3.12):
- `pip install -r tests/requirements.txt -r cwl_pack_function/requirements.txt`
- `python -m pytest tests/unit -v` (single test: `python -m pytest tests/unit/test_handler.py::<name>`)
- `pylint cwl_pack_function` and `pylint tests` (`.pylintrc` adds the cwd to `sys.path`, so run from `cwlpack/`)

Java lambdas (from `wdl-parsing/WDLParsingFunction` or `nextflow-parsing/NextflowParsingFunction`):
- `mvn -B clean install` (also runs checkstyle and tests in the WDL module)

SAM (from each function's directory): `sam build --use-container`; invoke with `sam local invoke <FunctionName> -e events/event.json` (`WDLParsingFunction`, `LambdaFunction` for checkUrlExists). `sam build` also runs the Java tests.

## CI

- **GitHub Actions** (`.github/workflows/maven.yml`, plus `codeql.yml`): ESLint job, then one job that builds every function with SAM in containers, invokes wdl-parsing and checkUrlExists and greps for `statusCode": 200`, and runs the cwlpack pytest/pylint steps. Runners are pinned to `ubuntu-26.04`.
- **CircleCI** (`.circleci/config.yml`): git-secrets scan, lint, jasmine tests, and SAM package + S3 upload.
- **SonarCloud** scans the workflows. Installs use `npm ci --ignore-scripts` and `pip install --only-binary :all:` with pinned versions to satisfy it; keep that pattern for new install steps.

## Gotchas

- Lambda runtimes and CI Python/Java versions must stay aligned (the pytest 9 Dependabot bump failed because CI was on Python 3.8). When changing a runtime, update the `template.yaml`, the workflow and the dependency pins together.
- The `cwlpack` handler returns 400 when `git_url` or `descriptor_path` query parameters are missing, or when the descriptor is missing or invalid (sbpack can raise `SystemExit` on invalid CWL).

## Workflow conventions

Copied from the conventions in `dockstore/dockstore`'s `CLAUDE.md` (the Dockstore-specific build/architecture sections are omitted).

### Branching

The repo follows Hubflow (gitflow) conventions: `develop` is the main integration branch (this repo's default
branch for PRs), with work done on `feature/*` branches branched from and merged back into `develop`, `hotfix/*`
branches for urgent fixes, and `release/*` branches cut for releases.

### Pull requests

When creating a PR, always create it in draft mode. A human developer must be the one to mark it ready for
review/move it out of draft state — Claude Code should not do this itself.

Always check with the user before pushing changes to GitHub, even to a branch/PR already being worked on in
the conversation — a push can kick off a long CI build or interrupt one that's already running. Before asking,
show the user what would be pushed (e.g. `git log` and `git diff` against the remote branch) so they can review
it first. An earlier "push" request does not cover later commits, and a force-push (e.g. after a rebase)
always needs explicit approval.

When a GitHub MCP server or `gh` is available, diff the current work against `develop` (or whatever branch the
PR targets) and try to minimize stylistic or otherwise-minor changes that inflate the diff and make it harder
to review, unless those changes fix something a Codacy finding or other code-quality check actually flagged.

Use `.github/PULL_REQUEST_TEMPLATE.md` for PR descriptions. Keep the freeform "Description" section brief — one
paragraph, or two for a genuinely complicated fix, not a multi-paragraph writeup — and fill "Issue" with a GitHub
issue link or `SEAB-` ticket if there is one.

In the "Security" section, only note concerns that need extra attention from the security team (e.g. changes to
dependencies, installs, runtimes, credentials or workflow permissions); if there are none, say so briefly. Don't
reword the template's prompt text. The checklist item ("Ensure that the PR targets the correct branch") must be
copied verbatim — never reword, reformat, condense, or append explanatory text to it. Only toggle `[ ]` to `[x]`
after actually confirming it for this PR (e.g. the base branch matches the milestone/fix version of the ticket);
leave it unchecked otherwise.

### Using CI and review feedback to guide work

When diagnosing a failing build or iterating on an open PR, pull in whatever signal is actually available
rather than guessing:

- If `gh` or a GitHub MCP server is available, use GitHub Actions build results (check runs, job logs) to
  guide diagnosis and fixes.
- If a CircleCI MCP server is available, use its results (workflow/job status, test failures, logs) to guide
  diagnosis and fixes.
- Codacy findings aren't reliably fetchable through available tooling. If Codacy results seem significant to
  the task, prompt the user to copy-paste them rather than guessing at what Codacy flagged.
- Code review comments left by human developers are high-priority direction — investigate each one and
  propose concrete solutions, even without an explicit instruction to do so. Bot-authored comments (Codacy,
  Copilot Autofix, etc.) are useful but secondary to human reviewer comments.

### JIRA

When adding comments to JIRA tickets, clearly indicate that the comment was written by Claude (e.g. lead with
a line like "This comment was generated by Claude (Claude Code).").
