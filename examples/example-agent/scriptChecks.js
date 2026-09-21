// Reference implementation of the scriptChecks.js contract (see
// docs/CONTRACT.md). One handler per script_diff rubric code declared in
// rubrics.js — this logic is inherently agent-specific (it checks THIS
// agent's own output shape), unlike evaluator.js's generic dispatch.
function evalWordCountAccuracy(testCase, rubric, callResult) {
  const content = (testCase.probe && testCase.probe.content) || '';
  const expected = content.trim() ? content.trim().split(/\s+/).length : 0;
  const actual = callResult.parsed && callResult.parsed.wordCount;

  if (actual !== expected) {
    return {
      pass: false,
      score: null,
      notes: { expected, actual },
      recommendation: 'wordCount was ' + actual + ', expected ' + expected + ' — check sendMessage()\'s word-splitting logic.'
    };
  }
  return { pass: true, score: null, notes: { expected, actual } };
}

module.exports = { WC1: evalWordCountAccuracy };
