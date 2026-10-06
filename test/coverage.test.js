const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeCoverage, renderCoverageMd, writeCoverageReport } = require('../src/core/coverage');
const { renderAgent } = require('../src/core/mdAuthoring/render');
const { syncAgent } = require('../src/core/mdAuthoring/sync');

const tcm = {
  agentName: 'demo',
  schemaVersion: '1.0',
  certWaivers: { bias: 'No user attributes.' },
  coverage: {
    inputs: 'both',
    requirements: [
      { id: 'R1', summary: 'greeting', source: 'both', variantsNotApplicable: { boundary: 'no limit' } },
      { id: 'R2', summary: 'option count', source: 'both' },
      { id: 'R3', summary: 'dedupe', source: 'spec-only' },
      { id: 'R4', summary: 'retries', source: 'code-only', gapNote: 'Add a code-only test' },
      { id: 'R5', summary: 'size limit', source: 'both' }
    ],
    uncovered: { R5: 'not observable headlessly' },
    independentPass: { reviewer: 'pm', date: '2026-10-06', extraRequirements: [{ summary: 'undo', ref: 'spec 4.2' }] }
  },
  testCases: [
    { testId: 'T1', category: 'opening', rubric: 'A', v1Scope: true, executionMode: 'single-turn', probe: {}, covers: ['R1'], variant: 'happy' },
    { testId: 'T2', category: 'opening', rubric: 'A', v1Scope: true, executionMode: 'single-turn', probe: {}, covers: ['R1'], variant: 'negative' },
    { testId: 'T3', category: 'options', rubric: 'B', v1Scope: true, executionMode: 'single-turn', probe: {}, covers: ['R2'], variant: 'happy' },
    { testId: 'T4', category: 'misc', rubric: 'A', v1Scope: true, executionMode: 'single-turn', probe: {}, covers: ['R9'] },
    { testId: 'T5', category: 'misc', rubric: 'A', v1Scope: true, executionMode: 'single-turn', probe: {} }
  ]
};
const rubrics = {
  A: { metric: 'a', evaluatorType: 'script_diff', certMetric: 'F', certRationale: 'x' },
  B: { metric: 'b', evaluatorType: 'script_diff' }
};

const d = computeCoverage(tcm, rubrics);
// R1 covered, R2 covered, R3 uncovered, R4 uncovered, R5 deliberately untested
assert.strictEqual(d.total, 5);
assert.strictEqual(d.coveredCount, 2);
assert.strictEqual(d.waivedCount, 1);
assert.strictEqual(d.uncoveredCount, 2);
// depth over non-waived reqs (R1 expects happy+negative, R2/R3/R4 expect 3 each) = 2+3+3+3 = 11; have = R1:2 + R2:1 = 3
assert.deepStrictEqual(d.depth, { have: 3, expected: 11 });
assert.deepStrictEqual(d.invConf, { n: 5, extras: 1 });
const w = d.warnings.join('\n');
assert.ok(/T4: covers unknown requirement "R9"/.test(w));
assert.ok(/requirement R3 has no test and no entry/.test(w));
assert.ok(/requirement R3 is spec-only but has no gapNote/.test(w));
assert.ok(!/R4 is code-only but has no gapNote/.test(w));
assert.ok(/below the 80% minimum/.test(w));
assert.ok(/1 test case\(s\) have no "covers"/.test(w));

const md = renderCoverageMd(d, { generatedAt: 'now' });
assert.ok(/Spec \/ code cross-check:\*\* 1 in spec but not in code, 1 in code but not in spec/.test(md));
assert.ok(/\| \*\*TOTAL\*\* \| \*\*5\*\* \|/.test(md));
assert.ok(/In the spec but not implemented in the code \(1\)/.test(md));
assert.ok(/In the code but not in the spec \(1\)/.test(md));
assert.ok(/\*\*Hallucination\*\* \| 0 \| - \| H \*\*GAP/.test(md));

// Without a requirements inventory the report degrades gracefully.
const bare = computeCoverage({ agentName: 'x', testCases: [] }, {});
assert.ok(/not computable/.test(renderCoverageMd(bare)));

// Round trip: render -> sync keeps covers/variant/coverage, and report lands in results/.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atk-cov-'));
const cfg = path.join(tmp, 'config');
fs.mkdirSync(cfg);
fs.copyFileSync(path.join(__dirname, '..', 'examples', 'example-agent', 'config', 'invoke-config.js'), path.join(cfg, 'invoke-config.js'));
fs.copyFileSync(path.join(__dirname, '..', 'examples', 'example-agent', 'config', 'scriptChecks.js'), path.join(cfg, 'scriptChecks.js'));
fs.copyFileSync(path.join(__dirname, '..', 'examples', 'example-agent', 'config', 'rubrics.js'), path.join(cfg, 'rubrics.js'));
fs.copyFileSync(path.join(__dirname, '..', 'examples', 'example-agent', 'config', 'test-cases.json'), path.join(cfg, 'test-cases.json'));
const { testCasesMd, rubricsMd } = renderAgent(tmp);
assert.ok(/Coverage summary/.test(testCasesMd));
assert.ok(/- \*\*Covers:\*\* EX-R1/.test(testCasesMd));
const before = JSON.parse(fs.readFileSync(path.join(cfg, 'test-cases.json'), 'utf8'));
const synced = syncAgent(tmp, { testCasesMd, rubricsMd });
assert.deepStrictEqual(synced.testCasesModule.coverage, before.coverage);
assert.deepStrictEqual(synced.testCasesModule.testCases[0].covers, ['EX-R1']);
assert.strictEqual(synced.testCasesModule.testCases[0].variant, 'happy');

const { file } = writeCoverageReport(tmp);
assert.ok(/^coverage-report-.*\.md$/.test(path.basename(file)));
assert.ok(fs.existsSync(file));
assert.ok(/Spec \/ code cross-check/.test(fs.readFileSync(file, 'utf8')));

// Same suite -> no new file; changed suite -> a NEW timestamped file, old one kept.
const again = writeCoverageReport(tmp);
assert.strictEqual(again.unchanged, true);
assert.strictEqual(again.file, file);
const tcPath = path.join(cfg, 'test-cases.json');
const edited = JSON.parse(fs.readFileSync(tcPath, 'utf8'));
edited.note = 'changed';
fs.writeFileSync(tcPath, JSON.stringify(edited, null, 2));
const third = writeCoverageReport(tmp);
assert.strictEqual(third.unchanged, false);
assert.notStrictEqual(third.file, file);
assert.ok(fs.existsSync(file) && fs.existsSync(third.file));
assert.strictEqual(fs.readdirSync(path.join(tmp, 'results')).length, 2);

console.log('coverage.test.js: OK');

// Malformed coverage data must not crash validate (hard errors reported instead of a TypeError).
{
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'atk-cov-bad-'));
  const bcfg = path.join(bad, 'config');
  fs.mkdirSync(bcfg);
  for (const f of ['invoke-config.js', 'scriptChecks.js', 'rubrics.js']) fs.copyFileSync(path.join(__dirname, '..', 'examples', 'example-agent', 'config', f), path.join(bcfg, f));
  const t = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'example-agent', 'config', 'test-cases.json'), 'utf8'));
  t.coverage.requirements = [null];
  fs.writeFileSync(path.join(bcfg, 'test-cases.json'), JSON.stringify(t));
  const { validateAgent } = require('../src/core/validate');
  const r = validateAgent(bad);
  assert.strictEqual(r.valid, false);
  assert.deepStrictEqual(r.warnings, []);
  assert.doesNotThrow(() => renderAgent(bad));
}
// A requirement with no source when inputs=both is flagged.
assert.ok(/R9 has no "source"/.test(computeCoverage({ coverage: { inputs: 'both', requirements: [{ id: 'R9', summary: 's' }] }, testCases: [] }, {}).warnings.join('\n')));
console.log('coverage.test.js (robustness): OK');
