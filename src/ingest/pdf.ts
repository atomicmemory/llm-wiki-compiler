/**
 * PDF ingestion module.
 *
 * Reads a local PDF file using the pdf-parse v2 PDFParse class, extracts the
 * text content via getText() and the document metadata via getInfo(). The
 * title comes from the PDF's Info dictionary when present, falling back to
 * the filename. Pages are joined into a single markdown body.
 */

import { readFile } from "fs/promises";
import { PDFParse } from "pdf-parse";
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
 * @param filePath - Absolute or relative path to a .pdf file.
 * @returns An object with the document title and extracted text content.
 * @throws On read failure or unparseable PDF.
 */
export default async function ingestPdf(filePath: string): Promise<IngestedSource> {
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
