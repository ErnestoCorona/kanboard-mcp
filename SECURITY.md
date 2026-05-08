# Security Policy

The Kanboard MCP project takes security seriously. This document covers how to report vulnerabilities, what to expect from us in response, and best practices for users.

## Reporting a Vulnerability

If you discover a security vulnerability in `@ernestocorona/kanboard-mcp`, **please do not open a public GitHub issue**. Instead, report it privately:

- **Email**: ernesto.coronapaez@gmail.com
- **Subject prefix**: `[security] kanboard-mcp:`

Please include:

- A clear description of the vulnerability
- Steps to reproduce (a minimal repro is ideal)
- Affected versions (output of `kanboard-mcp --version` or the version from `package.json`)
- Potential impact (what an attacker could do)
- Any suggested mitigation (optional)

You will receive an acknowledgment within **72 hours**, an initial assessment within **one week**, and a patch release as soon as possible after assessment, depending on severity.

We follow [Coordinated Disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure): please give us a reasonable window to release a fix before public disclosure. We will credit you in the release notes unless you prefer to remain anonymous.

## Supported Versions

Only the latest minor release receives security updates:

| Version  | Supported          |
| -------- | ------------------ |
| 0.3.x    | ✅                 |
| < 0.3    | ❌                 |

Once 0.4.x ships, 0.3.x will continue to receive critical security patches for **3 months** to give users a migration window.

## Best Practices for Users

These are not vulnerabilities — they are operational guidelines to reduce your attack surface.

### Token management

- **Rotate API tokens regularly.** `kanboard-mcp` does not cache tokens; new values take effect on next process start.
- **Never commit `.env` to version control.** It is gitignored by default; if you remove it from `.gitignore`, the pre-commit hook (gitleaks) will block commits with secrets anyway.
- **Use `app` mode for CI and automation** (service identity); use `personal` mode only when you explicitly want actions attributed to a specific Kanboard user.
- **Treat `KANBOARD_API_TOKEN` as a password** — full access to your Kanboard data through whatever account it is bound to.

### Network and timeouts

- **Set `KANBOARD_TIMEOUT_MS`** to a low value in untrusted contexts to prevent denial-of-service via slow Kanboard responses (default 15000 ms is sensible for most cases).
- **Verify your Kanboard URL uses HTTPS.** The server does not enforce this — it follows whatever URL you give it.

### Logging

- `kanboard-mcp` logs to **stderr only**. Stdout is reserved for the MCP protocol.
- Tokens, headers, and credentials are **automatically redacted** from every log line by Pino's redaction config.
- **Verify your log aggregator does not capture stdout** — that channel carries MCP frames and is not redacted.

### Filesystem

- **`.kanboard.yaml` walk-up** is bounded by `$HOME` and (in v0.2.6+) the git repo root. The server will not read configuration above either of those boundaries.
- **Attachment payloads are capped at 5 MB** before base64 encoding, before any HTTP request — this protects against accidental large uploads, not against malicious crafted inputs.

## Out of Scope

The following are explicitly **not** considered vulnerabilities:

- Issues caused by user-misconfiguration of `KANBOARD_URL`, `KANBOARD_API_TOKEN`, or other env variables.
- Lack of features (e.g., "the server doesn't support X auth method") — open a feature request instead.
- Behavior of the underlying Kanboard server itself — report those upstream at [kanboard/kanboard](https://github.com/kanboard/kanboard).
- DoS via supplying valid-but-expensive JSON-RPC parameters (e.g., listing 100k tasks). The server forwards what you ask for; rate-limit at the network layer if needed.

## Security Hardening Roadmap

Planned hardening items:

- **v0.3**: explicit confirmation flag for destructive tools (`delete_*`)
- **v0.4**: HTTP transport with optional mTLS support
- **v0.4**: per-tool permission scopes (allow listing without allowing mutations)
- **Future**: signed releases via [npm provenance](https://docs.npmjs.com/generating-provenance-statements) (already wired into the release workflow)

## Acknowledgments

Security researchers who report valid vulnerabilities will be credited (with consent) in:

- The release notes for the fix
- A `SECURITY-HALL-OF-FAME.md` file in the repo root (created on first credit)

Thank you for helping keep `@ernestocorona/kanboard-mcp` and its users safe.
