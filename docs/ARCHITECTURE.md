# Architecture

## The 4-stage pipeline

| Stage | Mechanism | LLM-in-the-loop? |
|---|---|---|
| 1. Generate | Claude Code skill (`plugin/skills/generate-agent-test-suite`) | Yes — reading arbitrary agent source and drafting realistic test cases/rubrics/invocation config is a reasoning task, not a deterministic transform. |
| 1.5 Render | `agent-test-kit render <agent>` (deterministic CLI) | No — `test-cases.json`/`rubrics.js` → `test-cases.review.md`/`rubrics.review.md`. |
| 2. Gate 1 review | Claude Code skill (`plugin/skills/review-agent-test-cases`), editing the `.review.md` files | Yes — citation-vs-source verification and product-judgment triage. |
| 2.5 Sync | `agent-test-kit sync <agent>` (deterministic CLI) | No — parses the edited `.review.md` files back into JSON/JS, validates via `ajv`, refuses to write on any error. |
| 3. Gate 2 review | Claude Code skill (`plugin/skills/review-agent-invoke-config`) | Mixed — claim verification is judgment-based; it also actually executes `scriptChecks.js` against mock pass/fail inputs, which is mechanical once the mocks exist. |
| 4. Run | `agent-test-kit run <agent>` (deterministic CLI) | No — pure execution. Refuses to run unless schema-valid and both gates are approved. |

This collapses what was originally a 5-stage pipeline: the old
`compile-agent-test-suite` stage existed only to hand-transcribe a
human-readable `.md` draft into machine-readable `.json`/`.js` and to check
the two gates before running. Authoring `test-cases.json`/`rubrics.js`
directly (schema-validated from the start, via `agent-test-kit validate`)
removes the transcription step entirely; gate enforcement moved into `run`
itself (`src/core/reviewStatus.js`).

The render/sync stages (1.5/2.5) bring a *different* kind of `.md` draft
back for Gate 1 specifically: `test-cases.json`/`rubrics.js` stay what
`validate`/`run` actually execute against (ajv-validated, never relaxed),
but a reviewer edits generated Markdown instead of raw JSON/JS — a
round-trip format (`src/core/mdAuthoring/render.js`/`sync.js`), not
hand-authored from scratch, so it's still exactly as strict as directly
editing the JSON. See `docs/SPEC-sink-reliability-and-md-authoring.md`
"Feature 2" and `docs/CONTRACT.md` for the full field mapping, the
staleness-marker mechanism, and `review-status.json`'s `approvedContentHash`
(detects a hand-edit to the JSON, or a `sync`, after a gate was approved).

## Pluggable seams

The framework this package was extracted from proved the *shape* of these
seams across two real agents in one codebase — but had several of them
hardwired to that codebase's own infrastructure. Each seam below is what
makes the difference between "works for one repo" and "works for any repo."

### `judgeClient` — how the LLM-judge rubrics get scored

Different repos have different model access: a direct provider API key, an
internal proxy, a different provider entirely. Default:
`adapters/judgeClients/anthropicJudgeClient.js` (needs `ANTHROPIC_API_KEY`).

**Note on running inside Claude Code**: the CLI is always its own Node
subprocess, even when launched from a Claude Code session — it has no
privileged access to "that session's own model" and must make its own
independent, credentialed call. `adapters/judgeClients/skillJudgeClient.js`
is the one exception: it's designed to be used only when a wrapping Claude
Code skill (e.g. `plugin/skills/run-agent-tests`) is actively watching an
exchange directory and answering each judge prompt itself, as the running
assistant — useful interactively with no API key, useless headless/in CI.

### `resultsSink` — where result rows get persisted

The **row shape is fixed** (see `docs/CONTRACT.md` "Result row schema") —
that's the package's contract, not something each repo redefines. Default:
`adapters/resultsSinks/markdownSink.js` (a human-readable `.md` report, zero
external dependencies) — a repo that wants machine-readable output instead
can use `jsonFileSink`.

For a database, `supabaseSink` is deliberately **not** a bring-your-own-table
adapter — it always writes to the same fixed table
(`agent_test_kit_quality_scores`, schema in
`sql/agent-test-kit-quality-scores-migration.sql`) with the same columns, in
every repo that adopts this package. Only the connection (which Supabase
project) is ever repo-specific; the schema itself isn't. This is on purpose:
a fixed, universal schema is what makes it possible to build one dashboard
or reporting tool against results from ANY repo using agent-test-kit,
instead of every repo inventing its own table shape and that tooling never
being reusable. `multiSink` combines more than one of these in a single
run, e.g. a Markdown report for humans and a
database write for cross-run querying, at the same time — see
`docs/CONTRACT.md` "Built-in `resultsSink` adapters".

A sink whose writes can fail silently (`supabaseSink`) can also implement
`preflight()`/`getStats()`, so a bad connection or a never-run migration is
never mistaken for success just because the Markdown output still landed —
`agent-test-kit run` probes once up front and prints real persisted/failed
counts at the end, but never fails the run over a persistence problem (see
`docs/SPEC-sink-reliability-and-md-authoring.md` "Feature 1").

### `credentialResolver` — how auth/session values get resolved

Different repos have wildly different ways of getting a test credential:
plain env vars, a browser-driven session token, a secrets manager, an
interactive sign-in flow. Default: `adapters/credentialResolvers/envCredentialResolver.js`
(`<AGENT_NAME>_<VAR>` naming convention). A repo whose agent needs a live
session token (e.g. pulling an auth token out of browser localStorage)
supplies its own resolver with the same
`resolve(agentName, varNames)` interface instead — this is called from
inside your own `invoke-config.js`'s `sendMessage()`, not by the framework
itself, since only your code knows what to do with the resolved values.

### `traceResolver` — turning a client-generated id into a persisted trace id

Most repos have no separate server-assigned trace layer at all, so the
client-generated `clientTraceId` (already threaded through
`invoke-config.js`'s `sendMessage()` return value) simply IS the trace id.
Default: `adapters/traceResolvers/identityTraceResolver.js` (passthrough). A
repo with its own trace/observability layer (a table mapping a
client-generated correlation id to a server-assigned trace record) supplies
its own resolver instead — `resolve(clientTraceId, agentName)` gets both, so
the lookup can be scoped correctly rather than assuming `clientTraceId`
alone is globally unique. A sensible custom resolver falls back to the raw
`clientTraceId` when no matching trace row exists yet, rather than
returning `null` — that keeps every row's `trace_id` populated with
something usable even before the trace layer has caught up.

## What's genuinely fixed vs. what a consuming repo must author

**Fixed, ships as-is:**
- `src/core/evaluator.js` — was already fully generic in the original
  framework; ported near-verbatim.
- `src/core/runner.js` — the `executionMode` dispatch machinery.
- The four contract shapes in `docs/CONTRACT.md` and their JSON Schemas.
- The default adapters (work out of the box with zero external setup, aside
  from `ANTHROPIC_API_KEY` for `llm_judge`/`toxicity_scan` rubrics).

**Always authored per agent, because it encodes that agent's actual
behavior:**
- `invoke-config.js`'s `sendMessage()` body (how to actually call it).
- `scriptChecks.js` (there's no generic diff across arbitrary output shapes).
- `test-cases.json`/`rubrics.js` *content* (what to test, what counts as a
  violation) — a product/engineering judgment call the two review gates
  exist for.

**Authored per repo, once, if the defaults don't fit:**
- A custom `judgeClient`/`resultsSink`/`credentialResolver`/`traceResolver`
  in `agent-test-kit.config.js`.
