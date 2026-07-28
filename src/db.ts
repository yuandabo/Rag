import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import type { Table } from "@lancedb/lancedb";
import type { DocumentChunk, ParsedDocument, SearchResult } from "./types.js";

const TABLE_NAME = "rag_chunks";

interface ChunkRow {
  [key: string]: unknown;
  id: string;
  documentId: string;
  sourcePath: string;
  fileName: string;
  title: string;
  contentHash: string;
  pageCount: number;
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
  pageStart: number;
  pageEnd: number;
  metadata: string;
  embeddingModel: string;
  vector: number[];
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export class VectorStore {
  private connection?: lancedb.Connection;

  constructor(private readonly databasePath: string, private readonly dimensions: number) {}

  async initialize(): Promise<void> {
    this.connection = await lancedb.connect(path.resolve(this.databasePath));
  }

  async saveDocument(
    document: ParsedDocument,
    chunks: DocumentChunk[],
    embeddings: number[][],
    embeddingModel: string
  ): Promise<void> {
    if (chunks.length !== embeddings.length) throw new Error("Chunk and embedding counts do not match");
    if (!this.connection) throw new Error("Vector store is not initialized");
    const rows = chunks.map((chunk, index): ChunkRow => {
      const vector = embeddings[index];
      if (!vector) throw new Error(`Missing embedding at index ${index}`);
      if (vector.length !== this.dimensions) {
        throw new Error(`Embedding dimension is ${vector.length}, configured value is ${this.dimensions}`);
      }
      return {
        id: chunk.id,
        documentId: document.id,
        sourcePath: document.sourcePath,
        fileName: document.fileName,
        title: document.title,
        contentHash: document.contentHash,
        pageCount: document.pageCount,
        chunkIndex: chunk.index,
        content: chunk.content,
        tokenEstimate: chunk.tokenEstimate,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        metadata: JSON.stringify({ ...document.metadata, ...chunk.metadata }),
        embeddingModel,
        vector
      };
    });
    if (rows.length === 0) throw new Error("Document produced no chunks");

    const tableNames = await this.connection.tableNames();
    if (!tableNames.includes(TABLE_NAME)) {
      await this.connection.createTable(TABLE_NAME, rows);
      return;
    }
    const table = await this.connection.openTable(TABLE_NAME);
    await this.assertDimensions(table);
    await table.delete(`sourcePath = '${escapeSqlString(document.sourcePath)}'`);
    await table.add(rows);
  }

  async search(embedding: number[], limit: number): Promise<SearchResult[]> {
    if (!this.connection) throw new Error("Vector store is not initialized");
    if (embedding.length !== this.dimensions) {
      throw new Error(`Query embedding dimension is ${embedding.length}, configured value is ${this.dimensions}`);
    }
    const tableNames = await this.connection.tableNames();
    if (!tableNames.includes(TABLE_NAME)) return [];
    const table = await this.connection.openTable(TABLE_NAME);
    await this.assertDimensions(table);
    const rows = await table.query()
      .nearestTo(embedding)
      .distanceType("cosine")
      .limit(limit)
      .toArray() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      content: String(row.content),
      score: 1 - Number(row._distance),
      sourcePath: String(row.sourcePath),
      title: String(row.title),
      pageStart: Number(row.pageStart),
      pageEnd: Number(row.pageEnd),
      metadata: JSON.parse(String(row.metadata)) as Record<string, unknown>
    }));
  }

  async close(): Promise<void> {
    this.connection = undefined;
  }

  private async assertDimensions(table: Table): Promise<void> {
    const sample = await table.query().select(["vector"]).limit(1).toArray() as Array<{ vector?: number[] }>;
    const storedDimensions = sample[0]?.vector?.length;
    if (storedDimensions !== undefined && storedDimensions !== this.dimensions) {
      throw new Error(
        `LanceDB embedding dimension is ${storedDimensions}, configured value is ${this.dimensions}. ` +
        `Delete ${path.resolve(this.databasePath)} before switching embedding models.`
      );
    }
  }
}
