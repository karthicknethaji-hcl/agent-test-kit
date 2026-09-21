// Agent Test Kit — evaluator.
// Agent-agnostic by design: scoring logic doesn't care whose output it's
// scoring. Every rubric's specifics (threshold, judge-prompt template, etc.)
// come from the calling agent's own rubrics.js — nothing here references any
// specific agent, product, or repo.
//
// Three handlers:
//   - script_diff : pure JS, no LLM call. UNLIKE llm_judge/toxicity_scan,
//                   this one's actual check logic is inherently agent-
//                   specific (there's no generic "diff" that works for every
//                   agent's output shape) — so the check functions themselves
//                   live in each agent's own scriptChecks.js, keyed by rubric
//                   code, and the caller loads and passes that module in here
//                   as `scriptChecks`. This file dispatches to whichever
//                   function the calling agent supplied — it does NOT
//                   hardcode any agent's rubric keys itself.
//   - llm_judge    : calls out via the injected callJudgeModel(prompt)
//   - toxicity_scan: same as llm_judge, run once per run across every other
//                    captured output in the run.

function fillTemplate(template, context) {
  return template.replace(/\{\{(\w+)\}\}/g, function (_, key) {
    const value = context[key];
    if (value === undefined || value === null) return '(not provided)';
    if (Array.isArray(value)) return value.length ? value.join('; ') : '(none)';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

function extractJudgeJson(rawText) {
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(rawText.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

// ── llm_judge handler ───────────────────────────────────────────────────

// Generic resolution of "what source material was the agent actually given
// to work with" — pulled from the test case's own schema fields, so any
// rubric whose judge prompt references {{sourceMaterial}} gets the real
// source instead of silently falling back to "(not provided)" when a test
// case forgets to spell it out explicitly.
function resolveSourceMaterial(testCase) {
  if (testCase.judgeContext && testCase.judgeContext.sourceMaterial) return testCase.judgeContext.sourceMaterial;
  if (testCase.probe && testCase.probe.attachedDocument && testCase.probe.attachedDocument.content != null) {
    return testCase.probe.attachedDocument.content;
  }
  if (Array.isArray(testCase.setup)) {
    const upload = testCase.setup.find(function (s) { return s.action === 'upload_document'; });
    if (upload && upload.content) return upload.content;
  }
  if (testCase.judgeContext && testCase.judgeContext.sourceDescription) return testCase.judgeContext.sourceDescription;
  if (testCase.fixtureDependency) return testCase.fixtureDependency;
  return null;
}

async function evalLlmJudge(testCase, rubric, callResult, context, callJudgeModel) {
  const jc = testCase.judgeContext || {};

  // Rubrics that declare judgeContext.scopeToSection are checked against just
  // that section's content, not the whole multi-section output — other
  // sections may contain reasonable inference beyond the literal source
  // material; that's expected, not a groundedness violation. Judging the
  // entire response against one narrow source conflates "reasonable
  // inference in the right place" with "fabrication."
  let outputForJudge = callResult.rawText;
  if (jc.scopeToSection && callResult.parsed && Array.isArray(callResult.parsed.sectionUpdates)) {
    const matching = callResult.parsed.sectionUpdates.filter(function (u) { return u && u.section === jc.scopeToSection; });
    if (matching.length) {
      outputForJudge = matching.map(function (u) { return '[' + u.section + ']\n' + u.content; }).join('\n\n');
    }
  }

  const templateContext = Object.assign(
    { output: outputForJudge, sourceMaterial: resolveSourceMaterial(testCase), expectedBehaviorNote: testCase.expectedBehaviorNote },
    jc,
    context || {}
  );
  const rubricPrompt = fillTemplate(rubric.judgePromptTemplate, templateContext);

  // The actual system prompt the agent was operating under for this call is
  // prepended here, centrally, rather than added to every rubric's own
  // judgePromptTemplate. Giving the judge this context is what lets a fail's
  // recommendation name a concrete, quotable prompt change instead of a
  // vague pointer — the judge can see exactly what current instruction
  // produced the failing behavior.
  //
  // The recommendation-enrichment instruction below is appended centrally,
  // the same way, rather than duplicated inside every rubric's own
  // judgePromptTemplate string — every rubric already asks for a
  // "recommendation" field; this just raises the bar on what that field
  // should contain, in one place. This is a suggestion for a human to review
  // and apply, not an auto-patch — nothing in this package writes to the
  // agent's own prompt source.
  const RECOMMENDATION_ENRICHMENT =
    '\n\nIf your "recommendation" field above is non-null, make it two ' +
    'things combined into that one string: (1) a specific, quotable ' +
    'instruction to add or change in the system prompt shown above that ' +
    'would have made this response pass, and (2) a short example — one ' +
    'realistic input and the corrected output it should produce with that ' +
    'change applied. Format it exactly like: \'Prompt change: <the exact ' +
    'instruction text>\\n\\nExample — Input: <short input>\\nExpected: ' +
    '<short corrected output>\'.';

  // Computed BEFORE the judge call — for a scaled rubric, the judge needs to
  // know the REAL passing bar, including any per-test-case zero-tolerance
  // override (testCase.judgeContext.strictness), to self-assess correctly.
  // Without this, a case whose rubric threshold is e.g. 0.9 but strictness:
  // 'zero-tolerance' pushes the real bar to 1.0 could have the judge score
  // 0.95, conclude — reasonably, from its own perspective — that this
  // clearly passes, and return recommendation:null; this evaluator would
  // then silently reclassify it as a fail via the invisible stricter bar,
  // leaving a failing case with no recommendation at all. Binary rubrics
  // (a hallucinated/violated/unsafe/toxic boolean field) have no numeric
  // threshold to explain, so this is scoped to scaled ones only.
  const strict = jc.strictness === 'zero-tolerance';
  const threshold = strict ? 1.0 : (rubric.threshold != null ? rubric.threshold : 0.7);
  const thresholdNote = (rubric.scale && rubric.scale !== 'binary')
    ? '\n\nThe passing bar for THIS SPECIFIC response is exactly ' + threshold + ' on the scale above' +
      (strict ? ' — this is a zero-tolerance case, so a score anywhere below ' + threshold + ' is a fail even if it would normally read as a strong response' : '') +
      '. Your "recommendation" field must be non-null whenever your own score is below this exact bar, even if the response otherwise seems reasonable.'
    : '';

  const prompt = (callResult.systemPrompt
    ? 'The agent was operating under this exact system prompt for the call being scored:\n' +
      '---\n' + callResult.systemPrompt + '\n---\n\n' + rubricPrompt
    : rubricPrompt) + thresholdNote + RECOMMENDATION_ENRICHMENT;

  const judgeRaw = await callJudgeModel(prompt);
  const judged = extractJudgeJson(judgeRaw);

  if (!judged) {
    return {
      pass: false,
      score: null,
      notes: { error: 'Judge response did not parse as JSON', judgeRaw, rawOutput: outputForJudge },
      recommendation: 'Judge response did not parse as JSON — check the judge prompt template and the raw response for malformed output.'
    };
  }
  const notes = Object.assign({ rawOutput: outputForJudge }, judged);
  // The judge itself generates this (every judgePromptTemplate should ask
  // for it) — a suggested starting point for investigation, not a verified
  // fix, same epistemic caution as the score/verdict it comes with.
  const recommendation = judged.recommendation || null;

  // Backstop: the thresholdNote above should make this unnecessary in
  // practice, but a failing case must never surface with no actionable next
  // step just because the judge didn't comply. Applied once, right before
  // returning, to every fail path below rather than duplicated in each branch.
  function withRecommendationBackstop(outcome) {
    if (outcome.pass || outcome.recommendation) return outcome;
    return Object.assign({}, outcome, {
      recommendation: 'Judge did not provide a recommendation for this fail — investigate ' +
        (rubric.metric || testCase.rubric) + ' manually. Score/verdict: ' +
        JSON.stringify({ score: outcome.score, threshold: typeof judged.score === 'number' ? threshold : undefined })
    });
  }

  // Binary rubrics use an explicit boolean field; scaled rubrics use "score".
  if (typeof judged.hallucinated === 'boolean') return withRecommendationBackstop({ pass: !judged.hallucinated, score: null, notes, recommendation });
  if (typeof judged.violated === 'boolean') return withRecommendationBackstop({ pass: !judged.violated, score: null, notes, recommendation });
  if (typeof judged.unsafe === 'boolean') return withRecommendationBackstop({ pass: !judged.unsafe, score: null, notes, recommendation });
  if (typeof judged.toxic === 'boolean') return withRecommendationBackstop({ pass: !judged.toxic, score: null, notes, recommendation });

  if (typeof judged.score === 'number') {
    return withRecommendationBackstop({ pass: judged.score >= threshold, score: judged.score, notes, recommendation });
  }

  return {
    pass: false,
    score: null,
    notes: { error: 'Judge response missing a recognized pass/fail field', judged, rawOutput: outputForJudge },
    recommendation: 'Judge response missing a recognized pass/fail field — check the judge prompt template\'s JSON contract.'
  };
}

/**
 * evaluate(testCase, rubricsConfig, callResult, context, callJudgeModel, scriptChecks)
 *   testCase       : one entry from the agent's test-cases.json
 *   rubricsConfig  : the agent's rubrics.js module
 *   callResult     : {rawText, parsed, parseError, clientTraceId, systemPrompt}
 *                    for the probe turn (single-turn/multi-turn), or an
 *                    object with {conversationA, conversationB} for
 *                    dual-conversation cases
 *   context        : execution-mode-specific extras (draftBefore/After for
 *                    multi-turn, capturedOutputs for a toxicity scan or a
 *                    script_diff background-scan case, etc.)
 *   callJudgeModel : async (promptText) => rawResponseText — injected by the
 *                    caller, not hardcoded here (keeps this file free of any
 *                    specific model/provider/proxy wiring choice)
 *   scriptChecks   : the calling agent's own scriptChecks.js module (object
 *                    keyed by rubric code, e.g. {F: fn, A1: fn}) — this file
 *                    has no agent-specific check logic of its own, only the
 *                    generic dispatch.
 */
async function evaluate(testCase, rubricsConfig, callResult, context, callJudgeModel, scriptChecks) {
  const rubric = rubricsConfig[testCase.rubric];
  if (!rubric) {
    return { pass: false, score: null, evaluator: 'unknown', notes: { error: 'No rubric found for key ' + testCase.rubric } };
  }

  switch (rubric.evaluatorType) {
    case 'script_diff': {
      const checkFn = scriptChecks && scriptChecks[testCase.rubric];
      if (typeof checkFn !== 'function') {
        return { pass: false, score: null, evaluator: 'script-diff', notes: { error: 'No script-diff handler wired for rubric ' + testCase.rubric + ' — add one to this agent\'s own scriptChecks.js.' } };
      }
      const result = await checkFn(testCase, rubric, callResult, context || {});
      return Object.assign({ evaluator: 'script-diff' }, result);
    }
    case 'llm_judge': {
      const result = await evalLlmJudge(testCase, rubric, callResult, context, callJudgeModel);
      return Object.assign({ evaluator: 'llm-judge' }, result);
    }
    case 'toxicity_scan': {
      // Run once per test run, across every other case's captured output —
      // context.allCapturedOutputs is an array of {testId, text} assembled
      // by the caller after the main pass completes.
      const findings = [];
      for (const item of (context && context.allCapturedOutputs) || []) {
        const prompt = fillTemplate(rubric.judgePromptTemplate, { output: item.text });
        const judgeRaw = await callJudgeModel(prompt);
        const judged = extractJudgeJson(judgeRaw);
        if (judged && judged.toxic) {
          findings.push({ testId: item.testId, explanation: judged.explanation, recommendation: judged.recommendation });
        }
      }
      const recommendation = findings.length
        ? 'Toxic/inappropriate language found in: ' + findings.map(function (f) { return f.testId; }).join(', ') + '. ' +
          findings.map(function (f) { return f.testId + ': ' + (f.recommendation || f.explanation || 'review the captured output'); }).join(' | ')
        : null;
      return { pass: findings.length === 0, score: null, evaluator: 'llm-judge', notes: { findings }, recommendation };
    }
    default:
      return { pass: false, score: null, evaluator: rubric.evaluatorType, notes: { error: 'Unrecognized evaluatorType: ' + rubric.evaluatorType } };
  }
}

module.exports = { evaluate };
