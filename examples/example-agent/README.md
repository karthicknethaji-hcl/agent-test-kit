# example-agent

Bundled reference agent. It's a small, fully local/deterministic "note-taker"
— `sendMessage()` does simple string math, no network call, no credentials —
so this folder demonstrates the full file contract (`invoke-config.js`,
`test-cases.json`, `rubrics.js`, `scriptChecks.js`, `review-status.json`)
without needing anything set up first, and is what
`docs/GETTING-STARTED.md`'s walkthrough and the package's own `npm test` run
against.

Two rubrics on purpose:
- `WC1` (`script_diff`) — needs no LLM call at all.
- `TONE1` (`llm_judge`) — needs a `judgeClient` (default: `ANTHROPIC_API_KEY`).

Try it:

```
npx agent-test-kit validate example-agent
npx agent-test-kit smoke example-agent
ANTHROPIC_API_KEY=sk-... npx agent-test-kit run example-agent
```
