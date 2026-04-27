# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-04-27

Adds multimodal ingest (images, PDFs, transcripts) and chunk-level semantic retrieval with reranking and a `--debug` view. Also raises the minimum Node version to 24 so the project can use modern test-mocking tooling that depends on Node 24+ APIs.

### Added

- **Multimodal ingest** — `llmwiki ingest` now accepts images (vision via the active LLM provider), PDFs (text + metadata via lazy-loaded `pdf-parse`), and transcripts (`.vtt`, `.srt`, plus content-sniffed `.txt` that requires repeated speaker dialogue or anchored timestamps so plain notes aren't misclassified). Each source records its `sourceType` in frontmatter (`web` | `file` | `image` | `pdf` | `transcript`). YouTube transcript URLs are auto-routed.
- **Chunk-level semantic retrieval** — the embedding store gained an optional v2 `chunks` schema. Pages are split on paragraph + heading boundaries (with size guardrails), embedded individually, and reused across compiles when their content hash hasn't changed. Query routing prefers chunk hits, falls back to page-level retrieval and full-index selection.
- **BM25 reranking** over chunk candidates, blending 0.5x cosine similarity with BM25 score so semantic ranking still matters when the query has no overlapping terms.
- **`llmwiki query --debug`** prints the top chunks (slug, score, snippet) and pages selected, so users can audit retrieval decisions. The MCP `query_wiki` tool accepts a `debug` arg too.
- **Empty-store cold-start** — an empty v1 or v2 store with live wiki pages now triggers a full chunk embedding on next compile (previously, embeddings would only update when an existing slug changed).
- **`@copilotkit/aimock` test infrastructure** with `mockClaudeEnv` / `mockOpenAIEnv` / `useAimockLifecycle` helpers. CLI subprocess tests can now stub LLM endpoints deterministically — closes the recurring "no subprocess test for the compile/query happy path" gap that codex flagged across review-queue, schema-layer, confidence-metadata, and chunked-retrieval.

### Changed

- **Minimum Node version raised from 18 to 24.** `engines.node` is `>=24`, the tsup target is `node24`, and CI runs only on Node 24. Users on older Node should pin to `<0.5.0` until they can upgrade their runtime.
- `pdf-parse` is dynamically imported so the cost of loading pdfjs-dist is paid only when a PDF is actually being ingested.

### Test infrastructure

- New `runCLI` / `expectCLIExit` / `expectCLIFailure` / `formatCLIFailure` helpers in `test/fixtures/run-cli.ts` capture full subprocess diagnostics (code, signal, killed, message, stdout, stderr, args, cwd) on assertion failure — flakes now surface their root cause without rerunning.
- `vitest globalSetup` builds dist once before the suite runs, eliminating the per-test `tsup --clean` race that caused intermittent CI flakes.
- Tests grew from 391 to 477 in this release (and to 519 once export-bundle lands as a follow-up).

## [0.4.0] - 2026-04-25

Adds claim-level source-range provenance, a first-class schema layer for typed page kinds, configurable provider request timeouts, and a slug-based wikilink format that resolves reliably in Obsidian.

### Added

- **Claim-level provenance with source ranges** — citations can now pin specific lines: `^[paper.md:42-58]` (colon form) or `^[paper.md#L42-L58]` (GitHub anchor form). Single-line `^[paper.md:7]` works too, as do mixed multi-source markers like `^[a.md, b.md:1-3]`. The legacy paragraph form `^[paper.md]` continues to work unchanged.
- **`extractClaimCitations(body)`** returns structured `{ raw, spans: [{ file, lines? }] }` records for tooling. **`inspectProvenance(body)`** groups spans by source file (deduped), useful for "this page draws from" UIs.
- **`checkBrokenCitations`** lint rule now flags out-of-bounds spans (e.g. `^[src.md:42-58]` against a 3-line source) with cached per-file line counts so a page with many spans into the same source only reads it once.
- **`checkMalformedClaimCitations`** new lint rule catches malformed entries: non-numeric ranges (`:abc-xyz`), half-baked hash forms (`#X9`), line `0`, and reversed ranges (`5-3`). Semantic invalidity is rejected at parse time so `extractClaimCitations` doesn't return impossible spans.
- **First-class schema layer** for typed page kinds. Projects can declare `.llmwiki/schema.json|yaml|yml` (or `wiki/.schema.yaml|yml`) defining page kinds (`concept`, `entity`, `comparison`, `overview`), per-kind `minWikilinks`, and seed pages.
- **`llmwiki schema init`** writes a starter schema file. **`llmwiki schema show`** prints the resolved schema and its source path.
- **`schema-cross-link-minimum`** lint rule enforces per-kind link expectations.
- **Schema-driven seed pages** are generated during compile and run on the early-return path too, so adding a seed-page entry triggers its creation on the next `compile` even when no source files changed.
- **Review-mode schema violations** — `compile --review` runs in-memory schema lint per candidate and stamps any violations onto the candidate JSON. `review show <id>` prints a "Schema violations" block when present.
- **Configurable provider request timeouts** — `LLMWIKI_REQUEST_TIMEOUT_MS` (provider-agnostic) and `OLLAMA_TIMEOUT_MS` (Ollama-specific) override the per-request timeout. Defaults: 10 minutes for OpenAI (matches the SDK), 30 minutes for Ollama (better suited to local models).
- **Slug-based wikilinks** — index, MOC, and the in-body wikilink resolver now emit `[[slug|Title]]` so Obsidian targets the file directly regardless of whether the slug differs from the display title.
- **Test infrastructure for subprocess CLI tests** — `runCLI`/`expectCLIExit`/`expectCLIFailure`/`formatCLIFailure` helpers in `test/fixtures/run-cli.ts` capture full subprocess diagnostics (code, signal, killed, message, stdout, stderr, args, cwd) so flakes surface their root cause without rerunning. dist/ is built once via `vitest globalSetup` so parallel workers don't race on `tsup --clean`.

### Changed

- `extractCitations(body)` continues to return a flat filename list for backward compatibility, but is now backed by `extractClaimCitations` and strips span suffixes when collecting filenames.
- `WikiFrontmatter.kind` references the canonical `PageKind` type from `src/schema/types.ts` via `import type` (no runtime cycle).
- `compile --review` defers seed-page generation and `finalizeWiki` to honor the no-`wiki/`-mutation contract.

### Contributors

Thanks to **@ludevica** for #15 (slug-based wikilinks) and **@BenGSt** for reporting the Ollama timeout (#11).

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

### Contributors

Thanks to **@ishan5ain** for #12 (split embedding endpoints for OpenAI-compatible providers) and **@sy2ruto** for reporting the multi-source citation lint bug (#10) — the parsing fix shipped here in PR #19.

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
