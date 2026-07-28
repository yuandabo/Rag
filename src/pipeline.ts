import path from "node:path";
import fg from "fast-glob";
import type { AppConfig, ExtractionConfig } from "./config.js";
import { chunkDocument } from "./chunk.js";
import { ChatService } from "./chat.js";
import { VectorStore } from "./db.js";
import { EmbeddingService } from "./embedding.js";
import { writeArtifacts } from "./output.js";
import { parsePdf } from "./pdf.js";

export async function resolvePdfFiles(input: string): Promise<string[]> {
  const normalized = input.replace(/\\/g, "/");
  const patterns = normalized.toLowerCase().endsWith(".pdf") ? [normalized] : [`${normalized}/**/*.pdf`];
  return (await fg(patterns, { absolute: true, onlyFiles: true })).sort();
}

export async function extract(input: string, config: ExtractionConfig): Promise<void> {
  const files = await resolvePdfFiles(input);
  if (files.length === 0) throw new Error(`No PDF files found at ${path.resolve(input)}`);

  for (const [fileIndex, file] of files.entries()) {
    console.log(`[${fileIndex + 1}/${files.length}] Parsing ${file}`);
    const document = await parsePdf(file);
    const chunks = chunkDocument(document, config.chunkSize, config.chunkOverlap);
    await writeArtifacts(config.outputDir, document, chunks);
    console.log(`  Wrote Markdown, JSON and ${chunks.length} chunks`);
  }
}

export async function ingest(input: string, config: AppConfig): Promise<void> {
  const files = await resolvePdfFiles(input);
  if (files.length === 0) throw new Error(`No PDF files found at ${path.resolve(input)}`);

  const embeddings = createEmbeddingService(config);
  const store = new VectorStore(config.lanceDbPath, config.embeddingDimensions);
  console.log(`Opening LanceDB at ${path.resolve(config.lanceDbPath)}...`);
  await store.initialize();
  try {
    for (const [fileIndex, file] of files.entries()) {
      console.log(`[${fileIndex + 1}/${files.length}] Parsing ${file}`);
      const document = await parsePdf(file);
      const chunks = chunkDocument(document, config.chunkSize, config.chunkOverlap);
      await writeArtifacts(config.outputDir, document, chunks);
      const vectors: number[][] = [];
      for (let start = 0; start < chunks.length; start += config.embeddingBatchSize) {
        const batch = chunks.slice(start, start + config.embeddingBatchSize);
        console.log(`  Embedding chunks ${start + 1}-${start + batch.length}/${chunks.length}`);
        vectors.push(...await embeddings.embed(batch.map((chunk) => chunk.content)));
      }
      await store.saveDocument(document, chunks, vectors, config.embeddingModel);
      console.log(`  Stored ${chunks.length} chunks (${document.pageCount} pages)`);
    }
  } finally {
    await store.close();
  }
}

export async function search(query: string, limit: number, config: AppConfig): Promise<void> {
  const embeddings = createEmbeddingService(config);
  const store = new VectorStore(config.lanceDbPath, config.embeddingDimensions);
  console.log(`Opening LanceDB at ${path.resolve(config.lanceDbPath)}...`);
  await store.initialize();
  try {
    const [vector] = await embeddings.embed([query]);
    if (!vector) throw new Error("Embedding API returned no vector");
    const results = await store.search(vector, limit);
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await store.close();
  }
}

export async function ask(question: string, limit: number, config: AppConfig): Promise<void> {
  const embeddings = createEmbeddingService(config);
  const store = new VectorStore(config.lanceDbPath, config.embeddingDimensions);
  console.log(`Opening LanceDB at ${path.resolve(config.lanceDbPath)}...`);
  await store.initialize();
  try {
    const [vector] = await embeddings.embed([question]);
    if (!vector) throw new Error("Embedding provider returned no vector");
    const results = await store.search(vector, limit);
    if (results.length === 0) throw new Error("The knowledge base contains no matching chunks");
    const context = results.map((result, index) =>
      `[资料 ${index + 1} | ${result.title} | 第 ${result.pageStart}-${result.pageEnd} 页 | 相似度 ${result.score.toFixed(4)}]\n${result.content}`
    ).join("\n\n");
    const chat = new ChatService({
      apiKey: config.openAiApiKey,
      baseUrl: config.openAiBaseUrl,
      model: config.openAiChatModel
    });
    console.log(await chat.answer(question, context));
  } finally {
    await store.close();
  }
}

function createEmbeddingService(config: AppConfig): EmbeddingService {
  return new EmbeddingService({
    provider: config.embeddingProvider,
    model: config.embeddingModel,
    dimensions: config.embeddingDimensions,
    openAiApiKey: config.openAiApiKey,
    openAiBaseUrl: config.openAiBaseUrl,
    ollamaBaseUrl: config.ollamaBaseUrl
  });
}
