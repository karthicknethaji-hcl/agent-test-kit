# agent-test-kit

Agent-agnostic AI agent test execution framework: generate, review, and run
rubric-scored test suites against any AI agent, in any codebase — as an
`npx`-installable CLI plus a companion Claude Code plugin for the
LLM-in-the-loop steps.

Extracted from an internal framework built and proven on two production AI
agents. See `docs/ARCHITECTURE.md` for what's genuinely generic vs. what a
consuming repo still has to author.

## The pipeline

Seven things you do, in two places — a terminal, or chat with the bundled
Claude Code plugin. `render`, `sync`, and `validate`/`smoke` re-checks aren't
separate steps you run yourself: each fires automatically as the closing
action of the step right before it, so a mechanical check always catches
problems before the next human judgment call starts.

| # | Step | Where | What you do |
|---|---|---|---|
| 1 | Install the package | Terminal | `npm install --save-dev @karthicknethaji-hcl/agent-test-kit` |
| 2 | Scaffold config + agent folder | Terminal | `npx agent-test-kit init`, `npx agent-test-kit add-agent <name>` |
| 3 | **Generate** the real test suite | Chat | *"Onboard `<agent>` to agent-test-kit — its source is at `<file path>`."* Drafts `test-cases.json`/`rubrics.js`/`invoke-config.js` (+ `scriptChecks.js` if needed), wiring `sendMessage()` to the agent's real code path wherever that's callable headlessly. *Automatic, same step: `validate` + `smoke` + `render` run themselves, fixing anything they find, before handing off.* |
| 4 | **Gate 1 review** (product) | Chat | *"Do a Gate 1 review of `<agent>`'s test cases."* Corrections happen directly in `test-cases.review.md`/`rubrics.review.md` — never the raw JSON/JS. *Automatic, same step: `sync` (MD → JSON, validated, all-or-nothing) then `smoke` re-run before it asks you to approve.* |
| 5 | **Gate 2 review** (technical) | Chat | *"Do a Gate 2 review of `<agent>`'s invoke-config."* Runs against the already-synced, already-smoke-tested `test-cases.json` from step 4. If step 3 couldn't call the agent's real code directly (rare — DOM/session-coupled agents only) and drafted an approximation instead, this is where that gets caught — a normal finding, not approved until fixed. |
| 6 | Approve both gates | Chat, or by hand | Say *"I approve"* once satisfied, or hand-edit `review-status.json`. Approving also stamps a content hash used to detect drift later. |
| 7 | Run | Terminal | `npx agent-test-kit run <agent>` — refuses until both gates are approved. |

Anytime: `npx agent-test-kit status` for every agent's schema/gate state, and
`npx agent-test-kit check-md-staleness <agent>` (read-only, always safe) to
check whether a `.review.md` holds edits that were never synced.
`validate`/`run`/`sync` also print a note — never blocking — if
`test-cases.json`/`rubrics.js` changed since a gate was approved.

Full walkthrough: `docs/GETTING-STARTED.md`. File/interface contracts:
`docs/CONTRACT.md`. Why each pluggable seam exists: `docs/ARCHITECTURE.md`.

## Status

**Private preview.** Published to a private registry only (see below) while
it's validated against real agents outside the codebase it was extracted
from. Public npm release is a later, separate decision.

## Publishing (maintainers)

Publishing to GitHub Packages happens via `.github/workflows/publish.yml`,
triggered by pushing a `vX.Y.Z` tag (or manually via "Run workflow" in the
Actions tab). It uses GitHub's own built-in `GITHUB_TOKEN` — no publish
token is ever stored in this repo or handled outside CI.

```
npm version 0.1.1   # bumps package.json + creates the git tag
git push --follow-tags
```

## Installing from the private registry

This package publishes to GitHub Packages under this org. In the consuming
repo, add to `.npmrc`:

```
@karthicknethaji-hcl:registry=https://npm.pkg.github.com
```

Then authenticate (`npm login --registry=https://npm.pkg.github.com`, or a
`NODE_AUTH_TOKEN`/`GITHUB_TOKEN` with `read:packages` scope in CI) and:

```
npm install --save-dev @karthicknethaji-hcl/agent-test-kit
```

## Installing the Claude Code plugin

```
claude plugin marketplace add <this-repo-url>/plugin
claude plugin install agent-test-kit
```

(Exact subcommands per Anthropic's current Claude Code plugin docs — verify
before relying on this if it's been a while since this was written.)

## Repo layout

```
bin/            CLI entry point
src/core/       evaluator, runner, schema, config, validate — agent-agnostic
src/adapters/   pluggable judgeClient / resultsSink / credentialResolver / traceResolver
examples/       bundled reference agent (no external dependencies)
plugin/         Claude Code plugin: the 4 pipeline skills + marketplace.json
docs/           CONTRACT.md, ARCHITECTURE.md, GETTING-STARTED.md
test/           this package's own end-to-end test (npm test)
```

## Development

```
npm install
npm test
```
