// Default judgeClient adapter — calls the Anthropic Messages API directly.
//
// Contract every judgeClient must satisfy:
//   async callJudgeModel(promptText) => rawResponseText
//
// This is the ONLY seam the evaluator needs. Swap this file out entirely for
// your own provider (OpenAI, a company proxy, Bedrock, etc.) — see
// docs/CONTRACT.md "judgeClient" for the interface.
//
// Requires ANTHROPIC_API_KEY. Never stores or logs the key.
function createAnthropicJudgeClient(options) {
  const opts = options || {};
  const model = opts.model || process.env.AGENT_TEST_KIT_JUDGE_MODEL || 'claude-sonnet-4-5';
  const baseUrl = opts.baseUrl || 'https://api.anthropic.com/v1/messages';

  // The API key is resolved lazily, on first actual call, not here — a run
  // filtered to only script_diff rubrics (e.g. `--only <id>`) never needs a
  // judge model at all, and shouldn't be forced to have one configured just
  // because this is the default adapter.
  return async function callJudgeModel(promptText) {
    const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'anthropicJudgeClient: no ANTHROPIC_API_KEY found. Set it in the environment, ' +
        'pass { apiKey } explicitly, or configure a different judgeClient in agent-test-kit.config.js.'
      );
    }
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        system: 'You are a strict, literal evaluator. Respond with ONLY the requested JSON object — no prose before or after it.',
        messages: [{ role: 'user', content: promptText }]
      })
    });
    const data = await res.json().catch(() => {
      throw new Error('anthropicJudgeClient: API returned non-JSON — check network/API status.');
    });
    if (data.error) throw new Error('[judge:' + data.error.type + '] ' + data.error.message);
    const block = Array.isArray(data.content) ? data.content.find((b) => b.type === 'text') : null;
    return (block && block.text) || '';
  };
}

module.exports = { createAnthropicJudgeClient };
