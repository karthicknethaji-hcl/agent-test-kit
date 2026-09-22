# File & interface contracts

This is the formal spec that used to exist only as "copy the other agent's
file" in the framework this package was extracted from. Every shape below is
enforced by `agent-test-kit validate` (backed by the JSON Schemas in
`src/core/schema/`), not just documented in prose.

## Per-agent files (`test-suite/agents/<name>/`)

### `invoke-config.js`

```js
module.exports = {
  agentName: 'string',                       // required
  createConversationState() { ... },          // required — returns opaque per-conversation state
  async sendMessage(state, action) {           // required
    // ... call your agent however "calling your agent" means in your repo ...
    return {
      rawText: 'string',        // required — the raw model/agent output
      parsed: {} ,               // optional — your own parsed structure, consumed by scriptChecks.js
      parseError: null,          // optional
      clientTraceId: 'uuid',     // optional — threaded to traceResolver / the result row
      systemPrompt: 'string'     // optional — enriches llm_judge prompts and recommendations
    };
  },
  async smokeTestAction() { ... } // optional — one minimal valid `action` for `agent-test-kit smoke`;
                                    // falls back to {content: '...'} if absent
};
```

`action`'s own shape is **never** part of this contract — it's whatever your
agent actually expects (`{content}`, `{mode, ...}`, anything). `test-cases.json`'s
`probe`/`setup` fields are passed straight through to `sendMessage()` without
interpretation.

Auth/session/API-key resolution belongs INSIDE `sendMessage()`'s body, using
your configured `credentialResolver` (see `docs/ARCHITECTURE.md`) — never
hardcoded here.

### `scriptChecks.js` (only required if any rubric is `evaluatorType: 'script_diff'`)

```js
module.exports = {
  '<rubricCode>': function (testCase, rubric, callResult, context) {
    return { pass: boolean, score: number|null, notes: {}, recommendation: string|null };
  }
};
```

This logic is inherently agent-specific — there's no generic "diff" that
works for every agent's output shape, which is exactly why this lives per
agent rather than in the shared evaluator.

### `test-cases.json`

Schema: `src/core/schema/testCase.schema.json`.

```json
{
  "agentName": "string",
  "schemaVersion": "1.0",
  "testCases": [
    {
      "testId": "string",
      "category": "string",
      "rubric": "string (must match a key in rubrics.js)",
      "v1Scope": true,
      "executionMode": "single-turn | multi-turn | dual-conversation | background-scan | repeat-n",
      "probe": {},
      "setup": [],
      "judgeContext": {},
      "expectedBehaviorNote": "string",
      "failureModeNote": "string"
    }
  ]
}
```

### `rubrics.js`

Schema: `src/core/schema/rubric.schema.json`.

```js
module.exports = {
  '<rubricCode>': {
    metric: 'string',
    evaluatorType: 'script_diff | llm_judge | toxicity_scan',
    scale: 'binary | 0-1',            // llm_judge/toxicity_scan only
    threshold: 0.7,                    // llm_judge only, scaled rubrics; default 0.7
    judgePromptTemplate: 'string'      // required for llm_judge/toxicity_scan;
                                         // {{output}}, {{sourceMaterial}}, etc. filled by evaluator.js
  }
};
```

### `review-status.json`

Written/read by `src/core/reviewStatus.js`; enforced by `agent-test-kit run`
(pass `--skip-gate-check` to bypass locally while iterating).

```json
{
  "gate1": { "approved": false, "reviewer": null, "date": null, "notes": "", "approvedContentHash": null },
  "gate2": { "approved": false, "reviewer": null, "date": null, "notes": "", "approvedContentHash": null }
}
```

`approvedContentHash` is an optional `sha256:...` hash (via
`reviewStatus.computeContentHash(agentDir)`) of `test-cases.json` +
`rubrics.js`'s combined content, recorded by whichever skill/step flips that
gate's `approved` to `true`. `reviewStatus.checkGateContentDrift(agentDir,
status)` recomputes the hash and returns the list of approved gates
(`['gate1']`, `['gate1', 'gate2']`, or `[]`) whose recorded hash no longer
matches — `agent-test-kit run`/`validate`/`sync` all call this and print a
note (never block, never reset the booleans) when it fires. A gate with no
recorded `approvedContentHash` (approved before this field existed, or never
stamped) is never flagged.

### `test-cases.review.md` / `rubrics.review.md` (generated — the human-edit layer)

Not hand-authored from scratch: `agent-test-kit render <agent>` writes these
from the current `test-cases.json`/`rubrics.js`; a reviewer edits them
directly; `agent-test-kit sync <agent>` parses them back into JSON/JS,
validates via `src/core/validate.js`'s `validateContent()` — the same schema
checks, rubric cross-references, and `scriptChecks.js` completeness check
`agent-test-kit validate`/`run` apply — and refuses to write anything on any
error, so `sync` can never succeed on content the very next `validate`/`run`
would then reject. `validate`/`run`/`smoke` never read the `.review.md` files
— only `render`/`sync` do, so the actual enforced contract is exactly as
strict as it was before this layer existed. See
`src/core/mdAuthoring/render.js`/`sync.js` and
`docs/SPEC-sink-reliability-and-md-authoring.md` "Feature 2" for the full
field → prose mapping and the round-trip guarantee
(`sync(render(json)) === json`).

Each file starts with three hidden marker comments (never touched by a human
editor):

```markdown
<!-- agent-test-kit:kind:test-cases -->
<!-- agent-test-kit:agent:<agentName> -->
<!-- agent-test-kit:source-hash:sha256:<hash of the JSON/JS this MD was last rendered from> -->
```

`source-hash` is informational provenance only (embedded once, at `render`
time) — `agent-test-kit check-md-staleness <agent>` does **not** rely on it.
Instead, `checkMdStaleness()` fully parses the current `.review.md` and
structurally compares it (deep-equal, not a hash of raw file text) against
the current on-disk `test-cases.json`/`rubrics.js`: if they'd no longer
produce the same content, the pair is stale — whether because a reviewer
edited the `.review.md` body directly (the normal Gate 1 workflow, and the
scenario that actually matters) or because the JSON/JS was hand-edited
bypassing the MD entirely. A hash-of-the-marker comparison can't detect the
first (and far more common) case, since editing the MD body never touches
the JSON or the embedded marker — that's why this check is a full structural
comparison, not a marker lookup. This check is read-only and always exits 0;
`render` also runs it before overwriting an existing `.review.md`, warning
(never blocking) if doing so would discard edits.

## Pluggable adapter interfaces

See `docs/ARCHITECTURE.md` for why each of these exists and what varies per
consuming repo.

- **`judgeClient`**: `async (promptText) => rawResponseText`
- **`resultsSink`**: `{ async write(row), finalize?(runSummary), verify?(result), preflight?(), getStats?() }`
  — `write` is required, called once per test case as it completes.
  `finalize` is optional, called once by `runner.js` after every row for the
  run has already been written, with
  `{runId, agentName, totalRun, totalFail, byCategory}` — a sink that only
  needs per-row writes (`jsonFileSink`, `supabaseSink`) doesn't need it; one
  that renders a whole-run summary (`markdownSink`) does. `verify` is
  separate again, used only by `agent-test-kit smoke` to confirm a write
  actually landed if the sink wants to offer that.
  `preflight()` is an optional, cheap up-front reachability probe —
  `runCmd.js` calls it once before running any test case and returns
  `{ ok: boolean, reason?: string }`; a sink with nothing cheap to check
  (e.g. `markdownSink`) just doesn't implement it. It must never throw or
  reject (a bad connection is reported via `{ok: false, reason}`, not an
  exception) — `supabaseSink`'s own implementation wraps its client call in
  try/catch to guarantee this, and `runCmd.js`/`multiSink` additionally
  isolate a misbehaving third-party sink's rejection so it can never take
  down the run (or its sibling sinks in a `multiSink`) even if a sink doesn't
  honor that.
  `getStats()` is an optional post-run accounting hook returning
  `{ attempted: number, failed: number }` for sinks whose writes can fail
  silently (`supabaseSink`) — `runCmd.js` uses it to print real
  persisted/failed counts instead of just "done"; a sink that implements
  neither `describe()` nor `getStats()` (e.g. `consoleSink`) gets no
  persistence-summary line at all, same as before this feature existed.
  `multiSink` fans both out across its children (skipping ones that don't
  implement them, running `preflight()` concurrently since each child's probe
  is typically an independent network call) and returns one
  `{ describe, ... }` entry per child rather than a single result.
- **`credentialResolver`**: `{ async resolve(agentName, varNames) => { resolved, missing } }`
- **`traceResolver`**: `{ async resolve(clientTraceId, agentName) => traceId|null }` —
  `agentName` is passed alongside the id so a real lookup can scope its
  query correctly (a `clientTraceId` alone isn't guaranteed unique across
  agents sharing one trace table).

### Built-in `resultsSink` adapters

| Adapter | Default? | Notes |
|---|---|---|
| `markdownSink` | Yes | Zero-config default: a fresh, timestamped `.md` file per run under `.agent-test-kit-results/` (`run-<ISO timestamp>.md`) — never overwritten, and no growing-forever single file to scroll through. Pass an explicit `filePath` to opt back into one fixed file every run appends its own `##` section to. Zero dependencies. |
| `jsonFileSink` | No | Appends one NDJSON line per row. Zero dependencies. Machine-readable. |
| `consoleSink` | No | No persistence at all — discards every row. |
| `supabaseSink` | No | Opinionated, not generic — `{supabaseUrl, supabaseServiceRoleKey}` only. Always writes to the same fixed table, `agent_test_kit_quality_scores` (schema: `sql/agent-test-kit-quality-scores-migration.sql`, run it yourself once), with the same columns, in every adopting repo — deliberate, so one dashboard/reporting tool can be built against any repo using this package. This package has no hard dependency on `@supabase/supabase-js` (lazily `require`'d, but declared as an `optionalDependency` so it resolves correctly even via a symlinked `file:` install). Insert failures warn, never fail the run — but are tracked (`getStats()`) and probed up front (`preflight()`) so a "configured but failing" DB is impossible to miss (see `docs/SPEC-sink-reliability-and-md-authoring.md` "Feature 1"). |
| `multiSink` | No | `createMultiSink([sinkA, sinkB, ...])` — fans `write()`/`finalize()` out to every sink in the list, e.g. to run `markdownSink` and `supabaseSink` together. |

## Result row schema (fixed — every `resultsSink` receives exactly this shape)

```
{
  testId: string,
  traceId: string|null,
  agentName: string,
  category: string,
  metric: string,
  score: number|null,
  pass: boolean,
  evaluator: string,
  runId: string,
  notes: object|null,
  recommendation: string|null,
  timestamp: string (ISO 8601)
}
```

This shape is the package's own canonical contract, independent of where a
given repo chooses to persist it (console/local file/its own database) —
sinks vary only in destination, never in what fields exist.
