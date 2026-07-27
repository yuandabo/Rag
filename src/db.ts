import pg from "pg";
import type { DocumentChunk, ParsedDocument, SearchResult } from "./types.js";

const { Pool } = pg;

function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export class VectorStore {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string, private readonly dimensions: number) {
    this.pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 15000 });
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");
      await client.query(`
        CREATE TABLE IF NOT EXISTS rag_documents (
          id uuid PRIMARY KEY,
          source_path text NOT NULL UNIQUE,
          file_name text NOT NULL,
          title text NOT NULL,
          content_hash text NOT NULL,
          page_count integer NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS rag_chunks (
          id uuid PRIMARY KEY,
          document_id uuid NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
          chunk_index integer NOT NULL,
          content text NOT NULL,
          token_estimate integer NOT NULL,
          page_start integer NOT NULL,
          page_end integer NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          embedding_model text NOT NULL,
          embedding vector(${this.dimensions}) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(document_id, chunk_index)
        )
      `);
      const dimension = await client.query<{ dimensions: number }>(
        "SELECT atttypmod AS dimensions FROM pg_attribute WHERE attrelid = 'rag_chunks'::regclass AND attname = 'embedding'"
      );
      if (dimension.rows[0]?.dimensions !== this.dimensions) {
        throw new Error(`Database embedding dimension is ${dimension.rows[0]?.dimensions}, configured value is ${this.dimensions}`);
      }
      await client.query(`
        CREATE INDEX IF NOT EXISTS rag_chunks_embedding_hnsw_idx
        ON rag_chunks USING hnsw (embedding vector_cosine_ops)
      `);
      await client.query("CREATE INDEX IF NOT EXISTS rag_chunks_document_idx ON rag_chunks(document_id)");
    } finally {
      client.release();
    }
  }

  async saveDocument(
    document: ParsedDocument,
    chunks: DocumentChunk[],
    embeddings: number[][],
    embeddingModel: string
  ): Promise<void> {
    if (chunks.length !== embeddings.length) throw new Error("Chunk and embedding counts do not match");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM rag_documents WHERE source_path = $1 FOR UPDATE",
        [document.sourcePath]
      );
      const documentId = existing.rows[0]?.id ?? document.id;
      await client.query(
        `INSERT INTO rag_documents (id, source_path, file_name, title, content_hash, page_count, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (source_path) DO UPDATE SET
           file_name = EXCLUDED.file_name, title = EXCLUDED.title,
           content_hash = EXCLUDED.content_hash, page_count = EXCLUDED.page_count,
           metadata = EXCLUDED.metadata, updated_at = now()`,
        [documentId, document.sourcePath, document.fileName, document.title, document.contentHash, document.pageCount, document.metadata]
      );
      await client.query("DELETE FROM rag_chunks WHERE document_id = $1", [documentId]);
      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        const embedding = embeddings[index];
        if (!chunk || !embedding) throw new Error(`Missing chunk or embedding at index ${index}`);
        await client.query(
          `INSERT INTO rag_chunks
           (id, document_id, chunk_index, content, token_estimate, page_start, page_end, metadata, embedding_model, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector)`,
          [chunk.id, documentId, chunk.index, chunk.content, chunk.tokenEstimate, chunk.pageStart, chunk.pageEnd, chunk.metadata, embeddingModel, vectorLiteral(embedding)]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async search(embedding: number[], limit: number): Promise<SearchResult[]> {
    const result = await this.pool.query<SearchResult>(
      `SELECT c.content, 1 - (c.embedding <=> $1::vector) AS score,
              d.source_path AS "sourcePath", d.title,
              c.page_start AS "pageStart", c.page_end AS "pageEnd", c.metadata
       FROM rag_chunks c
       JOIN rag_documents d ON d.id = c.document_id
       ORDER BY c.embedding <=> $1::vector
       LIMIT $2`,
      [vectorLiteral(embedding), limit]
    );
    return result.rows.map((row) => ({ ...row, score: Number(row.score) }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
