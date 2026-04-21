# Security

If you believe you have found a security vulnerability in Lookout, please **do not** open a public issue with exploit details.

Instead:

1. Open a **private** security advisory on GitHub for [OrionsLock/LookOut](https://github.com/OrionsLock/LookOut/security/advisories/new) (**Security** → **Report a vulnerability**), or  
2. Contact the maintainers through the channel listed on the [OrionsLock](https://orionslock.com) site for this project.

Include enough information to reproduce the issue (versions, OS, minimal config) so we can triage quickly.

## Hardening notes (defense in depth)

- **MCP server** (`lookout-mcp`): Tool argument `cwd` is resolved to an absolute path. Set **`LOOKOUT_MCP_ROOT`** to a single parent directory (e.g. your workspace root) so tool calls cannot target arbitrary filesystem locations outside that tree.
- **Browser automation**: LLM-proposed **`navigate`** actions only allow **`http:`** and **`https:`** URLs (not `file:`, etc.). Runs still use your machine’s network privileges—treat configs and models as trusted.
- **Stored data**: SQLite rows are validated on read where it matters (e.g. step **`action`** JSON); corrupt rows degrade to a safe **`stuck`** marker instead of crashing consumers.
