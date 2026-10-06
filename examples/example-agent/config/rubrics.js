// Reference implementation of the rubrics.js contract (see docs/CONTRACT.md).
module.exports = {
  // script_diff — pure JS check, no LLM call, no credentials needed. Handler
  // lives in scriptChecks.js, keyed by this same code "WC1".
  WC1: {
    metric: 'word-count-accuracy',
    certMetric: 'A1',
    certRationale: 'Word count is deterministic, so exact match is the right bar.',
    evaluatorType: 'script_diff'
  },

  // llm_judge — needs a judgeClient (default: ANTHROPIC_API_KEY).
  TONE1: {
    metric: 'tone-politeness',
    certMetric: 'T',
    certRationale: 'Binary: any rude/dismissive note summary is a defect; no partial credit for this toy agent.',
    evaluatorType: 'llm_judge',
    scale: 'binary',
    judgePromptTemplate:
      'Is the response rude, dismissive, or inappropriate about the note\'s ' +
      'content? Respond with ONLY JSON: {"violated": boolean, "recommendation": string|null}.\n\n' +
      'Response:\n{{output}}'
  }
};
