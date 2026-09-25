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

## Querying persisted results

`npx agent-test-kit results <agent>` retrieves previously persisted rows —
the read counterpart to `run`'s write path. It only works when the
configured `resultsSink` is (or contains) an `mcpSink` whose connected
server implements the optional `query_results` tool (see `docs/CONTRACT.md`
"MCP results-sink server contract"); `markdownSink`/`jsonFileSink`/
`consoleSink` are write-only by design.

```
npx agent-test-kit results my-agent --pass false --from 2026-01-01 --limit 20
```

Filters: `--test-id`, `--agent-name` (implied by the `<agent>` argument),
`--pass true|false`, `--evaluator`, `--run-id`, `--from`/`--to` (ISO 8601,
inclusive), `--limit`, `--cursor` (pass back a printed `Next cursor:` value to
page), and `--sink <n>` to disambiguate when more than one query-capable sink
is configured.

## Persisting results anywhere — no database is built in

`agent-test-kit` has no built-in database or vendor. The default is a local
Markdown report (zero dependencies, zero setup); for shared/queryable
persistence, `createMcpSink` talks to **any** local MCP server that
implements the small tool contract in `docs/CONTRACT.md` — `store_result` is
the only required tool. Two reference servers live under `mcp-servers/` in
this repo, published as independent packages:

- `mcp-servers/supabase-mcp-server` — for repos already on Supabase.
- `mcp-servers/example-json-file-mcp-server` — the simplest possible
  reference (a single local JSON file), meant to be read and copied as the
  starting point for any other backend (Postgres, MySQL, SQLite, Mongo, a
  REST API — anything).

Existing repos already on an agent-test-kit release with `createSupabaseSink`
should see `CHANGELOG.md` for the migration path, and every repo upgrading
past the per-agent folder restructure should run
`npx agent-test-kit migrate-layout --dry-run` before `npx agent-test-kit
migrate-layout` (see `docs/ARCHITECTURE.md` "Per-agent folder layout").

## Status

**Public.** Published to the public npm registry — `npm install` works for
anyone, no authentication required. MIT licensed (see `LICENSE`).

## Publishing (maintainers)

Publishing happens via `.github/workflows/publish.yml`, triggered by pushing
a `vX.Y.Z` tag (or manually via "Run workflow" in the Actions tab). It needs
an `NPM_TOKEN` repo secret — an npm "Automation" access token for the
`@karthicknethaji-hcl` user/org, created by hand on npmjs.com (Settings ->
Secrets and variables -> Actions in this repo to add it; nothing in CI can
create that token itself).

```
npm version 0.1.1   # bumps package.json + creates the git tag
git push --follow-tags
```

## Installing

```
npm install --save-dev @karthicknethaji-hcl/agent-test-kit
```

Or without installing, via `npx`:

```
npx @karthicknethaji-hcl/agent-test-kit init
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
src/core/       evaluator, runner, schema, config, validate, agentPaths — agent-agnostic
src/adapters/   pluggable judgeClient / resultsSink / credentialResolver / traceResolver
mcp-servers/    reference MCP persistence servers (Supabase, a minimal JSON-file example) —
                independent packages, not dependencies of the core package
scripts/        verify-mcp-servers.js (CI packaging check for mcp-servers/)
examples/       bundled reference agent (no external dependencies)
plugin/         Claude Code plugin: the 4 pipeline skills + marketplace.json
docs/           CONTRACT.md, ARCHITECTURE.md, GETTING-STARTED.md
test/           this package's own end-to-end tests (npm test)
```

## Development

```
npm install
npm test
```
