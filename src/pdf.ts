import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import pdf from "pdf-parse";
import { createWorker } from "tesseract.js";
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
  if (pages.every((page) => page.text.length === 0)) {
    console.log("  No text layer found; running OCR...");
    const ocrPages = await ocrPdf(buffer);
    pages.splice(0, pages.length, ...ocrPages);
  }
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

async function ocrPdf(buffer: Buffer): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const worker = await createWorker("chi_sim+eng");
  try {
    const pages: PdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      console.log(`  OCR page ${pageNumber}/${document.numPages}`);
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2.2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
      const result = await worker.recognize(canvas.toBuffer("image/png"));
      pages.push({ page: pageNumber, text: normalizeText(result.data.text) });
      page.cleanup();
    }
    return pages;
  } finally {
    await worker.terminate();
    await document.cleanup();
  }
}
