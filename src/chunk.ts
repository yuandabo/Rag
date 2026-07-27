import { randomUUID } from "node:crypto";
import type { DocumentChunk, ParsedDocument } from "./types.js";

interface PageSpan {
  page: number;
  start: number;
  end: number;
}

function preferredBreak(text: string, start: number, targetEnd: number): number {
  if (targetEnd >= text.length) return text.length;
  const minimum = start + Math.floor((targetEnd - start) * 0.6);
  for (const separator of ["\n\n", "\n", "。", ". ", "！", "？", "; ", " "]) {
    const position = text.lastIndexOf(separator, targetEnd);
    if (position >= minimum) return position + separator.length;
  }
  return targetEnd;
}

function pagesForRange(spans: PageSpan[], start: number, end: number): [number, number] {
  const matched = spans.filter((span) => span.end > start && span.start < end);
  return [matched[0]?.page ?? 1, matched.at(-1)?.page ?? 1];
}

export function chunkDocument(document: ParsedDocument, size: number, overlap: number): DocumentChunk[] {
  const spans: PageSpan[] = [];
  let text = "";
  for (const page of document.pages) {
    if (text) text += "\n\n";
    const start = text.length;
    text += page.text;
    spans.push({ page: page.page, start, end: text.length });
  }

  const chunks: DocumentChunk[] = [];
  let start = 0;
  while (start < text.length) {
    const end = preferredBreak(text, start, Math.min(start + size, text.length));
    const content = text.slice(start, end).trim();
    if (content) {
      const [pageStart, pageEnd] = pagesForRange(spans, start, end);
      chunks.push({
        id: randomUUID(),
        documentId: document.id,
        index: chunks.length,
        content,
        tokenEstimate: Math.ceil(content.length / 4),
        pageStart,
        pageEnd,
        metadata: { fileName: document.fileName, title: document.title }
      });
    }
    if (end >= text.length) break;
    const nextStart = Math.max(start + 1, end - overlap);
    start = preferredBreak(text, nextStart, Math.min(nextStart + Math.floor(overlap / 3), end));
  }
  return chunks;
}
