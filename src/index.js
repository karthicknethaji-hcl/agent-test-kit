// Programmatic library API — for a repo that wants to call into
// agent-test-kit from its own scripts/CI rather than only via the CLI.
module.exports = {
  evaluate: require('./core/evaluator').evaluate,
  runSuite: require('./core/runner').runSuite,
  validateAgent: require('./core/validate').validateAgent,
  loadAgent: require('./core/loadAgent').loadAgent,
  loadConfig: require('./core/config').loadConfig,
  reviewStatus: require('./core/reviewStatus'),
  smokeTest: require('./core/smoke').smokeTest,
  adapters: {
    createAnthropicJudgeClient: require('./adapters/judgeClients/anthropicJudgeClient').createAnthropicJudgeClient,
    createSkillJudgeClient: require('./adapters/judgeClients/skillJudgeClient').createSkillJudgeClient,
    createConsoleSink: require('./adapters/resultsSinks/consoleSink').createConsoleSink,
    createJsonFileSink: require('./adapters/resultsSinks/jsonFileSink').createJsonFileSink,
    createEnvCredentialResolver: require('./adapters/credentialResolvers/envCredentialResolver').createEnvCredentialResolver,
    createIdentityTraceResolver: require('./adapters/traceResolvers/identityTraceResolver').createIdentityTraceResolver
  }
};
