# Architecture

## The 4-stage pipeline

| Stage | Mechanism | LLM-in-the-loop? |
|---|---|---|
| 1. Generate | Claude Code skill (`plugin/skills/generate-agent-test-suite`) | Yes — reading arbitrary agent source and drafting realistic test cases/rubrics/invocation config is a reasoning task, not a deterministic transform. |
| 2. Gate 1 review | Claude Code skill (`plugin/skills/review-agent-test-cases`) | Yes — citation-vs-source verification and product-judgment triage. |
| 3. Gate 2 review | Claude Code skill (`plugin/skills/review-agent-invoke-config`) | Mixed — claim verification is judgment-based; it also actually executes `scriptChecks.js` against mock pass/fail inputs, which is mechanical once the mocks exist. |
| 4. Run | `agent-test-kit run <agent>` (deterministic CLI) | No — pure execution. Refuses to run unless schema-valid and both gates are approved. |

This collapses what was originally a 5-stage pipeline: the old
`compile-agent-test-suite` stage existed only to hand-transcribe a
human-readable `.md` draft into machine-readable `.json`/`.js` and to check
the two gates before running. Authoring `test-cases.json`/`rubrics.js`
directly (schema-validated from the start, via `agent-test-kit validate`)
removes the transcription step entirely; gate enforcement moved into `run`
itself (`src/core/reviewStatus.js`).

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
that's the package's contract, not something each repo redefines. What
varies is the destination. Default: `adapters/resultsSinks/jsonFileSink.js`
(local NDJSON file, zero external dependencies). A repo with its own
database writes a custom sink that maps this same row shape into its own
schema/columns — the mapping, not the row shape, is what's custom.

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
its own resolver instead.

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
