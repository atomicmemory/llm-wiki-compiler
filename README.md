# llmwiki

Compile raw sources into an interlinked markdown wiki.

Inspired by Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern: instead of re-discovering knowledge at query time, compile it once into a persistent, browsable artifact that compounds over time.

![llmwiki demo](docs/images/demo.gif)

## Who this is for

- **AI researchers and engineers** building persistent knowledge from papers, docs, and notes
- **Technical writers** compiling scattered sources into a structured, interlinked reference
- **Anyone with too many bookmarks** who wants a wiki instead of a graveyard of tabs

## Quick start

```bash
npm install -g llm-wiki-compiler
export ANTHROPIC_API_KEY=sk-...
# Or use ANTHROPIC_AUTH_TOKEN if your Anthropic-compatible gateway expects it.
# Or use a different provider:
# export LLMWIKI_PROVIDER=openai
# export OPENAI_API_KEY=sk-...

llmwiki ingest https://some-article.com
llmwiki compile
llmwiki query "what is X?"
```

## Configuration

llmwiki configures providers via environment variables. The default provider is Anthropic.

Configuration precedence for Anthropic values:

1. Shell env / local `.env`
2. Claude Code settings fallback (`~/.claude/settings.json` → `env` block)
3. Built-in provider defaults (where applicable)

- `LLMWIKI_PROVIDER`: The provider to use (e.g., anthropic, openai).
- `LLMWIKI_MODEL`: The model name to override the provider default.

### Anthropic (Default)

- `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`: Required. Either one can satisfy Anthropic authentication.
- `ANTHROPIC_BASE_URL`: Optional. Custom endpoint for proxies. Valid HTTP(S) URLs are accepted, including Claude-style path endpoints such as `https://api.kimi.com/coding/`.

Example using an Anthropic or cc-switch custom proxy:

```bash
export LLMWIKI_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-...
export ANTHROPIC_BASE_URL=https://proxy.example.com
```

If those values are not set in shell env or `.env`, llmwiki will try Anthropic-compatible values from `~/.claude/settings.json` (`env` block) for:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`

Example with zero exports (Claude Code already configured):

```bash
llmwiki compile
```

## Why not just RAG?

RAG retrieves chunks at query time. Every question re-discovers the same relationships from scratch. Nothing accumulates.

llmwiki **compiles** your sources into a wiki. Concepts get their own pages. Pages link to each other. When you ask a question with `--save`, the answer becomes a new page, and future queries use it as context. Your explorations compound.

This is complementary to RAG, not a replacement. RAG is great for ad-hoc retrieval over large corpora. llmwiki gives you a persistent, structured artifact to retrieve from.

```
RAG:     query → search chunks → answer → forget
llmwiki: sources → compile → wiki → query → save → richer wiki → better answers
```

## How it works

```
sources/  →  SHA-256 hash check  →  LLM concept extraction  →  wiki page generation  →  [[wikilink]] resolution  →  index.md
```

**Two-phase pipeline.** Phase 1 extracts all concepts from all sources. Phase 2 generates pages. This eliminates order-dependence, catches failures before writing anything, and merges concepts shared across multiple sources into single pages.

**Incremental.** Only changed sources go through the LLM. Everything else is skipped via hash-based change detection.

**Compounding queries.** `llmwiki query --save` writes the answer as a wiki page and immediately rebuilds the index. Saved answers show up in future queries as context.

### What it produces

A raw source like a Wikipedia article on knowledge compilation becomes a structured wiki page:

```yaml
---
title: Knowledge Compilation
summary: Techniques for converting knowledge representations into forms that support efficient reasoning.
sources:
  - knowledge-compilation.md
createdAt: "2026-04-05T12:00:00Z"
updatedAt: "2026-04-05T12:00:00Z"
---
```

```markdown
Knowledge compilation refers to a family of techniques for pre-processing
a knowledge base into a target language that supports efficient queries.

Related concepts: [[Propositional Logic]], [[Model Counting]]
```

Pages include source attribution in frontmatter. Paragraphs are annotated with `^[filename.md]` markers pointing back to the source file that contributed the content.

## Commands

| Command | What it does |
|---------|-------------|
| `llmwiki ingest <url\|file>` | Fetch a URL or copy a local file into `sources/` |
| `llmwiki compile` | Incremental compile: extract concepts, generate wiki pages |
| `llmwiki query "question"` | Ask questions against your compiled wiki |
| `llmwiki query "question" --save` | Answer and save the result as a wiki page |
| `llmwiki lint` | Check wiki quality (broken links, orphans, empty pages, etc.) |
| `llmwiki watch` | Auto-recompile when `sources/` changes |
| `llmwiki serve [--root <dir>]` | Start an MCP server exposing wiki tools to AI agents |

## Output

```
wiki/
  concepts/     one .md file per concept, with YAML frontmatter
  queries/      saved query answers, included in index and retrieval
  index.md      auto-generated table of contents
```

Obsidian-compatible. `[[wikilinks]]` resolve to concept titles.

## Demo

Try it on any article or document:

```bash
mkdir my-wiki && cd my-wiki
llmwiki ingest https://en.wikipedia.org/wiki/Andrej_Karpathy
llmwiki compile
llmwiki query "What terms did Andrej coin?"
```

See `examples/basic/` in the repo for pre-generated output you can browse without an API key.

## MCP Server

llmwiki ships an MCP (Model Context Protocol) server so AI agents (Claude Desktop, Cursor, Claude Code, etc.) can drive the full pipeline directly: ingest sources, compile, query, search, lint, and read pages — without scraping CLI output.

Where [llm-wiki-kit](https://github.com/iamsashank09/llm-wiki-kit) gives agents raw CRUD against wiki pages, llmwiki exposes the **automated pipelines**: agents get intelligent compilation, incremental change detection, and semantic query routing built in.

### Setup

Start the server (stdio transport, no API key required at startup):

```bash
llmwiki serve --root /path/to/your/wiki-project
```

### Claude Desktop / Cursor configuration

Add to your client's MCP config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "llmwiki": {
      "command": "npx",
      "args": ["llm-wiki-compiler", "serve", "--root", "/path/to/wiki-project"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Tools that need an LLM (`compile_wiki`, `query_wiki`, `search_pages`) check for a configured provider on each call. Read-only tools (`read_page`, `lint_wiki`, `wiki_status`) and `ingest_source` work without any credentials.

### Tools

| Tool | What it does |
|------|--------------|
| `ingest_source` | Fetch a URL or local file into `sources/`. |
| `compile_wiki` | Run the incremental compile pipeline; returns counts, slugs, errors. |
| `query_wiki` | Two-step grounded answer with optional `--save`. |
| `search_pages` | Return full content of pages relevant to a question. |
| `read_page` | Read a single page by slug (concepts/ then queries/). |
| `lint_wiki` | Run quality checks; returns structured diagnostics. |
| `wiki_status` | Page count, source count, orphans, pending changes (read-only). |

### Resources

| URI | Returns |
|-----|---------|
| `llmwiki://index` | Full `wiki/index.md` content. |
| `llmwiki://concept/{slug}` | A single concept page (frontmatter + body). |
| `llmwiki://query/{slug}` | A single saved query page. |
| `llmwiki://sources` | List of ingested source files with metadata. |
| `llmwiki://state` | Compilation state (per-source hashes, last compile times). |

## Limitations

Early software. Best for small, high-signal corpora (a few dozen sources). Query routing is index-based.

**Honest about truncation.** Sources that exceed the character limit are truncated on ingest with `truncated: true` and the original character count recorded in frontmatter, so downstream consumers know they're working with partial content.

## Karpathy's LLM Wiki pattern vs this compiler

Karpathy describes an abstract pattern for turning raw data into compiled knowledge. Here's how llmwiki maps to it:

| Karpathy's concept | llmwiki | Status |
|---|---|---|
| Data ingest | `llmwiki ingest` | Implemented |
| Compile wiki | `llmwiki compile` | Implemented |
| Q&A | `llmwiki query` | Implemented |
| Output filing (save answers back) | `llmwiki query --save` | Implemented |
| Auto-recompile | `llmwiki watch` | Implemented |
| Linting / health-check pass | `llmwiki lint` | Implemented |
| Agent integration | `llmwiki serve` (MCP server) | Implemented |
| Image support | — | Not yet implemented |
| Marp slides | — | Not yet implemented |
| Fine-tuning | — | Not yet implemented |

## Roadmap

- ✅ Better provenance (paragraph-level source attribution)
- ✅ Linting pass for wiki quality checks
- ✅ Multi-provider support (OpenAI, Ollama, MiniMax)
- ✅ Larger-corpus query strategy (semantic search, embeddings)
- ✅ Deeper Obsidian integration (tags, aliases, Map of Content)
- ✅ MCP server for agent integration
- Image support
- Marp slides
- Fine-tuning

If you want to contribute, these are the highest-leverage areas right now. Issues and PRs are welcome.

## Requirements

Node.js >= 18, plus provider credentials (for Anthropic: `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`).

## License

MIT


## Disclaimer

No LLMs were harmed in the making of this repo.
