# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-04-23

Adds a candidate review queue for `compile` and richer epistemic metadata on compiled pages.

### Added

- **Candidate review queue** — `llmwiki compile --review` writes generated pages to `.llmwiki/candidates/` instead of mutating `wiki/`. New subcommands `llmwiki review list|show|approve|reject` let you inspect each candidate before it lands. `approve` writes the page and refreshes index/MOC/embeddings; `reject` archives the candidate to `.llmwiki/candidates/archive/`. MCP `wiki_status` exposes `pendingCandidates` so agents can see queue depth.
- **Confidence and contradiction metadata** — compiled pages can carry optional frontmatter fields (`confidence`, `provenanceState`, `contradictedBy`, `inferredParagraphs`). When multiple sources merge into one slug, metadata is reconciled (`min` confidence, `provenanceState = 'merged'`, union of `contradictedBy` deduped by slug, `max` `inferredParagraphs`).
- **Three new lint rules** surface the new metadata: `low-confidence`, `contradicted-page`, `excess-inferred-paragraphs`.
- **Multi-source citation parsing in lint** — `^[a.md, b.md]` now validates each filename independently and only reports the missing one(s).
- **Husky pre-commit and pre-push hooks** — pre-commit runs `fallow` + `tsc --noEmit`; pre-push runs `npm run build` + `npm test`. Devs get fast feedback on commit and full validation before push.

### Changed

- Pre-commit/pre-push hooks pin `fallow` to `2.42.0` locally (devDep) and in CI to keep complexity thresholds stable across the team.
- `compile`'s page rendering extracted into `src/compiler/page-renderer.ts` so both direct writes and candidate generation reuse the same renderer.
- `vitest.config.ts` excludes `.claude/**` so `npm test` from the main checkout doesn't discover sibling worktrees.

### Concurrency

- `review approve` and `review reject` acquire `.llmwiki/lock` (the same lock `compile` uses) and re-read the candidate under the lock to close the TOCTOU window between pre-check and mutation.
- When one source produces multiple candidates, source state isn't persisted until the last sibling is approved — unresolved siblings stay re-detectable on the next `compile --review`.

### Infrastructure

- Tests grew from 222 to 291 across all new features.

## [0.2.0] - 2026-04-16

First major release since 0.1.1. Ships the complete initial roadmap plus an MCP server for AI agent integration.

### Added

- **MCP server** (`llmwiki serve`) exposes llmwiki's automated pipelines as Model Context Protocol tools so agents can ingest, compile, query, search, lint, and read pages programmatically. Ships with 7 tools and 5 read-only resources.
- **Semantic search** via embeddings — pre-filters the wiki index to the top 15 most similar pages before calling the selection LLM, with transparent fallback to full-index selection when no embeddings store exists.
- **Multi-provider support** — swap LLM backends via `LLMWIKI_PROVIDER=anthropic|openai|ollama|minimax`.
- **`llmwiki lint`** command with six rule-based checks (broken wikilinks, orphaned pages, missing summaries, duplicate concepts, empty pages, broken citations). No LLM calls, no API key required.
- **Paragraph-level source attribution** — compiled pages now include `^[filename.md]` citation markers pointing back to source files.
- **Obsidian integration** — LLM-extracted tags, deterministic aliases (slug, conjunction swap, abbreviation), and auto-generated `wiki/MOC.md` grouping concept pages by tag.
- **Anthropic provider enhancements** — `ANTHROPIC_AUTH_TOKEN` support, custom base URLs, and `~/.claude/settings.json` fallback for credentials and model.
- **MiniMax provider** via the OpenAI-compatible endpoint.
- GitHub Actions CI with Node 18/20/22 build+test matrix plus Fallow codebase health check (required for merges).

### Changed

- Command functions (`compile`, `query`, `ingest`) now expose structured-result variants (`compileAndReport()`, `generateAnswer()`, `ingestSource()`) alongside the existing CLI-facing versions. The CLI experience is unchanged.
- `runCompilePipeline` decomposed into focused phase helpers to bring function complexity under Fallow's thresholds.

### Infrastructure

- Tests grew from 91 to 211 across all new features.
- Fallow codebase health analyzer required in CI (no dead code, no duplication, no complexity threshold violations).

### Contributors

Thanks to @FrankMa1, @PipDscvr, @goforu, and @socraticblock for their contributions.

## [0.1.1] - 2026-04-07

### Fixed

- Flaky CLI test timeout.

## [0.1.0] - 2026-04-05

Initial release.

### Added

- `llmwiki ingest` — fetch a URL or copy a local file into `sources/`.
- `llmwiki compile` — incremental two-phase compilation (extract concepts, then generate pages). Hash-based change detection skips unchanged sources.
- `llmwiki query` — two-step LLM-powered Q&A (index-based page selection, then streaming answer). `--save` flag writes answers as wiki pages.
- `llmwiki watch` — auto-recompile on source changes.
- Atomic writes, lock-protected compilation, orphan marking for deleted sources.
- `[[wikilink]]` resolution and auto-generated `wiki/index.md`.

[0.2.0]: https://github.com/atomicmemory/llm-wiki-compiler/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/atomicmemory/llm-wiki-compiler/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/atomicmemory/llm-wiki-compiler/releases/tag/v0.1.0
