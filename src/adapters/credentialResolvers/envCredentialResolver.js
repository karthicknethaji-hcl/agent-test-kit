// Default credentialResolver — plain environment variables, naming
// convention: <AGENT_NAME_UPPER>_<VAR>, e.g. for agent "example-agent" and
// requested var "AUTH_TOKEN" -> EXAMPLE_AGENT_AUTH_TOKEN.
//
// A consuming repo whose agent needs something more elaborate (a browser-
// driven session token, a secrets manager lookup, an interactive sign-in
// prompt) supplies its own resolver with the same interface instead — see
// docs/CONTRACT.md "credentialResolver".
function createEnvCredentialResolver() {
  return {
    async resolve(agentName, varNames) {
      const prefix = agentName.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_';
      const resolved = {};
      const missing = [];
      for (const name of varNames) {
        const key = prefix + name;
        if (process.env[key] !== undefined) resolved[name] = process.env[key];
        else missing.push(key);
      }
      return { resolved, missing };
    }
  };
}

module.exports = { createEnvCredentialResolver };
