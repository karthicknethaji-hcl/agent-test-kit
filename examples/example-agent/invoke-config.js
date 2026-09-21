// Reference implementation of the invoke-config.js contract (see
// docs/CONTRACT.md). This "agent" is entirely local/deterministic on
// purpose — no network call, no credentials — so the package's own
// end-to-end test and the generator skill's structural reference don't
// depend on any external service. A real agent's sendMessage() replaces the
// body below with an actual call to your agent (HTTP, SDK, CLI subprocess,
// whatever "calling your agent" means in your repo) — see
// docs/ARCHITECTURE.md "credentialResolver" for how to resolve auth/session
// values instead of hardcoding them here.
const crypto = require('crypto');

const SYSTEM_PROMPT =
  'You are a note-taking assistant. Given a note, respond with ONLY JSON: ' +
  '{"summary": "<one sentence summary>", "wordCount": <integer>}. Never be rude or dismissive about the note\'s content.';

module.exports = {
  agentName: 'example-agent',

  createConversationState() {
    return { transcript: [] };
  },

  async sendMessage(state, action) {
    const content = (action && action.content) || '';
    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
    const summary = content.length > 60 ? content.slice(0, 57) + '...' : content;
    const parsed = { summary, wordCount };

    state.transcript.push({ role: 'user', content });
    state.transcript.push({ role: 'assistant', content: JSON.stringify(parsed) });

    return {
      rawText: JSON.stringify(parsed),
      parsed,
      parseError: null,
      clientTraceId: crypto.randomUUID(),
      systemPrompt: SYSTEM_PROMPT
    };
  },

  async smokeTestAction() {
    return { content: 'Smoke test note — please acknowledge.' };
  }
};
