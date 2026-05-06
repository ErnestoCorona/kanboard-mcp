# Authentication modes

Kanboard MCP supports two authentication modes: **personal** (the default) and **application** (`KANBOARD_AUTH_MODE=app`). They look almost identical from the outside, but they have different identity semantics — and the right choice depends on whether a real human is in the loop.

---

## The short version

| You're using kanboard-mcp from… | Use this mode |
|---------------------------------|---------------|
| Your own editor, your own work | **Personal** |
| A team CI pipeline | **Application** |
| A Slack bot the team uses | **Application** |
| A long-running shared agent on a server | **Application** |
| A fork running integration tests against your sandbox | **Application** (cleaner audit log) |

If a human can be blamed for what happens, use personal. If no human owns the action, use application.

## How the two modes differ under the hood

Kanboard's JSON-RPC API supports two authentication patterns:

1. **Personal token over HTTP Basic auth.** Username = your Kanboard login. Password = your personal API token. The server makes API calls *as you*.
2. **Application token over HTTP Basic auth.** Username = literal string `jsonrpc` (Kanboard's protocol-level system user). Password = the application token. The server makes API calls *as the system*.

Kanboard MCP just maps `KANBOARD_AUTH_MODE` to the right basic-auth pair:

| `KANBOARD_AUTH_MODE` | HTTP `Authorization` header | Identity Kanboard sees |
|----------------------|-----------------------------|------------------------|
| `personal` (default) | `Basic base64(username:personal-token)` | The named user |
| `app` | `Basic base64(jsonrpc:application-token)` | The `jsonrpc` system user |

Everything else — tool names, schemas, response shapes — is identical between modes.

## What the server does differently per mode

Three runtime behaviors depend on the mode:

### `getMe()` at startup — only in personal mode

In personal mode, the server calls `getMe()` once at startup to verify the username/token pair is valid. If `getMe()` fails, the server exits with a structured error. The reason: catching a typo at startup is much better than discovering it later when half the tools have already half-succeeded.

In app mode, this check is skipped. There's no "me" to look up — the server is `jsonrpc`, which is a protocol-level construct, not a real user.

### `KANBOARD_USERNAME` validation

In personal mode, `KANBOARD_USERNAME` is required and must match the user the personal token belongs to.

In app mode, `KANBOARD_USERNAME` is **silently ignored**. We chose silence (rather than an error) because users frequently switch a config from personal to app mode by changing one line, and we didn't want to force them to also delete `KANBOARD_USERNAME` to make it work.

### `list_my_tasks` semantics

In personal mode, `list_my_tasks` returns tasks assigned to the named user.

In app mode, `list_my_tasks` returns nothing meaningful — the `jsonrpc` user is never assigned tasks. We don't error; we just return an empty array. The tool is technically callable but practically useless in app mode.

## Why have two modes at all?

This design wasn't accidental. Three forces shaped it:

1. **Kanboard's API genuinely has two auth styles.** We mirror the underlying capability instead of hiding it. Hiding it would force users to either always use personal tokens (bad for CI) or always use app tokens (bad for personal use, since everything would be authored by `jsonrpc`).

2. **Audit trails matter.** In a team setting, "who did what" is a real question. Personal-token usage gives Kanboard a meaningful answer. App-token usage gives a clean "this came from automation" signal. Conflating the two would muddy both.

3. **Permission scope is different.** Application tokens have admin-equivalent scope by design — they're meant for system integration. Personal tokens are bounded by the user's actual permissions. Mixing the two in one mode would create surprising authorization behavior.

## Common confusions

### "Can I use both modes from the same server process?"

No. The mode is fixed at startup by `KANBOARD_AUTH_MODE`. If you need both, run **two MCP server instances** with different env blocks, each with its own server name in the client config — see the [multi-instance recipe in Work across multiple projects](../how-to/work-across-multiple-projects.md).

### "Can I impersonate a specific user from app mode?"

Not natively. App mode acts as `jsonrpc`. Some tools (like `create_comment`) accept a `user_id` field, but Kanboard's behavior depends on its own internal rules — usually the comment is still authored by `jsonrpc` regardless of what you pass. If you need a specific human as the author, use a dedicated bot account with its own personal token.

### "Why does my CI not need `KANBOARD_USERNAME`?"

Because CI typically runs in app mode, where the username is `jsonrpc` (set internally by the server, not by you). You don't need to think about it.

### "Why does the server `getMe()` at startup in personal mode? Isn't that an extra HTTP call?"

It is. We accept the cost because:

- It's one call, once per server lifetime — totally amortized.
- It catches "wrong token" errors at startup instead of on the first user-facing tool call. The startup error is loud and pre-tool; the late error would surface confusingly inside a tool result.
- It populates a memoized identity for `list_my_tasks`, which would otherwise need its own lookup.

## Security implications

Application tokens are **server-wide superuser-equivalent credentials**. Treat them with the same operational rigor as a database admin password:

- Store in a real secrets manager — Vault, AWS Secrets Manager, GitHub Actions secrets, 1Password Connect.
- Issue **per-system tokens**, not a single shared token. Kanboard supports multiple application tokens simultaneously, so revocation can be targeted.
- Rotate on a schedule appropriate to your threat model. There's no in-memory cache to invalidate on the server side — a restart picks up the new token.
- Never put an application token in a personal repo, a `.env.example`, a code review, or a chat. The pre-commit gitleaks hook in this repo will block accidental commits.

Personal tokens are bounded by the user's permissions. They're still secrets — keep them in `.env` (gitignored) or your client's `env` block. Same blast radius as the user themself: large, but not server-wide.

## See also

- [Use application mode for bots and CI](../how-to/use-app-mode-for-bots-and-ci.md) — recipe for setting up app mode.
- [Configuration reference](../reference/configuration.md) — environment variable details.
