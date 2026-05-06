# Tutorial — Your first task from Claude Code

By the end of this tutorial you will have:

- ✅ Kanboard MCP wired into Claude Code
- ✅ A successful self-test against your Kanboard instance
- ✅ A new task created on your board, by an agent, from a natural-language prompt

**Time required:** about 5 minutes.

**You'll need:**
- A running Kanboard instance you can log into (cloud, self-hosted, or local Docker).
- [Claude Code](https://claude.com/claude-code) installed and working.
- Node.js ≥ 22 on your `$PATH`.

---

## 1. Get your Kanboard API token

In Kanboard, click your avatar → **My profile** → **API** tab → **Generate token**.

Copy the value. It looks like a 40-character hex string.

> **Heads up:** treat this token like a password. It can read and write everything you can see in Kanboard.

## 2. Tell Claude Code about Kanboard MCP

In your project root (or wherever you run Claude Code), create or edit `.mcp.json`:

```json
{
  "mcpServers": {
    "kanboard": {
      "command": "npx",
      "args": ["-y", "@ernestocorona/kanboard-mcp"],
      "env": {
        "KANBOARD_URL": "https://your-kanboard.example.com",
        "KANBOARD_USERNAME": "your-kanboard-login",
        "KANBOARD_API_TOKEN": "paste-the-40-char-token"
      }
    }
  }
}
```

Replace the three `your-...` values with your real ones.

> **Don't have `.mcp.json` yet?** That's fine — Claude Code will read this file on next start. You can also use `~/.claude.json` for a global configuration that applies to every project.

## 3. Verify the connection

Before bringing Claude Code in, confirm the server can talk to your Kanboard:

```bash
KANBOARD_URL=https://your-kanboard.example.com \
KANBOARD_USERNAME=your-login \
KANBOARD_API_TOKEN=your-token \
npx -y @ernestocorona/kanboard-mcp selftest
```

You should see four lines like this:

```
[ok] kanboard server version: 1.x.x
[ok] authenticated as: your-login (id=3)
[ok] visible projects: 7
[ok] selftest passed (3 checks)
```

**If you see an error**, the most common causes are:

- **`401 Unauthorized`** → token is wrong or you have a typo in the username.
- **`ENOTFOUND` / `ECONNREFUSED`** → the URL is wrong or your network can't reach the Kanboard host.
- **`KANBOARD_USERNAME is required`** → you're missing the username for personal mode (or you meant to use app mode — see [Use application mode](../how-to/use-app-mode-for-bots-and-ci.md)).

Fix the issue and re-run the command until you see `selftest passed`. Don't move on until this works — every step that follows depends on it.

## 4. Restart Claude Code

Quit and relaunch Claude Code so it picks up your `.mcp.json`. After restart, Claude Code should show **kanboard** in its MCP server list. If it doesn't, check your Claude Code log for the actual error message.

## 5. Create your first task

Open a Claude Code chat in your project and type:

> *"Using the kanboard server, list my projects and tell me which ones I have access to."*

Claude should call `list_projects` and return your project list. If you see your projects, **congratulations — the wiring works**.

Now the moment of truth:

> *"Create a task in the first project called 'Try kanboard-mcp tutorial' with priority 2 and put it in the Backlog column."*

Claude will:

1. Call `list_columns` on the chosen project to find the Backlog column id.
2. Call `create_task` with the title, priority, and column id.
3. Return the new task id.

Open Kanboard in your browser. Refresh. **You should see the task on the board, in Backlog, with priority 2.**

## What you just did

You wired your AI editor to your project board. From here on, any prompt that involves creating, listing, updating, or moving tasks can flow through Claude — no more context-switching to the Kanboard UI for routine work.

## Next steps

- **Want to bulk-import tasks from a doc or email?** → [Turn a document into a backlog](../how-to/turn-document-into-backlog.md)
- **Working on multiple repos with different boards?** → [Work across multiple projects](../how-to/work-across-multiple-projects.md)
- **Curious why some tools refuse to run without a confirmation flag?** → see the destructive-tools section in [Authentication modes](../explanation/authentication-modes.md) and the [Tools reference](../reference/tools.md).

If anything in this tutorial felt unclear, please [open an issue](https://github.com/ErnestoCorona/kanboard-mcp/issues) — tutorials should never have rough edges.
