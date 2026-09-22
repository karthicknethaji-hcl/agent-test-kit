# Changelog

All notable changes to this project are tracked here, newest first. Versions
in this file increment by **0.01** per change set — a lightweight counter for
this changelog specifically, separate from `package.json`'s npm semver
version (which follows normal semver rules and is bumped independently when
the package is actually published).

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
