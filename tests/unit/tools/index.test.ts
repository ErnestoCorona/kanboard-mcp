/**
 * Unit tests for src/tools/index.ts
 *
 * Strategy:
 * - `allTools` structural assertions (length, names, required fields).
 * - `registerTools` mock-server assertions (registerTool called 25×, correct names).
 * - No real McpServer or KanboardHandler constructed — fully mocked.
 *
 * Cases covered:
 * 1. allTools has exactly 25 entries.
 * 2. All 25 expected tool names are present.
 * 3. Each tool has name, description, inputSchema, and handler defined.
 * 4. registerTools calls server.registerTool exactly 25 times.
 * 5. registerTools registers each tool by its correct name.
 * 6. The registered callback delegates to the tool handler with (args, deps).
 */

import { describe, it, expect, vi } from "vitest";
import { allTools, registerTools } from "../../../src/tools/index.js";
import type { ToolDeps } from "../../../src/tools/index.js";
import type { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { Resolvers } from "../../../src/handler/resolvers.js";

// ---------------------------------------------------------------------------
// Expected tool names in alphabetical order
// ---------------------------------------------------------------------------

const EXPECTED_NAMES = [
  "add_comment",
  "add_project_user",
  "attach_file_to_task",
  "create_column",
  "create_project",
  "create_subtask",
  "create_task",
  "create_tasks_batch",
  "get_project",
  "get_task",
  "list_categories",
  "list_columns",
  "list_my_tasks",
  "list_overdue_tasks",
  "list_projects",
  "list_subtasks",
  "list_swimlanes",
  "list_tasks",
  "list_project_users",
  "move_column",
  "move_task_position",
  "update_column",
  "update_project",
  "update_subtask",
  "update_task",
] as const;

// ---------------------------------------------------------------------------
// Mock deps
// ---------------------------------------------------------------------------

const mockDeps: ToolDeps = {
  handler: {} as unknown as KanboardHandler,
  resolvers: {} as unknown as Resolvers,
};

// ---------------------------------------------------------------------------
// allTools — structural assertions
// ---------------------------------------------------------------------------

describe("allTools — structure", () => {
  it("has exactly 25 tools", () => {
    expect(allTools).toHaveLength(25);
  });

  it("contains all 25 expected tool names", () => {
    const names = allTools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([...EXPECTED_NAMES]));
  });

  it("every tool has name, description, inputSchema, and handler defined", () => {
    for (const tool of allTools) {
      expect(tool.name, `${tool.name}: name missing`).toBeTruthy();
      expect(typeof tool.name, `${tool.name}: name not string`).toBe("string");

      expect(tool.description, `${tool.name}: description missing`).toBeTruthy();
      expect(typeof tool.description, `${tool.name}: description not string`).toBe("string");

      expect(tool.inputSchema, `${tool.name}: inputSchema missing`).toBeDefined();

      expect(tool.handler, `${tool.name}: handler missing`).toBeDefined();
      expect(typeof tool.handler, `${tool.name}: handler not function`).toBe("function");
    }
  });

  it("tool names are unique", () => {
    const names = allTools.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// registerTools — mock server assertions
// ---------------------------------------------------------------------------

describe("registerTools — server registration", () => {
  function buildMockServer() {
    return {
      registerTool: vi.fn(),
    };
  }

  it("calls server.registerTool exactly 25 times", () => {
    const server = buildMockServer();

    registerTools(server as never, mockDeps);

    expect(server.registerTool).toHaveBeenCalledTimes(25);
  });

  it("registers each tool by its correct name (first arg)", () => {
    const server = buildMockServer();

    registerTools(server as never, mockDeps);

    const registeredNames = server.registerTool.mock.calls.map(
      (call) => call[0] as string,
    );

    expect(registeredNames).toEqual(expect.arrayContaining([...EXPECTED_NAMES]));
    expect(registeredNames).toHaveLength(25);
  });

  it("passes description and inputSchema in the config object (second arg)", () => {
    const server = buildMockServer();

    registerTools(server as never, mockDeps);

    for (const call of server.registerTool.mock.calls) {
      const config = call[1] as { description?: string; inputSchema?: unknown };
      expect(config, "config object must be defined").toBeDefined();
      expect(config.description, "description must be in config").toBeTruthy();
      expect(config.inputSchema, "inputSchema must be in config").toBeDefined();
    }
  });

  it("registers a callable handler as the third arg (callback)", () => {
    const server = buildMockServer();

    registerTools(server as never, mockDeps);

    for (const call of server.registerTool.mock.calls) {
      const cb = call[2] as unknown;
      expect(typeof cb, "third arg must be a function").toBe("function");
    }
  });

  it("the registered callback delegates to tool.handler with (args, deps)", async () => {
    // Use a spy on one specific tool to verify the delegation path.
    const { listProjectsTool } = await import("../../../src/tools/list-projects.js");

    const handlerSpy = vi.spyOn(listProjectsTool, "handler").mockResolvedValue({
      content: [{ type: "text", text: "[]" }],
      structuredContent: { projects: [] },
    } as never);

    const server = buildMockServer();
    registerTools(server as never, mockDeps);

    // Find the registration call for list_projects.
    const listProjectsCall = server.registerTool.mock.calls.find(
      (call) => call[0] === "list_projects",
    );
    expect(listProjectsCall, "list_projects registration not found").toBeDefined();

    // Invoke the registered callback.
    if (!listProjectsCall) {
      throw new Error("list_projects registration call not found");
    }
    const cb = listProjectsCall[2] as (args: Record<string, unknown>) => Promise<unknown>;
    const fakeArgs = {};
    await cb(fakeArgs);

    expect(handlerSpy).toHaveBeenCalledOnce();
    expect(handlerSpy).toHaveBeenCalledWith(fakeArgs, mockDeps);

    handlerSpy.mockRestore();
  });
});
