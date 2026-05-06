# Errors reference

Every tool call either succeeds with a typed result or fails with a structured error. This page documents the error envelope, the error categories, and which ones are retryable.

---

## The MCP error envelope

When a tool fails, the response follows the MCP protocol's standard error result shape:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "<one-line summary>"
    }
  ],
  "structuredContent": {
    "code": "<machine-readable code>",
    "message": "<human-readable message>",
    "details": { /* optional, error-specific */ }
  }
}
```

The `text` field is for the agent (and you) to read. The `structuredContent` block is for programmatic inspection — it's stable across versions.

## Error categories

There are four kinds of errors you'll see:

### 1. Validation errors

Raised before any HTTP call, when the input doesn't match the tool's Zod schema.

- **`code`**: `VALIDATION_ERROR`
- **`message`**: explains which field failed and why (e.g., *"`project_id` must be a positive integer"*).
- **`details.zodIssues`**: array of Zod issue objects with the exact path and reason.
- **Retryable?** No — fix the input.

### 2. Configuration errors

Raised at startup or on the first tool call, when env or `.kanboard.yaml` is wrong.

- **`code`**: `CONFIG_ERROR`
- **`message`**: explains which configuration is wrong.
- **Retryable?** No — fix the configuration and restart the server.

### 3. Kanboard API errors (`KanboardApiError`)

Raised when Kanboard's JSON-RPC layer returns an error response or an unexpected payload.

- **`code`**: `KANBOARD_API_ERROR`
- **`message`**: Kanboard's error message, passed through.
- **`details.kanboardCode`**: Kanboard's numeric error code (when present).
- **`details.method`**: the JSON-RPC method that failed.
- **Retryable?** Sometimes — see the table below.

Subtypes of `KanboardApiError` you'll see in `details.subtype`:

| Subtype | Cause | Retryable? |
|---------|-------|------------|
| `AuthError` | 401, invalid token, wrong username/token pair | No |
| `NotFoundError` | Entity (task, project, column) doesn't exist | No |
| `ValidationError` (server-side) | Kanboard rejected the payload (e.g., owner not in project) | No |
| `RateLimitError` | 429 Too Many Requests | Yes — for reads only |
| `ServerError` | 5xx (502, 503, 504) | Yes — for reads only |
| `UnknownError` | Other Kanboard responses | No |

### 4. Network / transport errors

Raised when the HTTP request itself fails (DNS, TCP, TLS, timeout).

- **`code`**: `NETWORK_ERROR`
- **`message`**: e.g., *"connect ETIMEDOUT"*, *"getaddrinfo ENOTFOUND"*.
- **`details.cause`**: the underlying Node.js error code.
- **Retryable?** Yes — for reads only.

## Retry policy summary

| Cause | Read tools (`list_*`, `get_*`) | Write tools (`create_*`, `update_*`, `move_*`, `delete_*`) |
|-------|--------------------------------|-----------------------------------------------------------|
| Network timeout / connection error | Retried | **Not retried** |
| 429 Too Many Requests | Retried with backoff | **Not retried** |
| 502 / 503 / 504 | Retried with backoff | **Not retried** |
| 4xx (other) | Not retried | Not retried |
| 401 / 403 | Not retried | Not retried |
| 5xx (other) | Not retried | Not retried |

The reason writes are never retried: a successful write request whose response was lost in transit looks identical to a failed write. We can't distinguish them from the client side, so we surface the error and let the caller decide. Reads are idempotent — retrying is always safe.

See [Retry and redaction](../explanation/retry-and-redaction.md) for the design rationale.

## Examples

### Schema rejection (validation error)

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Validation failed: priority must be ≤ 3" }],
  "structuredContent": {
    "code": "VALIDATION_ERROR",
    "message": "Input did not match schema",
    "details": {
      "zodIssues": [
        { "path": ["priority"], "code": "too_big", "maximum": 3, "received": 5 }
      ]
    }
  }
}
```

### Destructive tool without confirmation

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "delete_task requires confirmation: true" }],
  "structuredContent": {
    "code": "VALIDATION_ERROR",
    "message": "Confirmation required for destructive operation",
    "details": {
      "tool": "delete_task",
      "missingField": "confirmation"
    }
  }
}
```

### Auth failure

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Authentication failed (401)" }],
  "structuredContent": {
    "code": "KANBOARD_API_ERROR",
    "message": "Authentication failed",
    "details": {
      "subtype": "AuthError",
      "method": "getMe",
      "httpStatus": 401
    }
  }
}
```

### Kanboard NotFound

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Task #99999 not found" }],
  "structuredContent": {
    "code": "KANBOARD_API_ERROR",
    "message": "Task not found",
    "details": {
      "subtype": "NotFoundError",
      "method": "getTask",
      "task_id": 99999
    }
  }
}
```

## See also

- [Tools reference](./tools.md) for tool input/output contracts.
- [Retry and redaction](../explanation/retry-and-redaction.md) for the retry-policy rationale.
