# Retry and redaction

Two design decisions that look small but are doing heavy lifting in the background: which HTTP failures we retry, and how we keep secrets out of logs. Both are about safety — retries protect data integrity, redaction protects credentials.

---

## Why we retry only reads

The retry policy is asymmetric: idempotent reads (`list_*`, `get_*`) are retried on transient failures. Mutations (`create_*`, `update_*`, `move_*`, `delete_*`) are **never** retried, even on failures that look transient.

The asymmetry isn't conservatism — it's correctness.

### The problem with retrying writes

When you send `create_task(...)` and the connection drops before you receive a response, **you don't know whether the task was created**. From the client's perspective, "request failed" can mean:

- The request never arrived at Kanboard. The task does **not** exist. A retry is safe.
- The request arrived, Kanboard processed it, the task was created — but the response was lost on the way back. The task **does** exist. A retry creates a duplicate.

There is no way to distinguish these two cases from the client side. HTTP is not transactional, and Kanboard's API doesn't expose idempotency keys (yet — when it does, we'll revisit). Any retry strategy is gambling on which case is more likely, and the cost of being wrong is real (duplicate comments, duplicate tasks, double-charged invoices in the worst-case domain).

So we don't retry writes. The error surfaces to the caller, who can decide:

- Check Kanboard first (e.g., search for a task with the title you tried to create), then retry only if it's missing.
- Accept the failure and try again knowingly, prepared for a possible duplicate.
- Abort.

This is a deliberate cost: occasionally a transient blip will fail a write that would have succeeded on retry. We accept that cost because the alternative — silent duplicates — is much harder to debug after the fact.

### Why reads are different

`get_task(123)` always returns the same answer for the same `task_id` (modulo updates between calls). Retrying after a 503 just re-runs the same idempotent read. Worst case: you get the same task object you would have gotten anyway, a few hundred milliseconds later.

Retries on reads cover the most common transient failures:

- `502 Bad Gateway`, `503 Service Unavailable`, `504 Gateway Timeout` — almost always temporary, often resolved within a second.
- `429 Too Many Requests` — Kanboard or its proxy enforcing rate limits. Backing off is the right response.
- Network errors (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND` from a flaky DNS) — frequently transient.

The retry strategy:

- Up to **3 attempts** total (1 original + 2 retries).
- **Exponential backoff** with jitter: ~200ms, ~500ms, then surrender.
- **Never** triggered for 4xx (other than 429), 401, 403 — those are terminal.

Three attempts is enough to cover the long tail of transient failures without making the user wait noticeably long for a permanent failure.

## Redaction philosophy

The Pino logger is configured to redact secrets at every log level. This is non-negotiable, because every tool call goes through the same logging pipeline and we cannot trust ourselves to remember to scrub a token in every log statement.

### What's redacted

The redaction list, in `src/lib/logger.ts`:

- `apiToken`
- `req.headers.authorization`
- `*.token`
- `*.secret`
- `credentials.apiToken`

The wildcards mean: at any nesting depth, any property literally named `token` or `secret` is replaced with `"[Redacted]"` before the log line is serialized.

### Why this list

It's defensive. The first three cover the obvious cases — anywhere in the codebase that logs the `Authorization` header or a config object will be redacted. The wildcards cover the unobvious cases: the day someone adds `creds: { token: "..." }` to a log message, the redaction still kicks in without any code change.

### Stdout vs stderr

There's a subtle but important detail: **all logging goes to stderr**. Stdout is reserved for the MCP protocol channel — it carries JSON-RPC messages that the client parses. If anything other than the MCP wire format hits stdout, the client either parses garbage or (more likely) disconnects.

This means even if redaction failed somehow, a token couldn't leak through stdout — there's no log path to it. The only way a secret could reach stdout would be if a tool's *return value* contained it, which is why output schemas are validated too.

### What's not redacted

- **The Kanboard URL.** Not a secret. It's helpful in error messages.
- **User IDs.** Not secrets. Required for debugging "why was this assigned to user 12?".
- **Tool inputs other than tokens.** A task title might happen to contain sensitive text, but redacting all inputs would make logs useless. The user is responsible for not pasting secrets into task descriptions.

### What you should still do

The redaction is a safety net, not a license to be sloppy:

- Don't paste tokens into chat with your AI assistant. The assistant's transcript may be logged elsewhere.
- Don't commit `.env` files. The pre-commit gitleaks hook blocks accidental commits.
- Rotate tokens regularly, especially if you've shared a workstation, used a shared CI runner, or had a security incident in any tool that touches the same secret store.
- Use application tokens for non-personal work. Personal tokens are scoped to one human; revoking them is disruptive.

## Logging levels — a practical guide

The `LOG_LEVEL` env var (default `info`) controls verbosity:

| Level | Use when |
|-------|----------|
| `info` | Normal use. You see startup, tool calls, and errors. |
| `warn` | Quiet mode for shared environments. |
| `error` | CI, when you only want to see things that went wrong. |
| `debug` | Investigating an issue. You see input/output of every HTTP call (with redaction). |
| `trace` | Deep debugging. You see retry attempts, timing, internal decisions. |
| `fatal` | Almost never useful — `error` is enough. |

For "this works locally but fails in CI" debugging, the canonical move is `LOG_LEVEL=debug` in CI's env, run once, copy the relevant lines into the bug report.

## See also

- [Errors reference](../reference/errors.md) for which errors trigger retries.
- [The batch architecture](./the-batch-architecture.md) — batches inherit the same retry policy as their carrier request.
- [Configuration reference](../reference/configuration.md) for `LOG_LEVEL` and other knobs.
