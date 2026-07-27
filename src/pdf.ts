import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pdf from "pdf-parse";
import type { ParsedDocument, PdfPage } from "./types.js";

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parsePdf(filePath: string): Promise<ParsedDocument> {
  const buffer = await readFile(filePath);
  const pages: PdfPage[] = [];
  const result = await pdf(buffer, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent();
      const text = textContent.items
        .map((item: { str?: string }) => item.str ?? "")
        .join(" ");
      pages.push({ page: pages.length + 1, text: normalizeText(text) });
      return text;
    }
  });
  const resolvedPath = path.resolve(filePath);
  const fileName = path.basename(resolvedPath);
  const title = normalizeText(result.info?.Title || "") || path.basename(fileName, path.extname(fileName));
  const markdown = pages
    .map((page) => `## Page ${page.page}\n\n${page.text}`)
    .join("\n\n---\n\n");

  return {
    id: randomUUID(),
    sourcePath: resolvedPath,
    fileName,
    title,
    contentHash: createHash("sha256").update(buffer).digest("hex"),
    pageCount: result.numpages,
    metadata: {
      author: result.info?.Author ?? null,
      subject: result.info?.Subject ?? null,
      creator: result.info?.Creator ?? null,
      producer: result.info?.Producer ?? null,
      creationDate: result.info?.CreationDate ?? null
    },
    pages,
    markdown: `# ${title}\n\n${markdown}\n`
  };
}
