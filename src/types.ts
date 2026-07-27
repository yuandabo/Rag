export interface PdfPage {
  page: number;
  text: string;
}

export interface ParsedDocument {
  id: string;
  sourcePath: string;
  fileName: string;
  title: string;
  contentHash: string;
  pageCount: number;
  metadata: Record<string, unknown>;
  pages: PdfPage[];
  markdown: string;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  index: number;
  content: string;
  tokenEstimate: number;
  pageStart: number;
  pageEnd: number;
  metadata: Record<string, unknown>;
}

export interface SearchResult {
  content: string;
  score: number;
  sourcePath: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  metadata: Record<string, unknown>;
}
