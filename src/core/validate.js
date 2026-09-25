// Schema validation — closes the "no schema exists anywhere, only the
// convention 'copy the other agent's file'" gap found while onboarding a
// second agent onto the original framework (the same class of gap that let
// evaluator.js's script_diff dispatch silently stay non-generic). Every
// agent's test-cases.json/rubrics.js is validated against a fixed JSON
// Schema before it's allowed to run.
const fs = require('fs');
const Ajv = require('ajv');

const testCaseSchema = require('./schema/testCase.schema.json');
const rubricSchema = require('./schema/rubric.schema.json');
const { getAgentPaths } = require('./agentPaths');

const ajv = new Ajv({ allErrors: true, strict: false });
const validateTestCases = ajv.compile(testCaseSchema);
const validateRubrics = ajv.compile(rubricSchema);

function formatErrors(errors) {
  return (errors || []).map((e) => (e.instancePath || '(root)') + ' ' + e.message).join('; ');
}

// require()s a module bypassing Node's module cache — needed because
// test-cases.json/rubrics.js/scriptChecks.js can be rewritten on disk by
// `agent-test-kit sync` (src/core/mdAuthoring/sync.js) within the SAME
// process (the CLI's own process, or a long-lived programmatic API
// consumer), and a plain require() would otherwise keep returning the
// content that was on disk the first time this path was required.
function requireFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

/**
 * validateContent(testCasesModule, rubricsConfig, agentDir) -> string[]
 * The part of validation that only needs the two ALREADY-LOADED objects
 * (schema, rubric cross-references, scriptChecks.js completeness) — no
 * invoke-config.js involved. Shared by validateAgent() (which additionally
 * checks invoke-config.js) and src/core/mdAuthoring/sync.js's syncAgent()
 * (which never touches invoke-config.js), so the two commands can never
 * silently disagree about what counts as valid content.
 */
function validateContent(testCasesModule, rubricsConfig, agentDir) {
  const errors = [];

  if (!validateTestCases(testCasesModule)) errors.push('test-cases.json schema: ' + formatErrors(validateTestCases.errors));
  if (!validateRubrics(rubricsConfig)) errors.push('rubrics.js schema: ' + formatErrors(validateRubrics.errors));

  if (Array.isArray(testCasesModule && testCasesModule.testCases)) {
    for (const tc of testCasesModule.testCases) {
      if (!rubricsConfig[tc.rubric]) {
        errors.push('test case ' + tc.testId + ' references rubric "' + tc.rubric + '" with no matching entry in rubrics.js');
      }
    }
  }

  const hasScriptDiff = rubricsConfig && Object.values(rubricsConfig).some((r) => r && r.evaluatorType === 'script_diff');
  if (hasScriptDiff) {
    const scriptChecksPath = getAgentPaths(agentDir).config.scriptChecks;
    if (!fs.existsSync(scriptChecksPath)) {
      errors.push('rubrics.js declares at least one script_diff rubric but scriptChecks.js is missing at ' + scriptChecksPath);
    } else {
      const scriptChecks = requireFresh(scriptChecksPath);
      for (const [code, rubric] of Object.entries(rubricsConfig)) {
        if (rubric.evaluatorType === 'script_diff' && typeof scriptChecks[code] !== 'function') {
          errors.push('scriptChecks.js has no handler function for rubric "' + code + '" (evaluatorType: script_diff)');
        }
      }
    }
  }

  return errors;
}

/**
 * validateAgent(agentDir) -> { valid: boolean, errors: string[] }
 * Validates test-cases.json + rubrics.js against schema, then cross-checks
 * that every test case's `rubric` code actually has a matching entry in
 * rubrics.js, and that invoke-config.js exports the required contract
 * functions (see docs/CONTRACT.md).
 */
function validateAgent(agentDir) {
  const paths = getAgentPaths(agentDir);
  let testCasesModule, rubricsConfig, invoke;
  try {
    testCasesModule = requireFresh(paths.config.testCases);
  } catch (e) {
    return { valid: false, errors: ['test-cases.json: ' + e.message] };
  }
  try {
    rubricsConfig = requireFresh(paths.config.rubrics);
  } catch (e) {
    return { valid: false, errors: ['rubrics.js: ' + e.message] };
  }
  try {
    invoke = requireFresh(paths.config.invokeConfig);
  } catch (e) {
    return { valid: false, errors: ['invoke-config.js: ' + e.message] };
  }

  const errors = validateContent(testCasesModule, rubricsConfig, agentDir);

  if (typeof invoke.agentName !== 'string' || !invoke.agentName) errors.push('invoke-config.js: missing string export "agentName"');
  if (typeof invoke.createConversationState !== 'function') errors.push('invoke-config.js: missing function export "createConversationState()"');
  if (typeof invoke.sendMessage !== 'function') errors.push('invoke-config.js: missing function export "async sendMessage(state, action)"');

  return { valid: errors.length === 0, errors };
}

module.exports = { validateAgent, validateContent, formatErrors, requireFresh };
