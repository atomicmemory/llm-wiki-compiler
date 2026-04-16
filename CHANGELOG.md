# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
