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
  "gate1": { "approved": false, "reviewer": null, "date": null, "notes": "" },
  "gate2": { "approved": false, "reviewer": null, "date": null, "notes": "" }
}
```

## Pluggable adapter interfaces

See `docs/ARCHITECTURE.md` for why each of these exists and what varies per
consuming repo.

- **`judgeClient`**: `async (promptText) => rawResponseText`
- **`resultsSink`**: `{ async write(row), verify?(result) }` — `write` is
  required; `verify` is optional, used only by `agent-test-kit smoke` to
  confirm a write actually landed if the sink wants to offer that.
- **`credentialResolver`**: `{ async resolve(agentName, varNames) => { resolved, missing } }`
- **`traceResolver`**: `{ async resolve(clientTraceId) => traceId|null }`

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
