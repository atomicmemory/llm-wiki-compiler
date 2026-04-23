import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Don't pick up tests from sibling worktrees living under .claude/worktrees/.
    // Worktrees share the parent's working directory tree, so without this
    // exclude vitest discovers and runs every feature branch's tests.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**"],
  },
});
