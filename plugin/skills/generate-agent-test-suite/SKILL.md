---
name: generate-agent-test-suite
description: Draft a new agent's agent-test-kit test suite (test-cases.json, rubrics.js, invoke-config.js, README.md, review-status.json, and scriptChecks.js if needed) from its real source code, or — when source isn't available — from a requirements/spec document or inline description. Then validate and smoke-test the draft. Use when the user asks to "onboard <agent> to agent-test-kit", "generate/draft test cases for <agent>", or similar.
---

# Generate agent test suite

Drafts a new agent's onboarding files by actually reading its real source
code — never by inventing behavior from the agent's name or from general
knowledge of what such an agent "usually" does. There is no separate
deterministic script for this step: inferring realistic test cases, rubrics,
and an accurate `invoke-config.js` from arbitrary source is a reasoning task,
not a mechanical transform.

**When no source code is available**, draft instead from a requirements
input (see "Requirements-only mode" under step 1/3 below) — inline text the
caller typed, or a requirements/spec file (Markdown, plain text, PDF, or
Word) at any path they give, including one attached directly in the chat.
This still produces a real, runnable suite; it's just derived from stated
intent rather than verified implementation, and every output says so
plainly (see step 3).

Unlike the original 5-stage version of this pipeline, there is **no `.md`
draft step** — you author `test-cases.json`/`rubrics.js` directly, validated
against the schema as you go (`agent-test-kit validate`), which is what lets
`compile-agent-test-suite` not exist as a separate stage here at all.

## 1. Resolve the target

- Read `agent-test-kit.config.js` (repo root, or nearest ancestor) for
  `agentsDir` (default `test-suite/agents`). If it doesn't exist, tell the
  caller to run `npx agent-test-kit init` first.
- Derive the agent's folder name from what the caller named it (kebab-case).
  If a folder already exists at `<agentsDir>/<name>/` with `test-cases.json`
  already populated, stop and ask before overwriting — this could be a
  second onboarding pass, not a fresh one. Before drafting over an existing
  folder, run `npx agent-test-kit check-md-staleness <name>` and relay its
  output to the caller — if it warns that `test-cases.review.md`/
  `rubrics.review.md` hold edits never synced to JSON, tell them plainly that
  regenerating now will overwrite `test-cases.json`/`rubrics.js` and those MD
  edits will be lost unless they run `npx agent-test-kit sync <name>` first,
  then proceed if they still want to (informational only, never blocking).
- Locate the agent's real source: ask the caller which file(s)/module
  actually implement the agent if it isn't obvious from the repo.
- **Requirements-only mode**: if the caller says source code isn't available
  (or gives requirements alongside source — see below), identify what they
  gave you:
  - **Inline text** — requirements typed straight into the prompt (e.g.
    "Onboard X, whose requirement is to..."). Treat that message as the
    source of truth; restate/organize it into a "Requirements" section you
    write into the drafted `README.md` verbatim enough to be checkable later
    (don't paraphrase away specifics).
  - **A file at a path, or attached in chat** — Markdown, plain text, PDF, or
    Word. Read/extract its content. There's no fixed folder convention —
    whatever path the caller gives is fine. Copy the requirements content (or
    a faithful excerpt covering what you drafted from) into the agent's own
    `<agentsDir>/<name>/` folder as part of onboarding, same as any other
    agent doc, so the suite's justification travels with it.
  - **Both source and requirements together** — read both. Use the
    requirements doc to check whether the source actually implements
    everything it describes, and flag in the hand-off (step 5) anything the
    doc requires that the code doesn't do, and anything the code does that
    the doc never mentions. This is a manual read-and-compare, not an
    automated diff — there's no tooling for that yet.

## 2. Read the reference contract and reference agent

Before drafting anything, read:
- `docs/CONTRACT.md` (root of this package) — the exact required shape of
  every file you're about to produce.
- `examples/example-agent/` — a small, fully worked example of all of them
  together (structure only; its content is a toy note-taker, not a template
  for YOUR agent's actual behavior).
- Every other agent already onboarded under `agentsDir` (if any) — specifically
  their `rubrics.js` files, to avoid reusing a rubric code with a different
  meaning (see the collision check in `review-agent-test-cases`).

## 3. Draft, reading the real source (or the requirements input)

For each output below, cite what justifies each claim: the exact
file/function/line in the agent's own source when you have it, or — in
requirements-only mode — the doc's section/heading (e.g. "Requirements
§4.2"), or "per stated requirement" for inline text. Do not describe
behavior you haven't actually verified against whichever input you were
given, and never blur the two — a citation must make clear whether it's
code-verified or doc-derived.

1. `test-cases.json` — one entry per test case, matching
   `src/core/schema/testCase.schema.json`. Cover the agent's real behaviors:
   correctness, its actual constraints/guardrails as written in its own
   prompt/logic, and realistic failure modes — not generic AI-testing
   boilerplate.
2. `rubrics.js` — one entry per rubric code referenced above, matching
   `src/core/schema/rubric.schema.json`. Prefer `script_diff` wherever the
   check is a deterministic property of the output (format, presence of a
   field, a forbidden pattern) — reserve `llm_judge` for genuinely
   judgment-based checks (groundedness, tone, safety).
3. `invoke-config.js` — the two-function contract
   (`createConversationState()`/`async sendMessage(state, action)` returning
   `{rawText, parsed, parseError, clientTraceId, systemPrompt}`), calling the
   agent's REAL code path, not a hand-approximated re-implementation, wherever
   that's feasible headlessly. If the real orchestration code is
   DOM/session/framework-coupled and can't be called directly, say so
   explicitly in the drafted `README.md` and build the closest faithful
   approximation — never silently pretend it's calling the real thing.
   Resolve any credentials it needs via the repo's configured
   `credentialResolver` (see `docs/ARCHITECTURE.md`) — never hardcode a
   token/key inline.
4. `scriptChecks.js` — only if any rubric above is `script_diff`. One handler
   function per such rubric code. This is the file most likely to silently
   do nothing if you forget it — `agent-test-kit validate` will catch a
   missing handler, but only if you actually run it (step 4).
5. `README.md` — what this agent is, what `invoke-config.js`'s
   approximation/fidelity looks like, any known limitations. In
   requirements-only mode, add an explicit **"Doc-derived, not
   code-verified"** callout: state that this suite was drafted from stated
   requirements rather than source code, name the input (doc path/title, or
   "inline requirements from the onboarding conversation"), and note that any
   rubric which can't truly be checked without seeing real output/code
   should be re-verified once source exists.
6. `review-status.json` — both gates `approved: false` (use
   `agent-test-kit add-agent <name>` to scaffold this, or write it by hand
   matching `docs/CONTRACT.md`).

## 4. Validate, smoke-test, and render for review

```
npx agent-test-kit validate <name>
npx agent-test-kit smoke <name>
npx agent-test-kit render <name>
```

Fix issues and re-run until validate/smoke both pass. Report the smoke
test's actual output (the response it got back) — don't just report
"passed." `render` writes `test-cases.review.md`/`rubrics.review.md` from
the JSON/JS you just drafted — that's what the Gate 1 reviewer actually
edits (see `review-agent-test-cases`), not the raw JSON/JS.

## 5. Hand off

End with an explicit file list the caller can click straight into — never
just a prose sentence saying the draft is "ready":

- **Files created/modified**, each as its own full relative path (e.g.
  `test-suite/agents/<name>/test-cases.json`), one line each, with a
  one-clause reason (new file, schema fix, content rewrite against real
  source, etc.).
- **What to actually open for review** — the `.review.md` files `render`
  just produced, not the raw JSON/JS: `test-suite/agents/<name>/test-cases.review.md`
  and `test-suite/agents/<name>/rubrics.review.md` for Gate 1
  (`review-agent-test-cases`), plus `test-suite/agents/<name>/invoke-config.js`
  (and `scriptChecks.js` if present) for Gate 2 (`review-agent-invoke-config`).
- **Anything that needs a decision before review** (e.g. couldn't call the
  real code path and used an approximation instead, drafted in
  requirements-only mode, or — when both source and requirements were given —
  any mismatch found between what the doc requires and what the code
  actually does) — flagged plainly, not buried in prose.

This skill never approves its own output.
