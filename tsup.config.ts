import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

// Read version from package.json at build time so it can be inlined into the bundle.
// This avoids runtime require() path issues when dist/index.js tries to walk up directories.
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  // Inline the package version at build time — avoids runtime require("../../package.json")
  // resolution issues after bundling.
  define: {
    __KANBOARD_MCP_VERSION__: JSON.stringify(pkg.version),
  },
  // Do not bundle Node built-ins
  platform: "node",
  // Keep external dependencies as-is (installed at runtime)
  noExternal: [],
});
