# The access-control model

Kanboard MCP does not implement its own permission system. Every authorization decision — *can this caller see this project, edit this task, delete this column* — is delegated to Kanboard's existing project ACL. The server is a thin protocol adapter, not a security boundary.

This document explains why that's the design, what it means in practice, and where the natural seams are for different deployment shapes.

---

## The model in one sentence

> Whatever a token's user can do in the Kanboard UI, the MCP can do. Nothing more, nothing less.

If you can't see project #42 when you log into Kanboard as Maria, then Maria's personal token can't see project #42 through this server either. There is no parallel allow-list, no role configuration in the MCP, no `--admin` flag. The token *is* the identity; Kanboard does the rest.

## How a tool call gets authorized

The flow is the same for every one of the 37 tools:

```
MCP client → kanboard-mcp → Kanboard JSON-RPC API
   (env)        (HTTP Basic           (ACL check on
   token         auth, no             every operation,
   only)         decisions)           per Kanboard's rules)
```

1. The client invokes the tool. The server validates inputs against the Zod schema (fail-fast on bad arguments).
2. The server attaches HTTP Basic auth using the configured token, and forwards the request to Kanboard's JSON-RPC endpoint.
3. Kanboard checks its own ACL: project membership, role (manager / member / viewer), per-project settings.
4. Kanboard returns either the data or a permission error. The server passes that response back to the client, unchanged in substance.

The server never inspects the user's roles, never caches permissions, never short-circuits a call. If you're curious whether a given operation will succeed, the only honest answer is "ask Kanboard" — which is what every tool call already does.

## Why we delegate

Three forces shaped this decision:

### 1. Parallel permission systems drift

The most common security failure in integration servers is exactly this: the integration ships a permission layer "for convenience", that layer goes stale when the upstream system's ACL changes, and now there are users who can do things in the integration that they can't do in the system itself — or, worse, the opposite. The MCP would have to mirror every Kanboard role, every project membership, every per-project visibility setting. Then it would have to stay in sync forever. That's a permanent maintenance burden in exchange for no real benefit, because Kanboard already enforces those rules at the API layer.

### 2. The boundary belongs at the data store

Kanboard owns the data. Kanboard knows who Maria is, what projects she belongs to, and whether she's a manager on project #42. The MCP is *upstream* of that data — it doesn't have privileged access to Kanboard's internal user model, and it shouldn't pretend to. Putting the boundary at the data store keeps the trust model honest.

### 3. Tokens already encode identity

Every Kanboard API token already carries an identity. A personal token is bound to a user; an application token is the protocol-level `jsonrpc` system user. The server doesn't need to *add* identity — it just needs to use what's already in the token correctly. Inventing a new identity layer on top would be redundant at best and contradictory at worst.

## What this means in practice

### One user per server process

The MCP is single-tenant by design. One process, one token, one identity. If you and a teammate both use Kanboard MCP from your own editors, you each run your own instance with your own credentials — that's the intended shape.

This is enforced naturally by the way MCP clients work: each client config block points at a `command` + `env` pair, and the env carries the token. Two users on two machines never share state.

### Sharing a single MCP across users is not supported in v0.3

If you want multiple humans to share one running MCP instance (e.g. a server-side deployment that several agents talk to over HTTP), the v0.3 stdio transport is the wrong tool. Personal-mode tokens identify exactly one user; app-mode tokens identify the system, not a person. Neither route gives you per-caller authorization.

This is why **multi-tenant per-user authentication via headers** is on the v0.4 roadmap. The HTTP/SSE transport will accept a per-request token (or a per-request JWT) so the same running server can act as different users for different connections — still delegating every ACL check to Kanboard, just with the token chosen at request time instead of at process startup.

### Application mode is a different identity, not a privilege escalation

It is tempting to read "application mode" as "elevated mode". It isn't. App mode means *the actor is the system, not a person*. Kanboard happens to grant `jsonrpc` admin-equivalent scope by design — but that's a property of Kanboard's user model, not something the MCP grants. If you set up a Kanboard instance where the `jsonrpc` system user has limited scope, app mode would also be limited.

The right way to think about the two modes:

- **Personal mode**: "Run this as Maria. Maria can do what Maria can do."
- **Application mode**: "Run this as the system. The system can do what the system can do."

Neither one is "more powerful in general" — they're different identities with different scopes, both still gated by Kanboard.

## Practical implications you should know

### A revoked Kanboard user instantly loses MCP access

There's no cached state to invalidate. The next tool call hits Kanboard, Kanboard rejects the credentials, the server returns the error. No restart required, no cache flush.

### Adding a teammate to a project requires no MCP changes

You add Maria to project #42 in Kanboard. The next time her MCP instance calls `list_projects()`, #42 appears. No server config update, no role grant, no environment change. The MCP didn't know about the project before and doesn't need to know about it now — Kanboard's response is the source of truth.

### Destructive tools have an extra schema-level guard

`delete_*` and `remove_*` tools refuse to run unless the caller passes `confirmation: true`. This is *not* an authorization check — it's a typo guard. Kanboard's ACL still has the final say. The guard exists because an agent issuing a "remove the duplicate column" request shouldn't accidentally wipe a non-duplicate one on a slip; it's enforced at the schema layer, before the HTTP request is built.

### Logs never expose the token

Pino structured logging redacts `apiToken`, `req.headers.authorization`, and `credentials.apiToken` at every log level. Even when debugging access issues at `LOG_LEVEL=debug`, the token never reaches stdout, stderr, or any sink. Permission errors surface as their Kanboard-side message, never as a leaked Authorization header.

## Common confusions

### "Can I restrict which tools a user can call?"

Not at the MCP layer. The 37 tools are exposed to anyone with a valid token. What each tool *does* when invoked is gated by Kanboard's ACL — so a user without write access to project #42 will get a clean permission error from `update_task`, but the tool itself remains listed.

If you need tool-level restriction (e.g. "this agent can read but not write"), the right place to enforce it is upstream of the MCP — at the agent / client level — or with a Kanboard user whose role doesn't include the relevant permissions in the first place.

### "Can the agent escalate its own permissions?"

No. The token is fixed at server startup. There is no tool that re-reads the environment, no tool that switches identities, no in-protocol way to elevate. The agent operates exactly as the configured user, for the full lifetime of the process.

### "What if I rotate a token while the server is running?"

The currently-running process keeps the old token in memory until restart. Rotate, restart the MCP instance (or restart your editor), and the new token takes effect on the next process start. There is no in-memory cache to flush separately — process restart *is* the rotation step.

### "Should each developer have their own token, or share one?"

Each developer should have their own personal token. Two reasons:

1. **Audit trail.** Kanboard logs who created which task. A shared token makes the audit log say "everyone is one person", which destroys the signal.
2. **Permission accuracy.** Each developer's token reflects exactly that developer's permissions. Sharing a token forces a lowest-common-denominator or, worse, an over-broad grant.

The cost of separate tokens is roughly zero — they're free to generate in Kanboard and trivially configured per-machine.

## See also

- [Authentication modes](./authentication-modes.md) — deep dive into personal vs application mode and what each one means at the HTTP layer.
- [Retries and redaction](./retry-and-redaction.md) — why reads retry but writes never do, and how secrets stay out of logs.
- [Use application mode for bots and CI](../how-to/use-app-mode-for-bots-and-ci.md) — recipe for service-identity deployments.
- [Configuration reference](../reference/configuration.md) — environment variables and defaults.
