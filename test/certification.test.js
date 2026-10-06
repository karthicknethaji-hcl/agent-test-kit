const assert = require('assert');
const path = require('path');
const { certificationWarnings, METRICS } = require('../src/core/certification');
const { validateAgent } = require('../src/core/validate');

assert.strictEqual(Object.keys(METRICS).length, 16);

// Example agent: fully covered via tags + waivers -> no warnings.
const ex = validateAgent(path.join(__dirname, '..', 'examples', 'example-agent'));
assert.ok(ex.valid, ex.errors.join('; '));
assert.deepStrictEqual(ex.warnings, []);

// Gaps, mismatches, bad waivers are all reported.
const tcs = { testCases: [{ testId: 't1', rubric: 'R1' }, { testId: 't2', rubric: 'R2' }], certWaivers: { bias: '', nope: 'x' } };
const rubrics = {
  R1: { metric: 'm', evaluatorType: 'llm_judge', certMetric: 'G', scale: '0-1', threshold: 0.5, certRationale: '', judgePromptTemplate: 'x' },
  R2: { metric: 'm', evaluatorType: 'llm_judge', certMetric: 'F', judgePromptTemplate: 'x' }
};
const w = certificationWarnings(tcs, rubrics).join('\n');
// Scoring deviations are NOT flagged; a missing rationale is.
assert.ok(!/threshold/.test(w.replace(/certRationale \(say why this threshold/g, '')));
assert.ok(/R1: certMetric G has no certRationale/.test(w));
assert.ok(/R2: certMetric F has no certRationale/.test(w));
assert.ok(/unknown category "nope"/.test(w));
assert.ok(/"bias" is waived with no reason/.test(w));
assert.ok(/certification gap: no test covers "Hallucination"/.test(w));
assert.ok(!/covers "Groundedness"/.test(w));
console.log('certification.test.js: OK');
