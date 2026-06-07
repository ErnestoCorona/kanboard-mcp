# How to debug with MCP Inspector

**You have:** Kanboard MCP installed (via `npx`, global, Docker, or source) and a valid set of credentials.

**You want:** to inspect the tool schemas, fire individual tool calls by hand, and watch the raw JSON-RPC traffic — without an AI client in the loop.

**You'll use:** the [official MCP Inspector](https://github.com/modelcontextprotocol/inspector), a browser-based debugger published by the MCP team.

---

## Why use the Inspector

When something misbehaves end-to-end through Claude Code / Cursor / Cline, it's often unclear which layer is at fault: the agent's tool choice, the MCP server, your Kanboard, or the network in between. The Inspector removes the agent from the loop entirely — you see exactly what the server returns for each tool call, with the request, response, timing, and error envelope laid out as plain JSON.

Use it when you want to:

- See the full Zod-derived input schema for a tool before wiring it into a workflow.
- Reproduce a "weird response" from your agent against a controlled input.
- Watch how `create_tasks_batch` packs 100 tasks into a single JSON-RPC array.
- Verify a fresh token actually authenticates before debugging anything else.

## The recipe

### 1. Launch the Inspector with kanboard-mcp as its child process

The Inspector spawns whatever command you pass after `--`. Point it at this server the same way your MCP client would:

```bash
KANBOARD_URL=https://your-kanboard.example.com \
KANBOARD_USERNAME=your-login \
KANBOARD_API_TOKEN=your-personal-token \
npx @modelcontextprotocol/inspector -- npx -y @ernestocorona/kanboard-mcp
```

The Inspector starts a local web UI (default `http://127.0.0.1:6274`) and a proxy (`6277`). The CLI prints both URLs and a one-time session token — open the browser link.

### 2. Connect, then explore the Tools tab

The UI auto-connects on launch. Click **Tools** in the left nav: all 39 tools appear, grouped by domain. Click any one to see:

- Its full input schema, derived from the Zod definition at startup.
- Its output schema (same source of truth).
- A live form to fill in arguments and run the call.
- The raw request / response JSON for every invocation.

Try `list_projects` first — no arguments, immediate signal that auth works end-to-end.

### 3. Fire a real call

Pick `list_tasks`, fill in `project_id`, hit **Call Tool**. The Inspector shows:

- **Request** — the JSON-RPC envelope sent to the server.
- **Response** — the parsed `result.content` (text + structured), with each task already validated against the output schema.
- **Time** — round-trip duration.

If you set `LOG_LEVEL=debug` in the launching environment, the Inspector also surfaces stderr-side log lines (token-redacted) in the Notifications tab.

## Running against the Docker image

Same idea, just swap the child command:

```bash
npx @modelcontextprotocol/inspector -- \
  docker run -i --rm \
    -e KANBOARD_URL=https://your-kanboard.example.com \
    -e KANBOARD_USERNAME=your-login \
    -e KANBOARD_API_TOKEN=your-personal-token \
    ghcr.io/ernestocorona/kanboard-mcp:latest
```

Two flags matter here, for different reasons:

- The `--` (after `inspector`) tells the Inspector CLI to stop parsing its own flags and forward everything that follows to the spawned command. Without it, the Inspector intercepts `-e KANBOARD_URL` (its own flag for setting envs in `KEY=VALUE` form) and refuses to start.
- The `-i` (on `docker run`) is mandatory — it attaches stdin so the Inspector can pipe JSON-RPC frames into the container. Without it, the container exits before the MCP handshake completes.

## Running against a local checkout

When iterating on the server itself:

```bash
npm run build
KANBOARD_URL=... KANBOARD_USERNAME=... KANBOARD_API_TOKEN=... \
  npx @modelcontextprotocol/inspector -- node dist/index.js
```

Rebuild between changes; the Inspector caches schemas from the initial `tools/list` call, so reconnect (top-right button) after rebuilding to pick up tool-shape changes.

## Application mode

For service-identity testing — bots, CI agents, shared deployments — drop `KANBOARD_USERNAME` and switch the auth mode:

```bash
KANBOARD_URL=https://your-kanboard.example.com \
KANBOARD_AUTH_MODE=app \
KANBOARD_API_TOKEN=your-application-token \
npx @modelcontextprotocol/inspector -- npx -y @ernestocorona/kanboard-mcp
```

Calls made via the Inspector under app mode are authored by the `jsonrpc` system user — exactly as they would be in production.

## Common issues

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Invalid parameter format: KANBOARD_URL. Use key=value format.` | The Inspector's own CLI parsed `-e KANBOARD_URL` instead of forwarding it to `docker` | Add `--` right after `inspector`. Everything after `--` is forwarded verbatim to the spawned command. |
| Inspector launches but no tools appear | Server exited at startup (bad env, wrong token) | Check the terminal — the server logs validation errors to stderr before exit. Most often it's `KANBOARD_URL` missing or a typo. |
| `KANBOARD_API_TOKEN environment variable is required` | Env vars aren't being passed through to the child | Set them on the line that launches the Inspector, not in a separate shell. The Inspector forwards the parent env to the spawned command. |
| Inspector shows "Connection closed" mid-call | The configured `KANBOARD_TIMEOUT_MS` was too short, the server aborted | Raise `KANBOARD_TIMEOUT_MS` (e.g. `30000`) and reconnect. The default 15 s is conservative; a slow Kanboard or large `list_tasks` may need more. |
| Browser tab loads but says "Invalid session token" | You opened the URL without the auto-generated token | Re-copy the full URL the CLI printed (`?token=...`) — the token is per-process. |
| Tool call returns `confirmation: required` error | You hit a destructive tool (`delete_*`, `remove_*`) without the flag | Set `confirmation: true` in the form before re-firing. This is enforced at the schema layer — same behavior your agent would see. |

## See also

- [Configuration reference](../reference/configuration.md) — every environment variable the server respects.
- [Errors reference](../reference/errors.md) — what each error type means when it appears in the Inspector's response pane.
- [The access-control model](../explanation/access-control.md) — why the Inspector "sees" exactly what the token's user sees in Kanboard.
