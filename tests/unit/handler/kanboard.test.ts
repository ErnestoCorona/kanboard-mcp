/**
 * Unit tests for KanboardHandler (src/handler/kanboard.ts).
 *
 * Strategy: mock ApiClient with vi.fn() — no fetch, no HTTP.
 * One test file covers:
 * - getMe lifecycle (eager, cached, failure propagation)
 * - Three decoder shapes (decodeGetSingle, decodeGetList, decodeMutation)
 * - Per-method happy paths and key error branches
 * - createTasksBatch: partial failure, out-of-order response, empty input, cap validation
 */

import { describe, it, expect, vi, type Mock } from "vitest";
import { KanboardHandler } from "../../../src/handler/kanboard.js";
import type { ApiClient } from "../../../src/handler/api-client.js";
import {
  KanboardApiError,
  NotFoundError,
  ValidationError,
  AuthError,
} from "../../../src/shared/errors.js";
import { BATCH_TASK_CAP } from "../../../src/shared/constants.js";
import { createLogger } from "../../../src/shared/logger.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const RAW_USER = {
  id: "1",
  username: "testuser",
  name: "Test User",
  email: "test@example.com",
  role: "app-user",
  is_active: "1",
  is_admin: "0",
  avatar_path: null,
};

const PARSED_USER = {
  id: 1,
  username: "testuser",
  name: "Test User",
  email: "test@example.com",
  role: "app-user",
  is_active: true,
  is_admin: false,
  avatar_path: null,
};

const RAW_PROJECT = {
  id: "12",
  name: "Test Project",
  identifier: "TST",
  description: "A test project",
  is_active: "1",
  is_public: "0",
  is_private: "0",
  token: "",
  owner_id: "0",
  default_swimlane: "Default swimlane",
  show_default_swimlane: "1",
  start_date: "0",
  end_date: "0",
  url: "https://example.com/project/12",
};

const RAW_TASK = {
  id: "42",
  project_id: "12",
  title: "Fix bug",
  description: "A task",
  is_active: "1",
  column_id: "3",
  swimlane_id: "1",
  owner_id: "0",
  creator_id: "1",
  category_id: "0",
  color_id: "blue",
  position: "1",
  priority: "0",
  score: "0",
  reference: "",
  tags: [],
  date_creation: "1700000000",
  date_modification: "1700000000",
  date_due: "0",
  date_started: "0",
  date_moved: "0",
  date_completed: "0",
  url: "https://example.com/task/42",
};

const RAW_SUBTASK = {
  id: "5",
  task_id: "42",
  title: "Sub-item",
  status: "0",
  user_id: "0",
  time_estimated: "0",
  time_spent: "0",
  position: "1",
};

const RAW_COLUMN = {
  id: "3",
  project_id: "12",
  title: "In Progress",
  position: "2",
  task_limit: "0",
  description: "",
  hide_in_dashboard: "0",
};

const RAW_CATEGORY = {
  id: "7",
  project_id: "12",
  name: "Backend",
  color_id: "blue",
};

const RAW_SWIMLANE = {
  id: "1",
  project_id: "12",
  name: "Default swimlane",
  description: "",
  position: "1",
  is_active: "1",
};

// ---------------------------------------------------------------------------
// Helper: build handler with mocked ApiClient
// ---------------------------------------------------------------------------

function buildHandler(callResponses: unknown[] = [RAW_USER]): {
  handler: KanboardHandler;
  callMock: Mock<ApiClient["call"]>;
  batchMock: Mock<ApiClient["batch"]>;
} {
  const callMock = vi.fn<ApiClient["call"]>();
  const batchMock = vi.fn<ApiClient["batch"]>();

  // Default: first call (getMe) returns RAW_USER; subsequent calls use the queue
  let callIndex = 0;
  callMock.mockImplementation(() => {
    const response = callResponses[callIndex];
    callIndex++;
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve(response);
  });

  const apiClient = { call: callMock, batch: batchMock } as unknown as ApiClient;
  const logger = createLogger({ level: "silent" });
  const handler = new KanboardHandler({ apiClient, logger });

  return { handler, callMock, batchMock };
}

// ---------------------------------------------------------------------------
// getMe lifecycle
// ---------------------------------------------------------------------------

describe("getMe lifecycle", () => {
  it("resolves with parsed User on first await", async () => {
    const { handler, callMock } = buildHandler([RAW_USER]);
    const user = await handler.getMe();
    expect(user).toMatchObject(PARSED_USER);
    expect(callMock).toHaveBeenCalledWith("getMe", undefined);
  });

  it("returns the same cached promise on multiple awaits (callMock called once)", async () => {
    const { handler, callMock } = buildHandler([RAW_USER]);
    const p1 = handler.getMe();
    const p2 = handler.getMe();
    expect(p1).toBe(p2); // same promise reference
    await p1;
    await p2;
    // getMe is called once in ctor; verify call count for "getMe"
    const getMeCalls = callMock.mock.calls.filter(([method]) => method === "getMe");
    expect(getMeCalls.length).toBe(1);
  });

  it("surfaces AuthError on first await when getMe() failed with AuthError", async () => {
    const authError = new AuthError("getMe", "HTTP 401 Unauthorized");
    const { handler } = buildHandler([authError]);
    await expect(handler.getMe()).rejects.toBeInstanceOf(AuthError);
  });

  it("wraps non-AuthError getMe failures as AuthError", async () => {
    const genericError = new Error("Network failure");
    const { handler } = buildHandler([genericError]);
    await expect(handler.getMe()).rejects.toBeInstanceOf(AuthError);
  });

  it("getMeId() returns user id number", async () => {
    const { handler } = buildHandler([RAW_USER]);
    const id = await handler.getMeId();
    expect(id).toBe(1);
  });

  // Regression — Glama Docker introspection crash. When the server is run for
  // introspection only (`initialize` + `tools/list`, never a tool call) against
  // unreachable placeholder credentials, NOTHING ever awaits getMe(). That
  // never-awaited rejection must NOT bubble up as an unhandledRejection and
  // terminate the process (Node ≥15 default), which is what made Glama report
  // "Not connected".
  it("does NOT emit unhandledRejection when a failed getMe() is never awaited", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      // getMe() rejects in the ctor; deliberately never await handler.getMe().
      buildHandler([new Error("getaddrinfo ENOTFOUND kanboard.example.com")]);

      // Let the rejected background promise settle and any event fire.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(rejections).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

// ---------------------------------------------------------------------------
// Decoder: decodeGetSingle
// ---------------------------------------------------------------------------

describe("decoder: decodeGetSingle (via getProjectById)", () => {
  it("null raw → NotFoundError", async () => {
    const { handler } = buildHandler([RAW_USER, null]);
    await expect(handler.getProjectById(999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("string raw (non-null, non-object) → NotFoundError via decodeGetSingle passthrough", async () => {
    // A string is not null/undefined, so decodeGetSingle attempts Zod parse.
    // ProjectSchema.safeParse("string") fails → ValidationError.
    // But "this is not an object" treated as a string: Zod coerces differently.
    // Use a string to exercise the non-null path where Zod fails.
    const { handler: h2 } = buildHandler([RAW_USER, "this is not an object"]);
    await expect(h2.getProjectById(1)).rejects.toBeInstanceOf(ValidationError);
  });

  it("Zod parse fail on malformed object → ValidationError", async () => {
    // { malformed: true } is missing required fields — Zod will fail
    const { handler: h3 } = buildHandler([RAW_USER, { malformed: true }]);
    await expect(h3.getProjectById(1)).rejects.toBeInstanceOf(ValidationError);
  });

  it("happy path → typed Project", async () => {
    const { handler } = buildHandler([RAW_USER, RAW_PROJECT]);
    const project = await handler.getProjectById(12);
    expect(project.id).toBe(12);
    expect(project.name).toBe("Test Project");
    expect(project.identifier).toBe("TST");
    expect(typeof project.is_active).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// Decoder: decodeGetList
// ---------------------------------------------------------------------------

describe("decoder: decodeGetList (via getMyProjects)", () => {
  it("false raw → KanboardApiError", async () => {
    const { handler } = buildHandler([RAW_USER, false]);
    await expect(handler.getMyProjects()).rejects.toBeInstanceOf(KanboardApiError);
  });

  it("array with one malformed item → returns survivors, logs warn", async () => {
    const logger = createLogger({ level: "silent" });
    const warnSpy = vi.spyOn(logger, "warn");

    const callMock = vi.fn<ApiClient["call"]>();
    let idx = 0;
    const responses = [RAW_USER, [RAW_PROJECT, { broken: "no-id" }]];
    callMock.mockImplementation(() => {
      const r = responses[idx++];
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve(r as unknown);
    });
    const apiClient = { call: callMock, batch: vi.fn() } as unknown as ApiClient;
    const handler = new KanboardHandler({ apiClient, logger });

    await handler.getMe(); // flush getMe
    const projects = await handler.getMyProjects();
    // Should return only the valid project
    expect(projects.length).toBe(1);
    expect(projects[0]?.id).toBe(12);
    // Warn should have been called for the malformed item
    expect(warnSpy).toHaveBeenCalled();
  });

  it("empty array → returns empty array (not an error)", async () => {
    const { handler } = buildHandler([RAW_USER, []]);
    const projects = await handler.getMyProjects();
    expect(projects).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Decoder: decodeMutation
// ---------------------------------------------------------------------------

describe("decoder: decodeMutation (via createProject / moveTaskPosition / addProjectUser)", () => {
  it("false → KanboardApiError", async () => {
    const { handler } = buildHandler([RAW_USER, false]);
    await expect(handler.createProject({ name: "X" })).rejects.toBeInstanceOf(KanboardApiError);
  });

  it("number → returned as task_id / project_id", async () => {
    const { handler } = buildHandler([RAW_USER, 99]);
    const id = await handler.createProject({ name: "Y" });
    expect(id).toBe(99);
  });

  it("true → undefined (void mutation)", async () => {
    const { handler } = buildHandler([RAW_USER, true]);
    // addProjectUser returns void (calls decodeMutation but ignores result)
    await expect(
      handler.addProjectUser({ project_id: 1, user_id: 2, role: "project-member" }),
    ).resolves.toBeUndefined();
  });

  it("false from moveTaskPosition → KanboardApiError", async () => {
    const { handler } = buildHandler([RAW_USER, false]);
    await expect(
      handler.moveTaskPosition({ project_id: 1, task_id: 2, column_id: 3, position: 1, swimlane_id: 1 }),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});

// ---------------------------------------------------------------------------
// Projects — per-method happy paths
// ---------------------------------------------------------------------------

describe("getMyProjects", () => {
  it("calls getMyProjects with no params and returns Project[]", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, [RAW_PROJECT]]);
    const projects = await handler.getMyProjects();
    expect(callMock).toHaveBeenCalledWith("getMyProjects", undefined);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe(12);
  });
});

describe("getProjectById", () => {
  it("calls getProjectById with { project_id: 12 } and parses Project", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, RAW_PROJECT]);
    const project = await handler.getProjectById(12);
    expect(callMock).toHaveBeenCalledWith("getProjectById", { project_id: 12 });
    expect(project.id).toBe(12);
  });

  it("null → NotFoundError", async () => {
    const { handler } = buildHandler([RAW_USER, null]);
    await expect(handler.getProjectById(999)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("getProjectByName", () => {
  it("calls getProjectByName with { name } and parses Project", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, RAW_PROJECT]);
    const project = await handler.getProjectByName("Test Project");
    expect(callMock).toHaveBeenCalledWith("getProjectByName", { name: "Test Project" });
    expect(project.name).toBe("Test Project");
  });
});

describe("getProjectByIdentifier", () => {
  it("calls getProjectByIdentifier with { identifier } and parses Project", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, RAW_PROJECT]);
    const project = await handler.getProjectByIdentifier("TST");
    expect(callMock).toHaveBeenCalledWith("getProjectByIdentifier", { identifier: "TST" });
    expect(project.identifier).toBe("TST");
  });
});

describe("createProject", () => {
  it("returns project_id on success", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, 12]);
    const id = await handler.createProject({ name: "New Project" });
    expect(callMock).toHaveBeenCalledWith("createProject", { name: "New Project" });
    expect(id).toBe(12);
  });

  it("false → KanboardApiError", async () => {
    const { handler } = buildHandler([RAW_USER, false]);
    await expect(handler.createProject({ name: "New Project" })).rejects.toBeInstanceOf(KanboardApiError);
  });
});

describe("addProjectUser", () => {
  it("calls addProjectUser with correct params and defaults role to project-member", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, true]);
    await handler.addProjectUser({ project_id: 1, user_id: 2 });
    expect(callMock).toHaveBeenCalledWith("addProjectUser", {
      project_id: 1,
      user_id: 2,
      role: "project-member",
    });
  });

  it("respects explicit role", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, true]);
    await handler.addProjectUser({ project_id: 1, user_id: 2, role: "project-manager" });
    expect(callMock).toHaveBeenCalledWith("addProjectUser", {
      project_id: 1,
      user_id: 2,
      role: "project-manager",
    });
  });
});

// ---------------------------------------------------------------------------
// Tasks — per-method happy paths
// ---------------------------------------------------------------------------

describe("getAllTasks", () => {
  it("calls getAllTasks with project_id and defaults status_id to 1", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, [RAW_TASK]]);
    const tasks = await handler.getAllTasks({ project_id: 12 });
    expect(callMock).toHaveBeenCalledWith("getAllTasks", { project_id: 12, status_id: 1 });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe(42);
  });

  it("passes explicit status_id", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, []]);
    await handler.getAllTasks({ project_id: 12, status_id: 0 });
    expect(callMock).toHaveBeenCalledWith("getAllTasks", { project_id: 12, status_id: 0 });
  });
});

describe("getTask", () => {
  it("calls getTask with { task_id } and parses Task", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, RAW_TASK]);
    const task = await handler.getTask(42);
    expect(callMock).toHaveBeenCalledWith("getTask", { task_id: 42 });
    expect(task.id).toBe(42);
    expect(task.title).toBe("Fix bug");
  });

  it("null → NotFoundError", async () => {
    const { handler } = buildHandler([RAW_USER, null]);
    await expect(handler.getTask(999)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("createTask", () => {
  it("happy → returns task_id", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, 42]);
    const id = await handler.createTask({ title: "New Task", project_id: 12 });
    expect(callMock).toHaveBeenCalledWith("createTask", { title: "New Task", project_id: 12 });
    expect(id).toBe(42);
  });

  it("false → KanboardApiError", async () => {
    const { handler } = buildHandler([RAW_USER, false]);
    await expect(handler.createTask({ title: "New Task", project_id: 12 })).rejects.toBeInstanceOf(KanboardApiError);
  });
});

describe("updateTask", () => {
  it("remaps input task_id to wire id and resolves void", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, true]);
    await handler.updateTask({ task_id: 42, title: "Updated Title" });
    // Wire param remains `id` — Kanboard JSON-RPC contract.
    expect(callMock).toHaveBeenCalledWith("updateTask", { id: 42, title: "Updated Title" });
  });
});

describe("moveTaskPosition", () => {
  it("calls moveTaskPosition with all five required params", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, true]);
    await handler.moveTaskPosition({
      project_id: 12,
      task_id: 42,
      column_id: 3,
      position: 1,
      swimlane_id: 1,
    });
    expect(callMock).toHaveBeenCalledWith("moveTaskPosition", {
      project_id: 12,
      task_id: 42,
      column_id: 3,
      position: 1,
      swimlane_id: 1,
    });
  });

  it("false → KanboardApiError", async () => {
    const { handler } = buildHandler([RAW_USER, false]);
    await expect(
      handler.moveTaskPosition({ project_id: 1, task_id: 2, column_id: 3, position: 1, swimlane_id: 1 }),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});

describe("searchTasks", () => {
  it("calls searchTasks with project_id and query", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, [RAW_TASK]]);
    const tasks = await handler.searchTasks({ project_id: 12, query: "assignee:me status:open" });
    expect(callMock).toHaveBeenCalledWith("searchTasks", {
      project_id: 12,
      query: "assignee:me status:open",
    });
    expect(tasks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Personal workflow
// ---------------------------------------------------------------------------

describe("getMyDashboard", () => {
  it("returns parsed { projects, tasks, subtasks }", async () => {
    const dashRaw = {
      projects: [RAW_PROJECT],
      tasks: [RAW_TASK],
      subtasks: [RAW_SUBTASK],
    };
    const { handler, callMock } = buildHandler([RAW_USER, dashRaw]);
    const dash = await handler.getMyDashboard();
    expect(callMock).toHaveBeenCalledWith("getMyDashboard", undefined);
    expect(dash.projects).toHaveLength(1);
    expect(dash.tasks).toHaveLength(1);
    expect(dash.subtasks).toHaveLength(1);
    expect(dash.projects[0]?.id).toBe(12);
    expect(dash.tasks[0]?.id).toBe(42);
    expect(dash.subtasks[0]?.id).toBe(5);
  });

  it("handles empty sub-lists gracefully", async () => {
    const dashRaw = { projects: [], tasks: [], subtasks: [] };
    const { handler } = buildHandler([RAW_USER, dashRaw]);
    const dash = await handler.getMyDashboard();
    expect(dash.projects).toEqual([]);
    expect(dash.tasks).toEqual([]);
    expect(dash.subtasks).toEqual([]);
  });
});

describe("getMyOverdueTasks", () => {
  it("calls getMyOverdueTasks and returns Task[]", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, [RAW_TASK]]);
    const tasks = await handler.getMyOverdueTasks();
    expect(callMock).toHaveBeenCalledWith("getMyOverdueTasks", undefined);
    expect(tasks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

describe("createTaskFile", () => {
  it("sends base64 in body and returns file_id", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, 77]);
    const fileId = await handler.createTaskFile({
      project_id: 12,
      task_id: 42,
      filename: "report.pdf",
      blob_base64: "dGVzdA==",
    });
    expect(callMock).toHaveBeenCalledWith("createTaskFile", {
      project_id: 12,
      task_id: 42,
      filename: "report.pdf",
      blob: "dGVzdA==",
    });
    expect(fileId).toBe(77);
  });
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

describe("createComment", () => {
  it("auto-injects user_id from getMe cache", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, 55]);
    const commentId = await handler.createComment({ task_id: 42, content: "Hello!" });
    expect(callMock).toHaveBeenCalledWith("createComment", {
      task_id: 42,
      user_id: 1, // from PARSED_USER.id
      content: "Hello!",
    });
    expect(commentId).toBe(55);
  });

  it("surfaces AuthError when getMe() failed", async () => {
    const authErr = new AuthError("getMe", "HTTP 401");
    const { handler } = buildHandler([authErr]);
    await expect(handler.createComment({ task_id: 42, content: "Hi" })).rejects.toBeInstanceOf(AuthError);
  });
});

// ---------------------------------------------------------------------------
// Subtasks
// ---------------------------------------------------------------------------

describe("createSubtask", () => {
  it("calls createSubtask and returns subtask_id", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, 5]);
    const id = await handler.createSubtask({ task_id: 42, title: "Do the thing" });
    expect(callMock).toHaveBeenCalledWith("createSubtask", { task_id: 42, title: "Do the thing" });
    expect(id).toBe(5);
  });

  it("false → KanboardApiError", async () => {
    const { handler } = buildHandler([RAW_USER, false]);
    await expect(handler.createSubtask({ task_id: 42, title: "X" })).rejects.toBeInstanceOf(KanboardApiError);
  });
});

describe("updateSubtask", () => {
  it("remaps input subtask_id to wire id and resolves void", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, true]);
    await handler.updateSubtask({ subtask_id: 5, task_id: 42, status: 1 });
    // Wire param remains `id` — Kanboard JSON-RPC contract.
    expect(callMock).toHaveBeenCalledWith("updateSubtask", { id: 5, task_id: 42, status: 1 });
  });
});

describe("getAllSubtasks", () => {
  it("calls getAllSubtasks with { task_id } and parses array", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, [RAW_SUBTASK]]);
    const subs = await handler.getAllSubtasks(42);
    expect(callMock).toHaveBeenCalledWith("getAllSubtasks", { task_id: 42 });
    expect(subs).toHaveLength(1);
    expect(subs[0]?.id).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

describe("getColumns", () => {
  it("calls getColumns with { project_id } and parses Column[]", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, [RAW_COLUMN]]);
    const cols = await handler.getColumns(12);
    expect(callMock).toHaveBeenCalledWith("getColumns", { project_id: 12 });
    expect(cols).toHaveLength(1);
    expect(cols[0]?.title).toBe("In Progress");
  });
});

describe("getAllCategories", () => {
  it("calls getAllCategories with { project_id } and parses Category[]", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, [RAW_CATEGORY]]);
    const cats = await handler.getAllCategories(12);
    expect(callMock).toHaveBeenCalledWith("getAllCategories", { project_id: 12 });
    expect(cats).toHaveLength(1);
    expect(cats[0]?.name).toBe("Backend");
  });
});

describe("getProjectUsers", () => {
  it("calls getProjectUsers with { project_id } and parses ProjectMember[]", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, { 1: "admin", 2: "alice" }]);
    const members = await handler.getProjectUsers(12);
    expect(callMock).toHaveBeenCalledWith("getProjectUsers", { project_id: 12 });
    expect(members).toEqual([
      { user_id: 1, username: "admin" },
      { user_id: 2, username: "alice" },
    ]);
  });

  it("sorts members by user_id ascending", async () => {
    const { handler } = buildHandler([RAW_USER, { 7: "g", 3: "c", 1: "a" }]);
    const members = await handler.getProjectUsers(12);
    expect(members.map((m) => m.user_id)).toEqual([1, 3, 7]);
  });

  it("returns empty array when project has no members", async () => {
    const { handler } = buildHandler([RAW_USER, {}]);
    const members = await handler.getProjectUsers(12);
    expect(members).toEqual([]);
  });

  it("drops malformed user_id keys (NaN, zero, negative)", async () => {
    const { handler } = buildHandler([
      RAW_USER,
      { 1: "alice", "not-a-number": "x", 0: "zero", "-5": "neg" },
    ]);
    const members = await handler.getProjectUsers(12);
    expect(members).toEqual([{ user_id: 1, username: "alice" }]);
  });

  it("drops non-string username values", async () => {
    const { handler } = buildHandler([RAW_USER, { 1: "alice", 2: 42, 3: null }]);
    const members = await handler.getProjectUsers(12);
    expect(members).toEqual([{ user_id: 1, username: "alice" }]);
  });

  it("throws KanboardApiError when raw is false", async () => {
    const { handler } = buildHandler([RAW_USER, false]);
    await expect(handler.getProjectUsers(12)).rejects.toBeInstanceOf(KanboardApiError);
  });

  it("throws KanboardApiError when raw is null", async () => {
    const { handler } = buildHandler([RAW_USER, null]);
    await expect(handler.getProjectUsers(12)).rejects.toBeInstanceOf(KanboardApiError);
  });

  it("throws KanboardApiError when raw is an array (not a dict)", async () => {
    const { handler } = buildHandler([RAW_USER, ["a", "b"]]);
    await expect(handler.getProjectUsers(12)).rejects.toBeInstanceOf(KanboardApiError);
  });
});

describe("getActiveSwimlanes", () => {
  it("calls getActiveSwimlanes with { project_id } and parses Swimlane[]", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, [RAW_SWIMLANE]]);
    const lanes = await handler.getActiveSwimlanes(12);
    expect(callMock).toHaveBeenCalledWith("getActiveSwimlanes", { project_id: 12 });
    expect(lanes).toHaveLength(1);
    expect(lanes[0]?.name).toBe("Default swimlane");
  });
});

describe("getAllSwimlanes", () => {
  it("calls getAllSwimlanes with { project_id } and parses Swimlane[]", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, [RAW_SWIMLANE]]);
    const lanes = await handler.getAllSwimlanes(12);
    expect(callMock).toHaveBeenCalledWith("getAllSwimlanes", { project_id: 12 });
    expect(lanes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// createTasksBatch — CRITICAL section
// ---------------------------------------------------------------------------

describe("createTasksBatch", () => {
  const makeItem = (n: number) => ({ title: `Task ${String(n)}`, description: `Desc ${String(n)}` });

  it("empty array input → returns { created: [], failed: [] } without calling batch", async () => {
    const { handler, batchMock } = buildHandler([RAW_USER]);
    const result = await handler.createTasksBatch(12, []);
    expect(batchMock).not.toHaveBeenCalled();
    expect(result.created).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("item count over BATCH_TASK_CAP → ValidationError before calling batch", async () => {
    const { handler, batchMock } = buildHandler([RAW_USER]);
    const items = Array.from({ length: BATCH_TASK_CAP + 1 }, (_, i) => makeItem(i));
    await expect(handler.createTasksBatch(12, items)).rejects.toBeInstanceOf(ValidationError);
    expect(batchMock).not.toHaveBeenCalled();
  });

  it("happy path — 3 items, all succeed → created[0,1,2], failed empty", async () => {
    const { handler, batchMock } = buildHandler([RAW_USER]);
    // Simulate batch returning in-order results
    batchMock.mockResolvedValueOnce([
      { ok: true, index: 0, result: 101 },
      { ok: true, index: 1, result: 102 },
      { ok: true, index: 2, result: 103 },
    ]);

    const items = [makeItem(0), makeItem(1), makeItem(2)];
    const result = await handler.createTasksBatch(12, items);

    expect(result.created).toHaveLength(3);
    expect(result.failed).toHaveLength(0);
    expect(result.created[0]).toMatchObject({ index: 0, task_id: 101, title: "Task 0" });
    expect(result.created[1]).toMatchObject({ index: 1, task_id: 102, title: "Task 1" });
    expect(result.created[2]).toMatchObject({ index: 2, task_id: 103, title: "Task 2" });
  });

  it("mixed: item index 1 fails (ok:false) → created has 0,2; failed has 1", async () => {
    const { handler, batchMock } = buildHandler([RAW_USER]);
    batchMock.mockResolvedValueOnce([
      { ok: true, index: 0, result: 201 },
      { ok: false, index: 1, error: { code: -32602, message: "Invalid params" } },
      { ok: true, index: 2, result: 203 },
    ]);

    const items = [makeItem(0), makeItem(1), makeItem(2)];
    const result = await handler.createTasksBatch(12, items);

    expect(result.created).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
    expect(result.created[0]).toMatchObject({ index: 0, task_id: 201 });
    expect(result.created[1]).toMatchObject({ index: 2, task_id: 203 });
    expect(result.failed[0]).toMatchObject({ index: 1, title: "Task 1" });
    expect(result.failed[0]?.error.message).toBe("Invalid params");
  });

  it("out-of-order response: ids [2,0,1] → created sorted by original input index [0,1,2]", async () => {
    const { handler, batchMock } = buildHandler([RAW_USER]);
    // api-client returns results sorted by id already (api-client aligns by id)
    // but here we test that our handler produces sorted output regardless
    batchMock.mockResolvedValueOnce([
      { ok: true, index: 2, result: 303 },
      { ok: true, index: 0, result: 301 },
      { ok: true, index: 1, result: 302 },
    ]);

    const items = [makeItem(0), makeItem(1), makeItem(2)];
    const result = await handler.createTasksBatch(12, items);

    expect(result.created).toHaveLength(3);
    // Sorted by original input index
    expect(result.created[0]).toMatchObject({ index: 0, task_id: 301 });
    expect(result.created[1]).toMatchObject({ index: 1, task_id: 302 });
    expect(result.created[2]).toMatchObject({ index: 2, task_id: 303 });
  });

  it("result: false in ok:true item → failed with API_ERROR", async () => {
    const { handler, batchMock } = buildHandler([RAW_USER]);
    batchMock.mockResolvedValueOnce([
      { ok: true, index: 0, result: false }, // Kanboard returns false in result field
      { ok: true, index: 1, result: 402 },
    ]);

    const items = [makeItem(0), makeItem(1)];
    const result = await handler.createTasksBatch(12, items);

    expect(result.created).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ index: 0, title: "Task 0" });
    expect(result.failed[0]?.error.code).toBe("API_ERROR");
  });

  it("all 3 items fail → created empty, failed has 3 items — NEVER throws", async () => {
    const { handler, batchMock } = buildHandler([RAW_USER]);
    batchMock.mockResolvedValueOnce([
      { ok: false, index: 0, error: { code: -32000, message: "Server error 0" } },
      { ok: false, index: 1, error: { code: -32000, message: "Server error 1" } },
      { ok: false, index: 2, error: { code: -32000, message: "Server error 2" } },
    ]);

    const items = [makeItem(0), makeItem(1), makeItem(2)];
    // Should NOT throw — returns envelope
    const result = await handler.createTasksBatch(12, items);

    expect(result.created).toHaveLength(0);
    expect(result.failed).toHaveLength(3);
  });

  it("batch constructs calls with correct method and project_id for each item", async () => {
    const { handler, batchMock } = buildHandler([RAW_USER]);
    batchMock.mockResolvedValueOnce([
      { ok: true, index: 0, result: 501 },
      { ok: true, index: 1, result: 502 },
    ]);

    const items = [
      { title: "Alpha", column_id: 3 },
      { title: "Beta", owner_id: 7 },
    ];
    await handler.createTasksBatch(12, items);

    expect(batchMock).toHaveBeenCalledTimes(1);
    const calls = batchMock.mock.calls[0]?.[0] ?? [];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: "createTask", id: 0, params: { project_id: 12, title: "Alpha", column_id: 3 } });
    expect(calls[1]).toMatchObject({ method: "createTask", id: 1, params: { project_id: 12, title: "Beta", owner_id: 7 } });
  });

  it("exactly BATCH_TASK_CAP items is allowed (no error)", async () => {
    const { handler, batchMock } = buildHandler([RAW_USER]);
    // Mock batch returning all successes
    const responses = Array.from({ length: BATCH_TASK_CAP }, (_, i) => ({
      ok: true as const,
      index: i,
      result: i + 1000,
    }));
    batchMock.mockResolvedValueOnce(responses);

    const items = Array.from({ length: BATCH_TASK_CAP }, (_, i) => makeItem(i));
    const result = await handler.createTasksBatch(12, items);
    expect(result.created).toHaveLength(BATCH_TASK_CAP);
    expect(result.failed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getVersion
// ---------------------------------------------------------------------------

describe("getVersion", () => {
  it("returns string version directly", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, "1.2.3"]);
    const version = await handler.getVersion();
    expect(callMock).toHaveBeenCalledWith("getVersion", undefined);
    expect(version).toBe("1.2.3");
  });

  it("extracts version from object with application_version field", async () => {
    const { handler } = buildHandler([RAW_USER, { application_version: "2.0.0-beta" }]);
    const version = await handler.getVersion();
    expect(version).toBe("2.0.0-beta");
  });
});

// ---------------------------------------------------------------------------
// v0.2.5 — 5 new handler methods
// ---------------------------------------------------------------------------

describe("updateProject", () => {
  it("happy path: true → resolves void", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, true]);
    await expect(
      handler.updateProject({ project_id: 12, name: "Renamed" }),
    ).resolves.toBeUndefined();
    expect(callMock).toHaveBeenCalledWith("updateProject", { project_id: 12, name: "Renamed" });
  });

  it("false → KanboardApiError", async () => {
    const { handler } = buildHandler([RAW_USER, false]);
    await expect(handler.updateProject({ project_id: 12, name: "Fail" })).rejects.toBeInstanceOf(
      KanboardApiError,
    );
  });

  it("ISO date forwarded unchanged to api-client (handler accepts any value)", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, true]);
    const start = "2026-01-01T00:00:00.000Z";
    await handler.updateProject({ project_id: 12, start_date: start });
    const arg = callMock.mock.calls[1]?.[1] as Record<string, unknown> | undefined;
    expect(arg?.["start_date"]).toBe(start);
  });
});

describe("getColumn", () => {
  it("happy path: returns typed Column", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, RAW_COLUMN]);
    const col = await handler.getColumn(3);
    expect(callMock).toHaveBeenCalledWith("getColumn", { column_id: 3 });
    expect(col.id).toBe(3);
    expect(col.title).toBe("In Progress");
    expect(col.project_id).toBe(12);
  });

  it("null → NotFoundError", async () => {
    const { handler } = buildHandler([RAW_USER, null]);
    await expect(handler.getColumn(999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("malformed object → ValidationError", async () => {
    const { handler } = buildHandler([RAW_USER, { malformed: true }]);
    await expect(handler.getColumn(3)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("addColumn", () => {
  it("integer return → column_id returned", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, 8]);
    const id = await handler.addColumn({ project_id: 12, title: "WIP" });
    expect(callMock).toHaveBeenCalledWith("addColumn", { project_id: 12, title: "WIP" });
    expect(id).toBe(8);
  });

  it("false → KanboardApiError", async () => {
    const { handler } = buildHandler([RAW_USER, false]);
    await expect(handler.addColumn({ project_id: 12, title: "Fail" })).rejects.toBeInstanceOf(
      KanboardApiError,
    );
  });

  it("true → KanboardApiError (expected a column_id)", async () => {
    const { handler } = buildHandler([RAW_USER, true]);
    const err = await handler
      .addColumn({ project_id: 12, title: "NoId" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KanboardApiError);
    expect((err as KanboardApiError).message).toContain("expected a column_id");
  });
});

describe("updateColumn", () => {
  it("true → resolves void", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, true]);
    await expect(
      handler.updateColumn({ column_id: 3, title: "Renamed" }),
    ).resolves.toBeUndefined();
    expect(callMock).toHaveBeenCalledWith("updateColumn", { column_id: 3, title: "Renamed" });
  });

  it("false → KanboardApiError", async () => {
    const { handler } = buildHandler([RAW_USER, false]);
    await expect(
      handler.updateColumn({ column_id: 3, title: "Fail" }),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });

  it("fetches existing title from getColumn when input title is undefined (C4)", async () => {
    // Queue: getMe → RAW_USER, getColumn → RAW_COLUMN (title:"In Progress"), updateColumn → true
    const { handler, callMock } = buildHandler([RAW_USER, RAW_COLUMN, true]);

    await expect(
      handler.updateColumn({ column_id: 3, task_limit: 5 }),
    ).resolves.toBeUndefined();

    // getColumn must have been called to resolve the existing title
    expect(callMock).toHaveBeenCalledWith("getColumn", { column_id: 3 });
    // updateColumn wire call must receive the resolved title from RAW_COLUMN
    expect(callMock).toHaveBeenCalledWith(
      "updateColumn",
      expect.objectContaining({ column_id: 3, title: "In Progress", task_limit: 5 }),
    );
  });

  it("uses input title verbatim when provided — getColumn NOT called (C4)", async () => {
    // Queue: getMe → RAW_USER, updateColumn → true (no getColumn call expected)
    const { handler, callMock } = buildHandler([RAW_USER, true]);

    await expect(
      handler.updateColumn({ column_id: 3, title: "Provided" }),
    ).resolves.toBeUndefined();

    // getColumn must NOT have been called — title was already present
    expect(callMock).not.toHaveBeenCalledWith("getColumn", expect.anything());
    // updateColumn wire call must use the provided title as-is
    expect(callMock).toHaveBeenCalledWith("updateColumn", { column_id: 3, title: "Provided" });
  });
});

describe("changeColumnPosition", () => {
  it("true → resolves void", async () => {
    const { handler, callMock } = buildHandler([RAW_USER, true]);
    await expect(
      handler.changeColumnPosition({ project_id: 12, column_id: 3, position: 1 }),
    ).resolves.toBeUndefined();
    expect(callMock).toHaveBeenCalledWith("changeColumnPosition", {
      project_id: 12,
      column_id: 3,
      position: 1,
    });
  });

  it("false → KanboardApiError", async () => {
    const { handler } = buildHandler([RAW_USER, false]);
    await expect(
      handler.changeColumnPosition({ project_id: 12, column_id: 3, position: 1 }),
    ).rejects.toBeInstanceOf(KanboardApiError);
  });
});
