/**
 * Unit tests for src/cli/selftest.ts
 *
 * Strategy: mock `bootstrap` and `loadEnv` so no real HTTP calls are made.
 * Capture console.error output to verify the printed lines.
 *
 * Personal mode: getVersion + getMe + getMyProjects all succeed → exit 0.
 * App mode:      getVersion + getMyProjects succeed; getMe skipped → exit 0.
 * getVersion failure → exit 1, [fail] line printed.
 * getMe failure in personal mode → exit 1.
 * loadEnv throws ConfigError → exit 1, [fail] env: <message>.
 * Token never appears in any stderr line.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { ConfigError, KanboardApiError } from "../../../src/shared/errors.js";
import type { User, Project } from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Mocks — hoist before imports that pull in the real modules
// ---------------------------------------------------------------------------

vi.mock("../../../src/config/env.js", () => ({
  loadEnv: vi.fn(),
}));

vi.mock("../../../src/transports/bootstrap.js", () => ({
  bootstrap: vi.fn(),
}));

import { loadEnv } from "../../../src/config/env.js";
import { bootstrap } from "../../../src/transports/bootstrap.js";
import { runSelftest } from "../../../src/cli/selftest.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_TOKEN = "1234567890abcdef1234567890abcdef"; // gitleaks:allow — fake token for selftest fixture

const PERSONAL_ENV: NodeJS.ProcessEnv = {
  KANBOARD_URL: "http://kanboard.test",
  KANBOARD_API_TOKEN: MOCK_TOKEN,
  KANBOARD_AUTH_MODE: "personal",
  KANBOARD_USERNAME: "alice",
};

const APP_ENV: NodeJS.ProcessEnv = {
  KANBOARD_URL: "http://kanboard.test",
  KANBOARD_API_TOKEN: MOCK_TOKEN,
  KANBOARD_AUTH_MODE: "app",
};

const PARSED_ENV_PERSONAL = {
  url: "http://kanboard.test",
  apiToken: MOCK_TOKEN,
  mode: "personal" as const,
  username: "alice",
  timeoutMs: 10000,
  logLevel: "info" as const,
};

const PARSED_ENV_APP = {
  url: "http://kanboard.test",
  apiToken: MOCK_TOKEN,
  mode: "app" as const,
  username: "jsonrpc",
  timeoutMs: 10000,
  logLevel: "info" as const,
};

const MOCK_ME: User = {
  id: 5,
  username: "alice",
  name: "Alice Example",
  email: "alice@example.com",
  role: "app-admin",
  is_active: true,
  is_admin: true,
  avatar_path: null,
};

const MOCK_PROJECTS: Project[] = [
  {
    id: 1,
    name: "Alpha",
    description: "",
    is_active: true,
    token: "",
    is_public: false,
    is_private: false,
    owner_id: 1,
    identifier: "ALPHA",
    default_swimlane: "Default",
    show_default_swimlane: true,
    start_date: null,
    end_date: null,
    url: "http://kanboard.test/?controller=ProjectViewController&action=show&project_id=1",
  },
  {
    id: 2,
    name: "Beta",
    description: "",
    is_active: true,
    token: "",
    is_public: false,
    is_private: false,
    owner_id: 1,
    identifier: "BETA",
    default_swimlane: "Default",
    show_default_swimlane: true,
    start_date: null,
    end_date: null,
    url: "http://kanboard.test/?controller=ProjectViewController&action=show&project_id=2",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal handler mock. */
function makeHandlerMock(opts: {
  getVersion?: () => Promise<string>;
  getMe?: () => Promise<User>;
  getMyProjects?: () => Promise<Project[]>;
}) {
  return {
    getVersion: opts.getVersion ?? (() => Promise.resolve("1.2.34")),
    getMe: opts.getMe ?? (() => Promise.resolve(MOCK_ME)),
    getMyProjects: opts.getMyProjects ?? (() => Promise.resolve(MOCK_PROJECTS)),
  };
}

/** Wire loadEnv + bootstrap mocks for a given parsed env and handler mock. */
function setupMocks(
  parsedEnv: typeof PARSED_ENV_PERSONAL | typeof PARSED_ENV_APP,
  handlerMock: ReturnType<typeof makeHandlerMock>,
) {
  vi.mocked(loadEnv).mockReturnValue(parsedEnv);
  vi.mocked(bootstrap).mockReturnValue({
    server: {} as never,
    bundle: {
      handler: handlerMock as never,
      apiClient: {} as never,
      resolvers: {} as never,
    },
    logger: {} as never,
    parsedEnv,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSelftest — personal mode happy path", () => {
  let stderrLines: string[];
  let consoleSpy: MockInstance;

  beforeEach(() => {
    stderrLines = [];
    consoleSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrLines.push(args.map(String).join(" "));
    });
    setupMocks(PARSED_ENV_PERSONAL, makeHandlerMock({}));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("returns exit code 0", async () => {
    const code = await runSelftest(PERSONAL_ENV);
    expect(code).toBe(0);
  });

  it("prints [ok] for getVersion", async () => {
    await runSelftest(PERSONAL_ENV);
    expect(stderrLines.some((l) => l.startsWith("[ok] kanboard server version:"))).toBe(true);
  });

  it("prints [ok] for getMe with username and id", async () => {
    await runSelftest(PERSONAL_ENV);
    expect(stderrLines.some((l) => l.includes("[ok] authenticated as: alice (id=5)"))).toBe(true);
  });

  it("prints [ok] for getMyProjects with count", async () => {
    await runSelftest(PERSONAL_ENV);
    expect(stderrLines.some((l) => l.includes("[ok] visible projects: 2"))).toBe(true);
  });

  it("prints [ok] selftest passed summary", async () => {
    await runSelftest(PERSONAL_ENV);
    expect(stderrLines.some((l) => l.startsWith("[ok] selftest passed"))).toBe(true);
  });

  it("token never appears in stderr output", async () => {
    await runSelftest(PERSONAL_ENV);
    const combined = stderrLines.join("\n");
    expect(combined).not.toContain(MOCK_TOKEN);
  });
});

describe("runSelftest — app mode happy path", () => {
  let stderrLines: string[];
  let consoleSpy: MockInstance;

  beforeEach(() => {
    stderrLines = [];
    consoleSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrLines.push(args.map(String).join(" "));
    });
    setupMocks(PARSED_ENV_APP, makeHandlerMock({}));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("returns exit code 0", async () => {
    const code = await runSelftest(APP_ENV);
    expect(code).toBe(0);
  });

  it("prints [skip] for getMe in app mode", async () => {
    await runSelftest(APP_ENV);
    expect(stderrLines.some((l) => l.includes("[skip] getMe — not applicable in app mode"))).toBe(true);
  });

  it("does NOT print [ok] authenticated as in app mode", async () => {
    await runSelftest(APP_ENV);
    expect(stderrLines.some((l) => l.includes("authenticated as:"))).toBe(false);
  });

  it("prints [ok] for getVersion and getMyProjects", async () => {
    await runSelftest(APP_ENV);
    expect(stderrLines.some((l) => l.startsWith("[ok] kanboard server version:"))).toBe(true);
    expect(stderrLines.some((l) => l.startsWith("[ok] visible projects:"))).toBe(true);
  });

  it("token never appears in stderr output", async () => {
    await runSelftest(APP_ENV);
    const combined = stderrLines.join("\n");
    expect(combined).not.toContain(MOCK_TOKEN);
  });
});

describe("runSelftest — getVersion fails", () => {
  let stderrLines: string[];
  let consoleSpy: MockInstance;

  beforeEach(() => {
    stderrLines = [];
    consoleSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrLines.push(args.map(String).join(" "));
    });
    setupMocks(
      PARSED_ENV_PERSONAL,
      makeHandlerMock({
        getVersion: () =>
          Promise.reject(new KanboardApiError("getVersion", "Connection refused")),
      }),
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("returns exit code 1", async () => {
    const code = await runSelftest(PERSONAL_ENV);
    expect(code).toBe(1);
  });

  it("prints [fail] line for getVersion", async () => {
    await runSelftest(PERSONAL_ENV);
    expect(
      stderrLines.some(
        (l) => l.startsWith("[fail] getVersion:") && l.includes("Connection refused"),
      ),
    ).toBe(true);
  });

  it("includes the error class name in the [fail] line", async () => {
    await runSelftest(PERSONAL_ENV);
    expect(stderrLines.some((l) => l.includes("KanboardApiError"))).toBe(true);
  });
});

describe("runSelftest — getMe fails in personal mode", () => {
  let stderrLines: string[];
  let consoleSpy: MockInstance;

  beforeEach(() => {
    stderrLines = [];
    consoleSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrLines.push(args.map(String).join(" "));
    });
    setupMocks(
      PARSED_ENV_PERSONAL,
      makeHandlerMock({
        getMe: () => Promise.reject(new KanboardApiError("getMe", "Invalid token")),
      }),
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("returns exit code 1", async () => {
    const code = await runSelftest(PERSONAL_ENV);
    expect(code).toBe(1);
  });

  it("prints [fail] line for getMe", async () => {
    await runSelftest(PERSONAL_ENV);
    expect(
      stderrLines.some((l) => l.startsWith("[fail] getMe:") && l.includes("Invalid token")),
    ).toBe(true);
  });

  it("still runs getMyProjects after getMe failure", async () => {
    await runSelftest(PERSONAL_ENV);
    // getMyProjects should still run (getMe failure is not early-exit)
    expect(stderrLines.some((l) => l.startsWith("[ok] visible projects:"))).toBe(true);
  });
});

describe("runSelftest — missing env var (loadEnv throws ConfigError)", () => {
  let stderrLines: string[];
  let consoleSpy: MockInstance;

  beforeEach(() => {
    stderrLines = [];
    consoleSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrLines.push(args.map(String).join(" "));
    });
    vi.mocked(loadEnv).mockImplementation(() => {
      throw new ConfigError("KANBOARD_URL is required but was not set.");
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("returns exit code 1", async () => {
    const code = await runSelftest({});
    expect(code).toBe(1);
  });

  it("prints [fail] env: <message>", async () => {
    await runSelftest({});
    expect(
      stderrLines.some(
        (l) => l.startsWith("[fail] env:") && l.includes("KANBOARD_URL is required"),
      ),
    ).toBe(true);
  });

  it("token never appears in stderr output", async () => {
    await runSelftest({});
    const combined = stderrLines.join("\n");
    expect(combined).not.toContain(MOCK_TOKEN);
  });
});

describe("runSelftest — getMyProjects fails", () => {
  let stderrLines: string[];
  let consoleSpy: MockInstance;

  beforeEach(() => {
    stderrLines = [];
    consoleSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderrLines.push(args.map(String).join(" "));
    });
    setupMocks(
      PARSED_ENV_PERSONAL,
      makeHandlerMock({
        getMyProjects: () =>
          Promise.reject(new KanboardApiError("getMyProjects", "Access denied")),
      }),
    );
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("returns exit code 1", async () => {
    const code = await runSelftest(PERSONAL_ENV);
    expect(code).toBe(1);
  });

  it("prints [fail] line for getMyProjects", async () => {
    await runSelftest(PERSONAL_ENV);
    expect(
      stderrLines.some(
        (l) => l.startsWith("[fail] getMyProjects:") && l.includes("Access denied"),
      ),
    ).toBe(true);
  });

  it("still prints [ok] for getVersion and getMe before the failure", async () => {
    await runSelftest(PERSONAL_ENV);
    expect(stderrLines.some((l) => l.startsWith("[ok] kanboard server version:"))).toBe(true);
    expect(stderrLines.some((l) => l.includes("[ok] authenticated as:"))).toBe(true);
  });
});
