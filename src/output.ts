import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentChunk, ParsedDocument } from "./types.js";

export async function writeArtifacts(outputDir: string, document: ParsedDocument, chunks: DocumentChunk[]): Promise<void> {
  const directory = path.resolve(outputDir, document.contentHash.slice(0, 12));
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, "document.md"), document.markdown, "utf8"),
    writeFile(path.join(directory, "document.json"), JSON.stringify(document, null, 2), "utf8"),
    writeFile(path.join(directory, "chunks.json"), JSON.stringify(chunks, null, 2), "utf8")
  ]);
}
