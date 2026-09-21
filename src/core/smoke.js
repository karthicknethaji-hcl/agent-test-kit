// Generic smoke test — the one check that's universal across ANY agent:
// call it, get back a non-empty response. The original framework's
// smoke-test.js additionally polled two Supabase tables to confirm
// persistence happened; that check is NOT universal (most repos have no
// such trace layer), so it's made optional here: a resultsSink MAY expose
// an optional `verify(row)` method if it wants to confirm its own write
// actually landed — smokeTest() calls it only if present.
async function smokeTest({ invoke, resultsSink }) {
  const action = typeof invoke.smokeTestAction === 'function'
    ? await invoke.smokeTestAction()
    : { content: 'Smoke test probe — please acknowledge.' };

  const state = invoke.createConversationState();
  const result = await invoke.sendMessage(state, action);

  if (!result || typeof result.rawText !== 'string' || !result.rawText.trim()) {
    return { pass: false, reason: 'sendMessage() returned no rawText (or a non-string rawText).' };
  }

  if (resultsSink && typeof resultsSink.verify === 'function') {
    const verified = await resultsSink.verify(result);
    if (!verified) return { pass: false, reason: 'resultsSink.verify() reported the write could not be confirmed.' };
  }

  return { pass: true, rawText: result.rawText, clientTraceId: result.clientTraceId };
}

module.exports = { smokeTest };
