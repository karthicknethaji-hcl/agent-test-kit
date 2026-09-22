// Markdown -> JSON parsing + validation — the inverse of render.js. Hand-
// rolled, line-based (no Markdown AST dependency): the format is fully
// controlled by render.js (a round-trip format, not arbitrary free-form
// user Markdown), so a strict parser tied to that exact shape is appropriate.
//
// All-or-nothing: syncAgent() builds both JSON objects fully in memory and
// validates before writing either file — on any error, nothing is written.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { validateContent, requireFresh } = require('../validate');

const EXECUTION_MODES = ['single-turn', 'multi-turn', 'dual-conversation', 'background-scan', 'repeat-n'];

function parseMarkers(lines) {
  const markers = {};
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^<!--\s*agent-test-kit:([a-zA-Z0-9_-]+):(.*?)\s*-->$/);
    if (!m) break;
    markers[m[1]] = m[2].trim();
    i++;
  }
  return { markers, next: i };
}

// Finds every occurrence (in document order) of the recognized `**Label:**`
// markers, then slices the content between consecutive markers — so a
// field's captured range is always bounded by whatever OTHER known markers
// actually surround it, not just the ones the caller happens to care about.
// Callers must therefore pass the full set of labels that can appear in a
// given region, even if they only read a few of them back out.
function extractBlocks(lines, labels) {
  const wanted = new Set(labels);
  const positions = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    for (const label of wanted) {
      if (trimmed === '**' + label + ':**') positions.push({ label, index: i });
    }
  });
  positions.sort((a, b) => a.index - b.index);
  const result = {};
  for (let k = 0; k < positions.length; k++) {
    const { label, index } = positions[k];
    const endIndex = k + 1 < positions.length ? positions[k + 1].index : lines.length;
    let content = lines.slice(index + 1, endIndex);
    while (content.length && content[0].trim() === '') content.shift();
    while (content.length && content[content.length - 1].trim() === '') content.pop();
    result[label] = content;
  }
  return result;
}

function readFencedBlock(fields, label, context) {
  const content = fields[label];
  if (!content) return undefined;
  if (content.length < 2 || !content[0].trim().startsWith('```') || content[content.length - 1].trim() !== '```') {
    throw new Error(context + ': malformed fenced block for "' + label + '"');
  }
  return content.slice(1, -1).join('\n');
}

function readJsonField(fields, label, context) {
  const inner = readFencedBlock(fields, label, context);
  if (inner === undefined) return undefined;
  try {
    return JSON.parse(inner);
  } catch (e) {
    throw new Error(context + ': invalid JSON in "' + label + '" block: ' + e.message);
  }
}

function readTextField(fields, label) {
  const content = fields[label];
  if (!content) return undefined;
  return content.join('\n');
}

// Splits `lines` into one block per `#`.repeat(level) + ' ' heading,
// dropping a trailing lone "---" separator (and surrounding blank lines)
// render.js emits after every section. `stopLabels`, if given, truncates
// only the LAST block early at the first line matching one of those exact
// `**Label:**` markers — needed for "### Conversation B", whose natural
// end-of-input boundary would otherwise swallow the top-level Judge
// Context/Expected behavior/Failure mode fields render.js emits right after
// both conversations.
function splitByHeading(lines, level, stopLabels) {
  const marker = '#'.repeat(level) + ' ';
  const starts = [];
  lines.forEach((l, i) => { if (l.startsWith(marker)) starts.push(i); });
  return starts.map((start, k) => {
    let end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    if (stopLabels && k === starts.length - 1) {
      for (let i = start + 1; i < end; i++) {
        if (stopLabels.includes(lines[i].trim())) { end = i; break; }
      }
    }
    let blockLines = lines.slice(start, end);
    while (blockLines.length && blockLines[blockLines.length - 1].trim() === '') blockLines.pop();
    if (blockLines.length && blockLines[blockLines.length - 1].trim() === '---') blockLines.pop();
    while (blockLines.length && blockLines[blockLines.length - 1].trim() === '') blockLines.pop();
    return { heading: blockLines[0].slice(marker.length).trim(), lines: blockLines.slice(1) };
  });
}

function matchBullet(lines, label, context, required) {
  const re = new RegExp('^- \\*\\*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\*\\* (.*)$');
  for (const l of lines) {
    const m = l.match(re);
    if (m) return m[1].trim();
  }
  if (required) throw new Error(context + ": missing required bullet '" + label + "'");
  return undefined;
}

function parseConversation(lines, context) {
  const fields = extractBlocks(lines, ['Setup', 'Probe']);
  const conv = {};
  const setup = readJsonField(fields, 'Setup', context);
  if (setup !== undefined) conv.setup = setup;
  const probe = readJsonField(fields, 'Probe', context);
  if (probe !== undefined) conv.probe = probe;
  return conv;
}

function parseTestCaseBlock(block) {
  const testId = block.heading;
  const lines = block.lines;

  const category = matchBullet(lines, 'Category', testId, true);
  const rubric = matchBullet(lines, 'Rubric', testId, true);
  const v1ScopeRaw = matchBullet(lines, 'V1 Scope', testId, true);
  const executionMode = matchBullet(lines, 'Execution Mode', testId, true);

  if (!EXECUTION_MODES.includes(executionMode)) {
    throw new Error(testId + ': unrecognized "Execution Mode" value "' + executionMode + '" (expected one of: ' + EXECUTION_MODES.join(', ') + ')');
  }

  const testCase = { testId, category, rubric, v1Scope: v1ScopeRaw === 'true', executionMode };

  if (executionMode === 'dual-conversation') {
    const convBlocks = splitByHeading(lines, 3, ['**Judge Context:**', '**Expected behavior:**', '**Failure mode:**']);
    const convA = convBlocks.find((b) => b.heading === 'Conversation A');
    const convB = convBlocks.find((b) => b.heading === 'Conversation B');
    if (!convA || !convB) {
      throw new Error(testId + ': missing required "### Conversation A"/"### Conversation B" sections for executionMode=dual-conversation');
    }
    testCase.conversationA = parseConversation(convA.lines, testId + ':conversationA');
    testCase.conversationB = parseConversation(convB.lines, testId + ':conversationB');
  } else {
    const fields = extractBlocks(lines, ['Probe', 'Setup', 'Judge Context', 'Expected behavior', 'Failure mode']);
    if ((executionMode === 'single-turn' || executionMode === 'multi-turn') && !fields['Probe']) {
      throw new Error(testId + ": missing required 'Probe' section for executionMode=" + executionMode);
    }
    const probe = readJsonField(fields, 'Probe', testId);
    if (probe !== undefined) testCase.probe = probe;
    const setup = readJsonField(fields, 'Setup', testId);
    if (setup !== undefined) testCase.setup = setup;
  }

  // judgeContext/expectedBehaviorNote/failureModeNote are top-level fields
  // regardless of executionMode (rendered after any conversationA/B
  // subsections) — searched separately since they never collide with the
  // Probe/Setup labels used above or nested inside a conversation section.
  const extras = extractBlocks(lines, ['Judge Context', 'Expected behavior', 'Failure mode']);
  const judgeContext = readJsonField(extras, 'Judge Context', testId);
  if (judgeContext !== undefined) testCase.judgeContext = judgeContext;
  const expectedBehaviorNote = readTextField(extras, 'Expected behavior');
  if (expectedBehaviorNote !== undefined) testCase.expectedBehaviorNote = expectedBehaviorNote;
  const failureModeNote = readTextField(extras, 'Failure mode');
  if (failureModeNote !== undefined) testCase.failureModeNote = failureModeNote;

  return testCase;
}

function parseTestCasesMd(mdText) {
  const lines = mdText.split(/\r?\n/);
  const { markers, next } = parseMarkers(lines);
  if (markers.kind !== 'test-cases') {
    throw new Error('test-cases.review.md: expected an "agent-test-kit:kind:test-cases" marker, found "' + markers.kind + '"');
  }
  const agentName = markers.agent;
  const sourceHash = markers['source-hash'];

  const rest = lines.slice(next);
  const schemaLineIdx = rest.findIndex((l) => /^Schema version:/.test(l.trim()));
  if (schemaLineIdx === -1) throw new Error('test-cases.review.md: missing "Schema version:" line');
  const schemaVersion = rest[schemaLineIdx].trim().replace(/^Schema version:\s*/, '');

  const firstHeadingIdx = rest.findIndex((l) => l.startsWith('## '));
  const preambleLines = rest.slice(schemaLineIdx + 1, firstHeadingIdx === -1 ? rest.length : firstHeadingIdx);
  const preambleFields = extractBlocks(preambleLines, ['Source Doc', 'Note']);
  const sourceDoc = readTextField(preambleFields, 'Source Doc');
  const note = readTextField(preambleFields, 'Note');

  const bodyLines = firstHeadingIdx === -1 ? [] : rest.slice(firstHeadingIdx);
  const testCases = splitByHeading(bodyLines, 2).map(parseTestCaseBlock);

  const data = { agentName, schemaVersion, testCases };
  if (sourceDoc !== undefined) data.sourceDoc = sourceDoc;
  if (note !== undefined) data.note = note;

  return { data, sourceHash };
}

function parseRubricsMd(mdText) {
  const lines = mdText.split(/\r?\n/);
  const { markers, next } = parseMarkers(lines);
  if (markers.kind !== 'rubrics') {
    throw new Error('rubrics.review.md: expected an "agent-test-kit:kind:rubrics" marker, found "' + markers.kind + '"');
  }
  const sourceHash = markers['source-hash'];

  const rest = lines.slice(next);
  const firstHeadingIdx = rest.findIndex((l) => l.startsWith('## '));
  const bodyLines = firstHeadingIdx === -1 ? [] : rest.slice(firstHeadingIdx);

  const data = {};
  for (const block of splitByHeading(bodyLines, 2)) {
    const code = block.heading;
    const lines2 = block.lines;
    const metric = matchBullet(lines2, 'Metric', code, true);
    const evaluatorType = matchBullet(lines2, 'Evaluator Type', code, true);
    const rubric = { metric, evaluatorType };

    const scale = matchBullet(lines2, 'Scale', code, false);
    if (scale !== undefined) rubric.scale = scale;
    const thresholdRaw = matchBullet(lines2, 'Threshold', code, false);
    if (thresholdRaw !== undefined) rubric.threshold = Number(thresholdRaw);

    const fields = extractBlocks(lines2, ['Judge Prompt Template']);
    const judgePromptTemplate = readFencedBlock(fields, 'Judge Prompt Template', code);
    if ((evaluatorType === 'llm_judge' || evaluatorType === 'toxicity_scan') && judgePromptTemplate === undefined) {
      throw new Error(code + ": missing required 'Judge Prompt Template' section for evaluatorType=" + evaluatorType);
    }
    if (judgePromptTemplate !== undefined) rubric.judgePromptTemplate = judgePromptTemplate;

    data[code] = rubric;
  }

  return { data, sourceHash };
}

// syncAgent(agentDir, overrides?) -> { testCasesModule, rubricsConfig }
// overrides.testCasesMd/overrides.rubricsMd let callers (tests) sync
// in-memory text without touching disk for the .review.md side; the two
// JSON/JS outputs are always written to agentDir on success.
//
// Validation reuses src/core/validate.js's validateContent() (schema + rubric
// cross-references + scriptChecks.js completeness) — the exact same checks
// `agent-test-kit validate`/`run` apply — so `sync` can never succeed on
// content that the very next `validate`/`run` would then reject.
function syncAgent(agentDir, overrides) {
  const ov = overrides || {};
  const testCasesMdPath = path.join(agentDir, 'test-cases.review.md');
  const rubricsMdPath = path.join(agentDir, 'rubrics.review.md');
  const testCasesMdText = ov.testCasesMd !== undefined ? ov.testCasesMd : fs.readFileSync(testCasesMdPath, 'utf8');
  const rubricsMdText = ov.rubricsMd !== undefined ? ov.rubricsMd : fs.readFileSync(rubricsMdPath, 'utf8');

  const { data: testCasesModule } = parseTestCasesMd(testCasesMdText);
  const { data: rubricsConfig } = parseRubricsMd(rubricsMdText);

  const errors = validateContent(testCasesModule, rubricsConfig, agentDir);
  if (errors.length > 0) {
    throw new Error('sync failed — nothing written:\n  - ' + errors.join('\n  - '));
  }

  if (!ov.dryRun) {
    fs.writeFileSync(path.join(agentDir, 'test-cases.json'), JSON.stringify(testCasesModule, null, 2) + '\n', 'utf8');
    fs.writeFileSync(
      path.join(agentDir, 'rubrics.js'),
      '// Synced from rubrics.review.md by `agent-test-kit sync` — see docs/CONTRACT.md.\nmodule.exports = ' + JSON.stringify(rubricsConfig, null, 2) + ';\n',
      'utf8'
    );
  }

  return { testCasesModule, rubricsConfig };
}

// Read-only, always-succeeds staleness check: would re-syncing the CURRENT
// .review.md content actually change anything on disk? Compares the fully
// parsed MD data against the current on-disk test-cases.json/rubrics.js by
// deep structural equality (not the embedded source-hash marker, which is
// only a hash of the JSON at render/sync time and therefore blind to the
// most common case — a reviewer editing the .review.md body directly, with
// the JSON left untouched). A malformed .review.md body is itself reported
// as "stale" (something needs attention) rather than thrown.
function checkMdStaleness(agentDir) {
  const stale = [];

  const testCasesMdPath = path.join(agentDir, 'test-cases.review.md');
  const testCasesJsonPath = path.join(agentDir, 'test-cases.json');
  if (fs.existsSync(testCasesMdPath) && fs.existsSync(testCasesJsonPath)) {
    try {
      const { data: fromMd } = parseTestCasesMd(fs.readFileSync(testCasesMdPath, 'utf8'));
      const fromDisk = JSON.parse(fs.readFileSync(testCasesJsonPath, 'utf8'));
      if (!isDeepStrictEqual(fromMd, fromDisk)) stale.push('test-cases.review.md');
    } catch (e) {
      stale.push('test-cases.review.md');
    }
  }

  const rubricsMdPath = path.join(agentDir, 'rubrics.review.md');
  const rubricsPath = path.join(agentDir, 'rubrics.js');
  if (fs.existsSync(rubricsMdPath) && fs.existsSync(rubricsPath)) {
    try {
      const { data: fromMd } = parseRubricsMd(fs.readFileSync(rubricsMdPath, 'utf8'));
      const fromDisk = requireFresh(rubricsPath);
      if (!isDeepStrictEqual(fromMd, fromDisk)) stale.push('rubrics.review.md');
    } catch (e) {
      stale.push('rubrics.review.md');
    }
  }

  return stale;
}

module.exports = { parseTestCasesMd, parseRubricsMd, syncAgent, checkMdStaleness };
