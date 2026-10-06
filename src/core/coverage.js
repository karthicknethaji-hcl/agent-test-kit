// Test-suite coverage report: how much of the agent's identified behavior the
// suite actually tests, and what is missing. Everything here is advisory
// (warnings, never errors) and optional: a suite with no `coverage` block
// still validates; the report just says coverage isn't computable.
//
// Data lives in test-cases.json:
//   coverage: {
//     inputs: 'spec' | 'code' | 'both',          // what the drafter was given
//     requirements: [{ id, summary, source: 'both'|'spec-only'|'code-only',
//                      specRef?, codeRef?, gapNote?,
//                      variantsNotApplicable?: { boundary: 'reason' } }],
//     uncovered: { '<reqId>': 'reason it is deliberately untested' },
//     independentPass: { reviewer, date, extraRequirements: [{ summary, ref }] },
//     minRequirementCoverage?: 0.8
//   }
//   testCase.covers: ['<reqId>', ...]   testCase.variant: happy|negative|boundary
//
// IMPORTANT: percentages measure the suite against the IDENTIFIED requirements
// inventory, not against reality. "Inventory confidence" (from the independent
// pass) is the only signal about requirements nobody extracted.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { sha256 } = require('./mdAuthoring/hash');
const { getAgentPaths } = require('./agentPaths');
const { CATEGORIES, METRICS, certCoverage } = require('./certification');

const VARIANTS = ['happy', 'negative', 'boundary'];
const DEFAULT_MIN_REQ_COVERAGE = 0.8;

function pct(n, d) {
  return d > 0 ? Math.round((100 * n) / d) : null;
}
function pctStr(n, d) {
  const p = pct(n, d);
  return p === null ? 'n/a' : p + '%';
}
function bar(n, d, width) {
  const w = width || 20;
  const filled = d > 0 ? Math.round((w * n) / d) : 0;
  return '█'.repeat(filled) + '░'.repeat(w - filled);
}
function cell(v) {
  return String(v === undefined || v === null || v === '' ? '-' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function computeCoverage(testCasesModule, rubricsConfig) {
  const tcm = testCasesModule || {};
  const rubrics = rubricsConfig || {};
  const cases = Array.isArray(tcm.testCases) ? tcm.testCases : [];
  const cov = tcm.coverage || {};
  const reqs = Array.isArray(cov.requirements) ? cov.requirements : [];
  const uncoveredMap = cov.uncovered || {};
  const inputs = cov.inputs || null;
  const indep = cov.independentPass || null;
  const minReq = typeof cov.minRequirementCoverage === 'number' ? cov.minRequirementCoverage : DEFAULT_MIN_REQ_COVERAGE;
  const warnings = [];

  // ---- requirement traceability ----
  const reqIds = new Set(reqs.map((r) => r.id));
  if (reqIds.size !== reqs.length) warnings.push('coverage.requirements has duplicate ids');
  const testsByReq = {};
  for (const r of reqs) testsByReq[r.id] = [];
  let untaggedTests = 0;
  let unvariantedTests = 0;
  for (const tc of cases) {
    const covers = Array.isArray(tc.covers) ? tc.covers : [];
    if (reqs.length && covers.length === 0) untaggedTests++;
    for (const id of covers) {
      if (!reqIds.has(id)) warnings.push(tc.testId + ': covers unknown requirement "' + id + '"');
      else {
        testsByReq[id].push(tc);
        if (!tc.variant) unvariantedTests++;
      }
    }
  }

  const rows = reqs.map((r) => {
    const tests = testsByReq[r.id];
    const na = r.variantsNotApplicable || {};
    const expected = VARIANTS.filter((v) => !na[v]);
    const present = new Set(tests.map((t) => t.variant).filter(Boolean));
    const have = expected.filter((v) => present.has(v));
    const missing = expected.filter((v) => !present.has(v));
    const waivedReason = uncoveredMap[r.id];
    let status;
    if (tests.length) status = missing.length ? 'covered, shallow' : 'covered';
    else status = waivedReason ? 'UNCOVERED (reason given)' : 'UNCOVERED';
    return {
      id: r.id, summary: r.summary, source: r.source || (inputs === 'both' ? '?' : inputs ? inputs + '-only' : '?'),
      specRef: r.specRef, codeRef: r.codeRef, gapNote: r.gapNote,
      tests: tests.map((t) => t.testId), expected, have, missing,
      waivedReason, status, isCovered: tests.length > 0, isWaivedUncovered: !tests.length && !!waivedReason
    };
  });

  for (const id of Object.keys(uncoveredMap)) {
    const row = rows.find((r) => r.id === id);
    if (!row) warnings.push('coverage.uncovered: unknown requirement "' + id + '"');
    else if (row.isCovered) warnings.push('coverage.uncovered: "' + id + '" is listed as uncovered but has tests');
    else if (!String(uncoveredMap[id] || '').trim()) warnings.push('coverage.uncovered: "' + id + '" has no reason');
  }
  for (const r of rows) {
    if (!r.isCovered && !r.isWaivedUncovered) warnings.push('requirement ' + r.id + ' has no test and no entry in coverage.uncovered');
    if (inputs === 'both' && r.source === '?') {
      warnings.push('requirement ' + r.id + ' has no "source" (both | spec-only | code-only) but inputs is "both", so the spec/code cross-check cannot place it');
    }
    if (inputs === 'both' && (r.source === 'spec-only' || r.source === 'code-only') && !String(r.gapNote || '').trim()) {
      warnings.push('requirement ' + r.id + ' is ' + r.source + ' but has no gapNote saying how to handle the spec/code mismatch');
    }
  }

  const total = rows.length;
  const coveredCount = rows.filter((r) => r.isCovered).length;
  const waivedCount = rows.filter((r) => r.isWaivedUncovered).length;
  const uncoveredCount = total - coveredCount - waivedCount;

  const depthRows = rows.filter((r) => !r.isWaivedUncovered);
  const depthExpected = depthRows.reduce((a, r) => a + r.expected.length, 0);
  const depthHave = depthRows.reduce((a, r) => a + r.have.length, 0);

  if (!reqs.length) warnings.push('no coverage.requirements inventory: requirement coverage and scenario depth cannot be computed');
  else {
    if (untaggedTests) warnings.push(untaggedTests + ' test case(s) have no "covers" requirement ids');
    if (unvariantedTests) warnings.push(unvariantedTests + ' test-to-requirement link(s) have no "variant" (happy/negative/boundary), so scenario depth is understated');
    if (total && coveredCount / total < minReq) {
      warnings.push('requirement coverage ' + pctStr(coveredCount, total) + ' is below the ' + Math.round(minReq * 100) + '% minimum');
    }
    if (!indep) warnings.push('no coverage.independentPass: the requirements inventory has not been independently checked');
  }

  // ---- inventory confidence ----
  const extras = indep && Array.isArray(indep.extraRequirements) ? indep.extraRequirements : [];
  const invConf = indep && total ? { n: total, extras: extras.length } : null;

  // ---- categories summary ----
  const catMap = new Map();
  for (const tc of cases) {
    if (!catMap.has(tc.category)) catMap.set(tc.category, { category: tc.category, ids: [], certMetrics: new Set() });
    const e = catMap.get(tc.category);
    e.ids.push(tc.testId);
    const m = rubrics[tc.rubric] && rubrics[tc.rubric].certMetric;
    if (m) e.certMetrics.add(m);
  }
  const catRows = [...catMap.values()].map((e) => ({ category: e.category, ids: e.ids, certMetrics: [...e.certMetrics] }));

  // ---- certification baseline ----
  const cert = certCoverage(tcm, rubrics);
  const certApplicable = Object.keys(CATEGORIES).length - cert.waived.length;
  const certWaivers = tcm.certWaivers || {};

  return {
    agentName: tcm.agentName, inputs, totalTests: cases.length, rows, total, coveredCount, waivedCount, uncoveredCount,
    depth: { have: depthHave, expected: depthExpected }, invConf, extras, indep,
    catRows, cert, certApplicable, certWaivers, warnings, minReq
  };
}

function headlineLines(d) {
  const L = [];
  const reqLine = d.total
    ? d.coveredCount + ' / ' + d.total + '   ' + pctStr(d.coveredCount, d.total) + '   ' + bar(d.coveredCount, d.total) +
      '  (' + d.uncoveredCount + ' uncovered' + (d.waivedCount ? ', ' + d.waivedCount + ' deliberately untested' : '') + ')'
    : 'not computable (no requirements inventory)';
  const depthLine = d.depth.expected
    ? d.depth.have + ' / ' + d.depth.expected + '   ' + pctStr(d.depth.have, d.depth.expected) + '   ' + bar(d.depth.have, d.depth.expected) +
      '  (' + (d.depth.expected - d.depth.have) + ' missing variants)'
    : 'not computable';
  const certLine = d.cert.covered.length + ' / ' + d.certApplicable + '   ' + pctStr(d.cert.covered.length, d.certApplicable) +
    '   (' + d.cert.waived.length + ' waived, ' + d.cert.gaps.length + ' gap' + (d.cert.gaps.length === 1 ? '' : 's') + ')';
  const confLine = d.invConf
    ? d.invConf.n + ' / ' + (d.invConf.n + d.invConf.extras) + '   ' + pctStr(d.invConf.n, d.invConf.n + d.invConf.extras) +
      '   (independent pass found ' + d.invConf.extras + ' requirement' + (d.invConf.extras === 1 ? '' : 's') + ' the inventory missed)'
    : 'not run (no independent pass recorded)';
  L.push('- **Requirement coverage:** ' + reqLine);
  L.push('- **Scenario depth:** ' + depthLine);
  L.push('- **Certification baseline:** ' + certLine);
  L.push('- **Inventory confidence:** ' + confLine);
  if (d.inputs === 'both') {
    const so = d.rows.filter((r) => r.source === 'spec-only').length;
    const co = d.rows.filter((r) => r.source === 'code-only').length;
    L.push('- **Spec / code cross-check:** ' + so + ' in spec but not in code, ' + co + ' in code but not in spec' + (so + co ? ' (see cross-check section)' : ''));
  } else {
    L.push('- **Spec / code cross-check:** not assessed (only ' + (d.inputs || 'one input') + ' provided)');
  }
  L.push('- **Total test cases:** ' + d.totalTests + '  |  **Open warnings:** ' + d.warnings.length);
  return L;
}

// Short block embedded at the top of test-cases.review.md (deterministic: no timestamp).
function renderSummaryBlock(d) {
  return ['> **Coverage summary** (full report: latest `results/coverage-report-*.md`)', ...headlineLines(d).map((l) => '> ' + l), ''];
}

function renderCoverageMd(d, meta) {
  const m = meta || {};
  const L = [];
  L.push('# Test Suite Coverage Report: ' + d.agentName);
  L.push('');
  L.push('- Generated: ' + (m.generatedAt || new Date().toISOString()));
  if (m.suiteHash) L.push('- Suite hash: `' + m.suiteHash + '` (report is stale if test-cases.json/rubrics.js changed since)');
  L.push('- Inputs given to the generator: ' + (d.inputs || 'not recorded'));
  L.push('');
  L.push('> Percentages measure the suite against the **identified** requirements inventory, not against reality. ' +
    'A requirement nobody extracted is invisible here; "Inventory confidence" is the only signal about that.');
  L.push('');
  L.push('## Headline');
  L.push('');
  L.push(...headlineLines(d));
  L.push('');

  L.push('## Summary by category');
  L.push('');
  L.push('| Category | Tests | Test IDs | Cert metric |');
  L.push('|---|---|---|---|');
  for (const r of d.catRows) L.push('| ' + cell(r.category) + ' | ' + r.ids.length + ' | ' + cell(r.ids.join(', ')) + ' | ' + cell(r.certMetrics.join(', ')) + ' |');
  for (const cat of d.cert.gaps) {
    const codes = Object.entries(METRICS).filter(([, v]) => v.category === cat).map(([k]) => k).join('/');
    L.push('| **' + CATEGORIES[cat] + '** | 0 | - | ' + codes + ' **GAP (no test, no waiver)** |');
  }
  for (const cat of d.cert.waived) L.push('| ' + CATEGORIES[cat] + ' | 0 | - | waived: ' + cell(d.certWaivers[cat]) + ' |');
  L.push('| **TOTAL** | **' + d.totalTests + '** | | |');
  L.push('');

  L.push('## Requirement traceability');
  L.push('');
  if (!d.rows.length) {
    L.push('_No requirements inventory in `coverage.requirements`; traceability not available._');
  } else {
    L.push('| Req | Summary | Source | Tests | Happy/Neg/Boundary | Status |');
    L.push('|---|---|---|---|---|---|');
    for (const r of d.rows) {
      const variants = VARIANTS.map((v) => (r.expected.includes(v) ? (r.have.includes(v) ? '✔' : '✘') : 'n/a')).join(' / ');
      const status = r.isWaivedUncovered ? r.status + ': ' + r.waivedReason : r.status;
      L.push('| ' + cell(r.id) + ' | ' + cell(r.summary) + ' | ' + cell(r.source) + ' | ' + cell(r.tests.join(', ')) + ' | ' + (r.isWaivedUncovered ? '-' : variants) + ' | ' + cell(status) + ' |');
    }
  }
  L.push('');

  const gaps = d.rows.filter((r) => !r.isWaivedUncovered && r.missing.length && r.isCovered);
  L.push('## Scenario depth gaps');
  L.push('');
  if (!gaps.length) L.push('_None recorded._');
  else {
    for (const r of gaps.sort((a, b) => b.missing.length - a.missing.length)) {
      L.push('- **' + r.id + '** missing: ' + r.missing.join(', '));
    }
  }
  L.push('');

  L.push('## Spec / source-code cross-check');
  L.push('');
  if (d.inputs !== 'both') {
    L.push('_Only ' + (d.inputs || 'one input') + ' was provided, so spec-vs-code gaps cannot be assessed. Provide both to enable this section._');
  } else {
    const specOnly = d.rows.filter((r) => r.source === 'spec-only');
    const codeOnly = d.rows.filter((r) => r.source === 'code-only');
    L.push('**In the spec but not implemented in the code (' + specOnly.length + '):**');
    L.push('');
    if (!specOnly.length) L.push('_None._');
    for (const r of specOnly) L.push('- ' + r.id + ': ' + cell(r.summary) + (r.specRef ? ' [spec: ' + r.specRef + ']' : '') + (r.gapNote ? ' → ' + r.gapNote : ' → **no handling noted**'));
    L.push('');
    L.push('**In the code but not in the spec (' + codeOnly.length + '):**');
    L.push('');
    if (!codeOnly.length) L.push('_None._');
    for (const r of codeOnly) L.push('- ' + r.id + ': ' + cell(r.summary) + (r.codeRef ? ' [code: ' + r.codeRef + ']' : '') + (r.gapNote ? ' → ' + r.gapNote : ' → **no handling noted**'));
  }
  L.push('');

  L.push('## Certification baseline');
  L.push('');
  L.push('Covered: ' + (d.cert.covered.map((c) => CATEGORIES[c]).join(', ') || 'none'));
  L.push('');
  L.push('Gaps: ' + (d.cert.gaps.map((c) => CATEGORIES[c]).join(', ') || 'none'));
  L.push('');
  L.push('Waived: ' + (d.cert.waived.map((c) => CATEGORIES[c] + ' (' + d.certWaivers[c] + ')').join('; ') || 'none'));
  L.push('');

  L.push('## Independent completeness pass');
  L.push('');
  if (!d.indep) L.push('_Not recorded. The Gate 1 review should re-read the spec/source without using the inventory and record any extra requirements in `coverage.independentPass`._');
  else {
    L.push('Reviewer: ' + (d.indep.reviewer || '-') + ', date: ' + (d.indep.date || '-'));
    L.push('');
    if (!d.extras.length) L.push('_No additional requirements found._');
    for (const e of d.extras) L.push('- ' + cell(e.summary) + (e.ref ? ' [' + e.ref + ']' : ''));
  }
  L.push('');

  L.push('## Open warnings');
  L.push('');
  if (!d.warnings.length) L.push('_None._');
  for (const w of d.warnings) L.push('- ' + w);
  L.push('');
  return L.join('\n');
}

function loadAgentFiles(agentDir) {
  const paths = getAgentPaths(agentDir);
  const testCasesRaw = fs.readFileSync(paths.config.testCases, 'utf8');
  const rubricsPath = path.resolve(paths.config.rubrics);
  const rubricsRaw = fs.readFileSync(rubricsPath, 'utf8');
  delete require.cache[require.resolve(rubricsPath)];
  return { paths, testCasesRaw, rubricsRaw, testCasesModule: JSON.parse(testCasesRaw), rubricsConfig: require(rubricsPath) };
}

function buildCoverageReport(agentDir) {
  const f = loadAgentFiles(agentDir);
  const data = computeCoverage(f.testCasesModule, f.rubricsConfig);
  const suiteHash = sha256(f.testCasesRaw + '\n' + f.rubricsRaw);
  const md = renderCoverageMd(data, { suiteHash });
  return { data, md, resultsDir: f.paths.results.dir, suiteHash };
}

// Same naming idea as run results (markdownSink): a new timestamped file per
// report, never overwritten. To avoid a pile of identical files from the
// several commands that call this during one onboarding (validate, render,
// sync), a report is only written when the suite hash differs from the most
// recent report's; otherwise that existing file is returned (unchanged: true).
function reportTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
}

function latestReport(resultsDir) {
  if (!fs.existsSync(resultsDir)) return null;
  const names = fs.readdirSync(resultsDir).filter((n) => /^coverage-report-.*\.md$/.test(n)).sort();
  return names.length ? path.join(resultsDir, names[names.length - 1]) : null;
}

function writeCoverageReport(agentDir) {
  const { data, md, resultsDir, suiteHash } = buildCoverageReport(agentDir);
  const latest = latestReport(resultsDir);
  if (latest && fs.readFileSync(latest, 'utf8').includes('`' + suiteHash + '`')) {
    return { file: latest, data, unchanged: true };
  }
  fs.mkdirSync(resultsDir, { recursive: true });
  const file = path.join(resultsDir, 'coverage-report-' + reportTimestamp() + '.md');
  fs.writeFileSync(file, md, 'utf8');
  return { file, data, unchanged: false };
}

// Warnings only (no file output); used by validate.
function coverageWarnings(testCasesModule, rubricsConfig) {
  return computeCoverage(testCasesModule, rubricsConfig).warnings;
}

module.exports = {
  VARIANTS, computeCoverage, renderCoverageMd, renderSummaryBlock, buildCoverageReport, writeCoverageReport, coverageWarnings
};
