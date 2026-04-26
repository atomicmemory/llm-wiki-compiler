/**
 * PDF ingestion module.
 *
 * Reads a local PDF file using the pdf-parse v2 PDFParse class, extracts the
 * text content via getText() and the document metadata via getInfo(). The
 * title comes from the PDF's Info dictionary when present, falling back to
 * the filename. Pages are joined into a single markdown body.
 *
 * pdf-parse (and its transitive pdfjs-dist) is imported dynamically so the
 * cost of loading the PDF parser is only paid when a PDF is actually being
 * ingested — `node dist/cli.js --help` and every other non-PDF code path
 * stays lean.
 */

import { readFile } from "fs/promises";
import { titleFromFilename, type IngestedSource } from "./shared.js";

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
 * pdf-parse is imported dynamically so this module's load cost stays minimal
 * for non-PDF code paths (the parser pulls in pdfjs-dist which is sizeable).
 *
 * @param filePath - Absolute or relative path to a .pdf file.
 * @returns An object with the document title and extracted text content.
 * @throws On read failure or unparseable PDF.
 */
export default async function ingestPdf(filePath: string): Promise<IngestedSource> {
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
