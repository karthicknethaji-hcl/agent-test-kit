# Changelog

All notable changes to this project are tracked here, newest first. Versions
in this file increment by **0.01** per change set — a lightweight counter for
this changelog specifically, separate from `package.json`'s npm semver
version (which follows normal semver rules and is bumped independently when
the package is actually published).

## [0.09] - 2026-09-24

### Added

- `agent-test-kit run` now takes a `--notes` flag (off by default) to include
  the evaluator `Notes` column in the Markdown report; without it, the
  report omits that column entirely instead of always including it.
- `generate-agent-test-suite` now supports a requirements-only mode for
  agents without available source code: inline requirements typed in the
  onboarding prompt, or a requirements/spec file (Markdown, plain text, PDF,
  or Word) at any path or attached in chat. Drafted suites are cited against
  the requirements input instead of source, and the generated `README.md`
  carries an explicit "Doc-derived, not code-verified" callout.
  `review-agent-test-cases` and `review-agent-invoke-config` were updated to
  review doc-derived citations accordingly. When both source and
  requirements are given, the generator flags mismatches between what the
  doc requires and what the code implements (manual, not automated).

### Changed

- `createResultsSink` config hook now receives a second `options` argument
  (`{ includeNotes }`); custom overrides may ignore it.

## [0.08] - 2026-09-23

### Changed

- `markdownSink` now includes a `Notes` column in the results table
  (JSON-serialized `row.notes`, previously silently dropped) and reorders
  the header to `Test ID | Category | Metric | Score | Pass | Evaluator |
  Notes | Recommendation`, with the `Notes`/`Recommendation` columns
  widened to fit their larger content.

## [0.07] - 2026-09-22

### Changed

- Prepared the package for a real public npm release, replacing the
  GitHub Packages private-registry setup:
  - Added an MIT `LICENSE` file; `package.json`'s `license` field changed
    from `UNLICENSED` to `MIT`, and `publishConfig` now sets
    `access: "public"` instead of pointing at `npm.pkg.github.com`.
  - `.github/workflows/publish.yml` now publishes to `registry.npmjs.org`
    using an `NPM_TOKEN` repo secret (an npm Automation token, created by
    hand on npmjs.com) instead of `GITHUB_TOKEN`.
  - `README.md` and `docs/GETTING-STARTED.md`'s install instructions no
    longer mention `.npmrc` scope config or registry authentication.

### Not done yet (requires manual action outside this repo)

- The actual `npm publish` hasn't happened — that needs an npm
  user/org named `karthicknethaji-hcl` to exist, 2FA enabled, an
  "Automation" access token generated on npmjs.com, and that token added
  as this repo's `NPM_TOKEN` GitHub Actions secret. Only after that is in
  place does pushing a `vX.Y.Z` tag actually publish anything.

## [0.06] - 2026-09-22

### Changed

- `README.md`'s "The pipeline" section replaced the stale 4-step summary
  (which predated the sync+smoke reorder and never mentioned install/
  scaffold/approve) with the full current 7-step flow — matching
  `docs/GETTING-STARTED.md` and the published "Agent Test Kit Pipeline"
  artifact, including the terminal-vs-chat distinction and the
  "automatic, same step" callouts for Generate and Gate 1.

## [0.05] - 2026-09-22

### Changed

- `markdownSink`'s default per-run filename now includes the agent's name
  (`run-<agentName>-<ISO timestamp>-<random suffix>.md`, e.g.
  `run-example-agent-2026-09-22T07-21-18-941Z-2d9789.md`) instead of just a
  timestamp — a report is now identifiable from its filename alone. `run`
  and `smoke` now call `config.createResultsSink(agentName)` (previously
  zero-arg); a custom `createResultsSink` override may ignore the new
  argument if it doesn't need it.

## [0.04] - 2026-09-22

### Fixed

Three end-of-step "actionable summary" gaps found while onboarding a real
agent (`requirement-agent`, in a separate consuming repo) with the plugin:

- `generate-agent-test-suite`'s hand-off (step 5) now requires an explicit
  list of every file created/modified (full relative paths) plus exactly
  which files to open for Gate 1 vs. Gate 2 review — previously just a prose
  "it's ready for review" sentence, with no file manifest a reviewer could
  act on directly.
- `add-agent`'s CLI output (`addAgent.js`) no longer tells the user to
  hand-author `invoke-config.js`/`test-cases.json`/`rubrics.js` themselves —
  that line predated the current flow, where the Generate skill drafts those
  files. It now points at the Generate skill instead.
- `agent-test-kit smoke` now prints the agent's actual response text on
  PASS, not just "got a non-empty response" — needed so a skill invoking it
  via a shell command can actually report real output, per
  `generate-agent-test-suite`/`review-agent-test-cases`'s existing "report
  the actual output, don't just say passed" instruction.
- `review-agent-test-cases` (Gate 1) and `review-agent-invoke-config`
  (Gate 2) now require a consolidated findings recap immediately before
  asking the reviewer to approve, instead of assuming they'll scroll back
  through the conversation to find them.

## [0.03] - 2026-09-22

### Changed

- Moved `sync` + `smoke` to a single merged checkpoint right after Gate 1,
  before Gate 2 — not a separate step at the end of the pipeline. Gate 2
  review builds its mock pass/fail inputs from `test-cases.json`, so that
  file has to already reflect Gate 1's edits before Gate 2 starts.
  `docs/ARCHITECTURE.md`'s pipeline table and the `review-agent-test-cases`/
  `review-agent-invoke-config` skills updated to match.
- Rewrote `docs/GETTING-STARTED.md`'s "Onboard your own agent" section for
  the resulting 7-step flow, and clarified that wiring `invoke-config.js` to
  an agent's real code is part of **Generate** (step 3), not a separate
  hand-coding step — a Gate 2 finding, not a distinct pipeline stage, is how
  a DOM/session-coupled approximation gets caught.

## [0.02] - 2026-09-22

### Changed

- `markdownSink`'s zero-config default no longer writes to a single fixed
  `.agent-test-kit-results.md` that every run appends to. It now writes a
  fresh, timestamped file per run under `.agent-test-kit-results/`
  (`run-<ISO timestamp>-<random suffix>.md`) — nothing is ever overwritten,
  and a run's results aren't buried inside a growing, ever-larger file
  either. The random suffix guards against two runs starting within the
  same millisecond colliding on a filename.
- Pass an explicit `filePath` to `createMarkdownSink({ filePath: '...' })`
  to opt back into the old single-file, append-forever behavior.
- Updated `.gitignore`, the scaffolded `agent-test-kit.config.js` comment
  (`init.js`), and `docs/CONTRACT.md`'s adapter table accordingly.
- `jsonFileSink` (NDJSON) is unchanged — its append-per-row semantics are a
  deliberate machine-readable log across runs, a different use case from
  the human-readable Markdown report this change addresses.

## [0.01] - 2026-09-22

Baseline entry — covers the sink-reliability + Markdown-authoring feature
work and its subsequent code review, per
`docs/SPEC-sink-reliability-and-md-authoring.md`.

### Added

- **Sink-failure visibility** (Feature 1): `resultsSink` gains two optional
  lifecycle methods, `preflight()` and `getStats()`. `supabaseSink` implements
  both (a cheap up-front reachability probe, and attempted/failed write
  counters); `multiSink` fans both out across its children. `agent-test-kit
  run` probes every sink once before running any test case and prints a
  per-sink persistence summary at the end — a misconfigured or unreachable
  database can no longer look identical to a fully successful run, without
  ever failing the run itself over a persistence problem.
- **Markdown authoring layer for test-cases.json/rubrics.js** (Feature 2):
  new `agent-test-kit render <agent>` / `sync <agent>` / `check-md-staleness
  <agent>` CLI commands (`src/core/mdAuthoring/render.js`/`sync.js`/`hash.js`).
  A Gate 1 reviewer now edits generated `test-cases.review.md`/
  `rubrics.review.md` instead of raw JSON/JS; `sync` parses the edits back,
  validates them exactly as strictly as `agent-test-kit validate` does, and
  refuses to write anything on any error (all-or-nothing).
- **Gate-approval integrity**: `review-status.json` gains an optional
  `approvedContentHash` per gate; `checkGateContentDrift()`
  (`src/core/reviewStatus.js`) warns — never blocks — when
  `test-cases.json`/`rubrics.js` change after a gate was already approved.
  `agent-test-kit run`/`validate`/`sync` all surface this via a shared
  `warnIfGateContentDrifted()` helper.
- Updated `docs/CONTRACT.md`, `docs/ARCHITECTURE.md`, and the
  `generate-agent-test-suite`/`review-agent-test-cases`/
  `review-agent-invoke-config` plugin skills to document and wire up the new
  pipeline stages.

### Fixed (code review, same change set)

- `checkMdStaleness` now detects the scenario it was actually built for —
  unsynced edits to a `.review.md` file's *body* — via a full structural
  comparison against the on-disk JSON/JS, instead of a static render-time
  hash marker that could never see a body-only edit.
- Removed a literal NUL byte that had been accidentally written into
  `src/core/reviewStatus.js` (was corrupting the file for `git diff` and any
  text-only tooling); `computeContentHash()` now combines two independent
  hashes instead of concatenating raw file text with a delimiter.
- `preflight()` is now guaranteed to never throw: `supabaseSink` wraps its
  client call in try/catch, and `runCmd.js`/`multiSink` add defense-in-depth
  isolation so a misbehaving sink (or a network-level rejection) can never
  crash a run or take a sibling sink down with it.
- `runCmd`'s end-of-run persistence summary no longer fabricates a line for
  a sink that implements neither `describe()` nor `getStats()` (e.g. the
  default no-op `consoleSink`) — restores the original "print nothing" case.
- `sync` now reuses `validate.js`'s validation (schema + rubric
  cross-references + `scriptChecks.js` completeness) via a new shared
  `validateContent()` export, instead of a partial, drifting duplicate — so
  `sync` can never succeed on content that the very next `validate`/`run`
  would then reject.
- `checkGateContentDrift` only silently ignores a missing
  `test-cases.json`/`rubrics.js` (`ENOENT`); any other error is now surfaced
  via `console.warn` instead of failing completely silently.
- Fixed a stale `require()` cache bug: `loadAgent()`/`validateAgent()` could
  see pre-`sync` content when called again in the same process after a
  `syncAgent()` write. A shared `requireFresh()` helper (extracted into
  `validate.js`) now busts `require.cache` everywhere an agent's files are
  loaded.
- `multiSink.preflight()`/`getStats()` now run children concurrently and
  isolate each child's own failure, instead of one throwing/misbehaving
  child aborting the whole fan-out (and, before this fix, the whole run).

### How to bump this file

Each subsequent change set gets a new `## [0.0N]` entry above this line
(increment the last one by 0.01), dated, with a short "Added"/"Fixed"/
"Changed" summary — mirroring the structure above.
