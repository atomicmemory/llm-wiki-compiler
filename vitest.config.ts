import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Don't pick up tests from sibling worktrees living under .claude/worktrees/.
    // Worktrees share the parent's working directory tree, so without this
    // exclude vitest discovers and runs every feature branch's tests.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**"],
    // Build dist/ once globally so parallel test workers don't race on
    // tsup's clean+write cycle (multiple beforeAll(npx tsup) calls were
    // wiping dist/cli.js mid-test).
    globalSetup: "./test/global-setup.ts",
  },
});
