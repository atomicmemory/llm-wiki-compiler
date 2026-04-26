/**
 * PDF ingestion module.
 *
 * Reads a local PDF file using the pdf-parse v2 PDFParse class, extracts the
 * text content via getText() and the document metadata via getInfo(). The
 * title comes from the PDF's Info dictionary when present, falling back to
 * the filename. Pages are joined into a single markdown body.
 *
 * pdfjs-dist (a transitive dependency of pdf-parse) references `DOMMatrix` at
 * module evaluation time. Node 20+ provides DOMMatrix as a global; Node 18
 * does not. To keep `node dist/cli.js --help` (and every other non-PDF path)
 * working on Node 18, pdf-parse is imported lazily — inside the function that
 * actually parses a PDF — rather than at the top of this module.
 */

import { readFile } from "fs/promises";
import { titleFromFilename, type IngestedSource } from "./shared.js";

/** Minimum Node.js major version required for PDF ingest (DOMMatrix global). */
const MIN_NODE_MAJOR_FOR_PDF = 20;

/**
 * Throw a clear, actionable error when the Node.js runtime is too old for PDF
 * ingest. Called at the start of ingestPdf() so callers get a helpful message
 * instead of an opaque `ReferenceError: DOMMatrix is not defined`.
 */
export function requireNode20ForPdf(): void {
  const majorVersion = parseInt(process.version.slice(1).split(".")[0], 10);
  if (majorVersion < MIN_NODE_MAJOR_FOR_PDF) {
    throw new Error(
      `PDF ingest requires Node.js ${MIN_NODE_MAJOR_FOR_PDF} or later (pdfjs-dist uses DOMMatrix which is only available as a global in Node 20+). Current Node version: ${process.version}`,
    );
  }
}

/** Extract the title from PDF metadata or fall back to the filename. */
export function resolveTitle(filePath: string, info: unknown): string {
  if (info && typeof info === "object") {
    const titleField = (info as Record<string, unknown>)["Title"];
    if (typeof titleField === "string" && titleField.trim().length > 0) {
      return titleField.trim();
    }
  }
  return titleFromFilename(filePath);
}

/**
 * Ingest a local PDF file and return its text content with the document title.
 *
 * Requires Node.js 20+ — pdf-parse depends on pdfjs-dist which uses DOMMatrix
 * at module evaluation time, and DOMMatrix is only a Node global from v20.
 * A clear runtime error is thrown on older Node versions.
 *
 * pdf-parse is imported dynamically so that loading this module on Node 18
 * does NOT crash — only actually calling this function will.
 *
 * @param filePath - Absolute or relative path to a .pdf file.
 * @returns An object with the document title and extracted text content.
 * @throws On Node &lt;20, read failure, or unparseable PDF.
 */
export default async function ingestPdf(filePath: string): Promise<IngestedSource> {
  requireNode20ForPdf();

  // Lazy import: keeps pdfjs-dist out of the module graph until a PDF is
  // actually being parsed. Without this, any CLI invocation (even --help)
  // on Node 18 crashes with "ReferenceError: DOMMatrix is not defined".
  const { PDFParse } = await import("pdf-parse");

  const buffer = await readFile(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    // Sequential calls are required: pdfjs-dist's LoopbackPort.postMessage
    // uses structuredClone internally; concurrent calls cause a DataCloneError
    // when the port tries to transfer the same underlying state simultaneously.
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();

    const title = resolveTitle(filePath, infoResult.info);
    const content = textResult.text.trim();
    return { title, content };
  } finally {
    await parser.destroy();
  }
}
