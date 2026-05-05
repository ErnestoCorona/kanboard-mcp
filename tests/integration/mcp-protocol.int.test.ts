/**
 * MCP protocol round-trip integration test.
 *
 * Spawns the built binary (`dist/index.js`) as a child process, communicates
 * over stdin/stdout using the MCP Stdio transport framing (newline-delimited
 * JSON-RPC), and verifies:
 *   1. `initialize` handshake completes — server announces capabilities.
 *   2. `tools/list` returns exactly 25 tools.
 *   3. ONE `tools/call` to `list_projects` (read-only) returns a non-error
 *      response.
 *
 * GATE: Same env vars as the rest of the integration suite (enforced by
 * setup.ts). The spawned process reads the same environment, so no extra
 * wiring is needed.
 *
 * PREREQUISITE: Run `npm run build` before running this test. If
 * `dist/index.js` is missing, all tests in this file are SKIPPED with a
 * clear message.
 *
 * Run:
 *   npm run build && \
 *   RUN_INTEGRATION=1 \
 *   KANBOARD_URL=https://pm.example.com \
 *   KANBOARD_API_TOKEN=<token> \
 *   KANBOARD_TEST_PROJECT_ID=<id> \
 *   npm run test:int
 */

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Dist path resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distPath = resolve(__dirname, "../../dist/index.js");
const distExists = existsSync(distPath);

// ---------------------------------------------------------------------------
// JSON-RPC frame helpers
// ---------------------------------------------------------------------------

/** Minimal JSON-RPC 2.0 request frame. */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 response frame (success or error). */
interface JsonRpcResponse {
  jsonrpc: string;
  id: number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Write a JSON-RPC request frame to the process stdin.
 * MCP Stdio transport uses newline-delimited JSON (one frame per line).
 */
function writeFrame(stdin: NodeJS.WritableStream, req: JsonRpcRequest): void {
  stdin.write(JSON.stringify(req) + "\n");
}

/**
 * Collect stdout lines from the child process until a JSON-RPC response with
 * the matching `id` arrives, or until the timeout fires.
 *
 * Returns the parsed response object.
 */
function waitForResponse(
  stdout: NodeJS.ReadableStream,
  id: number,
  timeoutMs: number,
): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for JSON-RPC response id=${String(id)}`));
    }, timeoutMs);

    const onData = (chunk: Buffer | string): void => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "") continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed) as unknown;
        } catch {
          // Non-JSON output (e.g. pino logs to stderr, not stdout) — ignore.
          continue;
        }

        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "jsonrpc" in parsed &&
          "id" in parsed &&
          (parsed as { id: unknown }).id === id
        ) {
          clearTimeout(timer);
          stdout.removeListener("data", onData);
          resolve(parsed as JsonRpcResponse);
          return;
        }
      }
    };

    stdout.on("data", onData);
  });
}

// ---------------------------------------------------------------------------
// Suite — skipped if dist/index.js is missing
// ---------------------------------------------------------------------------

describe("mcp-protocol — stdio round-trip", () => {
  if (!distExists) {
    it.skip(
      `dist/index.js not found at ${distPath} — run 'npm run build' first`,
      () => {
        // intentionally skipped
      },
    );
    // Exit the describe block early — no further tests.
    // (Returning from the describe callback body skips remaining test registrations.)
  } else {
    it(
      "initialize + tools/list + tools/call list_projects round-trip succeeds",
      async () => {
        const proc = spawn("node", [distPath], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        });

        // Collect stderr for debugging on failure (don't fail on stderr content —
        // the server writes pino logs there).
        const stderrLines: string[] = [];
        proc.stderr.on("data", (chunk: Buffer) => {
          stderrLines.push(chunk.toString("utf8"));
        });

        try {
          // ------------------------------------------------------------------
          // Step 1 — initialize handshake
          // ------------------------------------------------------------------
          const initReq: JsonRpcRequest = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "kanboard-mcp-int-test", version: "0.0.0" },
            },
          };

          writeFrame(proc.stdin, initReq);
          const initResp = await waitForResponse(proc.stdout, 1, 10_000);

          expect(initResp.error).toBeUndefined();
          expect(initResp.result).toBeDefined();

          const initResult = initResp.result as Record<string, unknown>;
          expect(typeof initResult["protocolVersion"]).toBe("string");
          expect(initResult).toHaveProperty("capabilities");

          // Send initialized notification (required by MCP spec after init handshake).
          proc.stdin.write(
            JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
          );

          // ------------------------------------------------------------------
          // Step 2 — tools/list
          // ------------------------------------------------------------------
          const toolsListReq: JsonRpcRequest = {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
          };

          writeFrame(proc.stdin, toolsListReq);
          const toolsListResp = await waitForResponse(proc.stdout, 2, 10_000);

          expect(toolsListResp.error).toBeUndefined();
          expect(toolsListResp.result).toBeDefined();

          const toolsResult = toolsListResp.result as { tools: { name: string }[] };
          expect(Array.isArray(toolsResult.tools)).toBe(true);
          // 25 tools registered (per allTools array in src/tools/index.ts)
          expect(toolsResult.tools.length).toBe(25);

          // Spot-check: critical tools must be present.
          const toolNames = toolsResult.tools.map((t) => t.name);
          expect(toolNames).toContain("list_projects");
          expect(toolNames).toContain("create_task");
          expect(toolNames).toContain("create_tasks_batch");

          // ------------------------------------------------------------------
          // Step 3 — tools/call list_projects (read-only, safe)
          // ------------------------------------------------------------------
          const callReq: JsonRpcRequest = {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "list_projects",
              arguments: {},
            },
          };

          writeFrame(proc.stdin, callReq);
          const callResp = await waitForResponse(proc.stdout, 3, 15_000);

          expect(callResp.error).toBeUndefined();
          expect(callResp.result).toBeDefined();

          // MCP tool result shape: { content: [{ type: "text", text: "..." }] }
          const callResult = callResp.result as {
            content?: { type: string; text: string }[];
            isError?: boolean;
          };

          expect(callResult.isError).toBeFalsy();
          expect(Array.isArray(callResult.content)).toBe(true);

          const contentArr = callResult.content ?? [];
          expect(contentArr.length).toBeGreaterThan(0);

          const first = contentArr[0];
          expect(first).toBeDefined();
          expect(first?.type).toBe("text");
          expect(typeof first?.text).toBe("string");

          // The text should be valid JSON (list_projects returns JSON).
          const parsed = JSON.parse(first?.text ?? "null") as unknown;
          expect(parsed).toBeDefined();
        } finally {
          // Graceful teardown — send SIGINT to let the server flush.
          proc.kill("SIGINT");

          // Wait for the process to close (max 5s).
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              proc.kill("SIGKILL");
              resolve();
            }, 5_000);

            proc.once("close", () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        }
      },
      30_000,
    );
  }
});
