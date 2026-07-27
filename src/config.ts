import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  EMBEDDING_PROVIDER: z.enum(["openai", "ollama"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional().or(z.literal("")),
  OPENAI_CHAT_MODEL: z.string().default("gpt-5.5"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).max(2000).default(1536),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/rag"),
  CHUNK_SIZE: z.coerce.number().int().min(100).default(1000),
  CHUNK_OVERLAP: z.coerce.number().int().min(0).default(150),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(2048).default(64),
  OUTPUT_DIR: z.string().default("output")
}).superRefine((config, context) => {
  if (config.EMBEDDING_PROVIDER === "openai" && !config.OPENAI_API_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENAI_API_KEY"],
      message: "OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai"
    });
  }
});

export type AppConfig = ReturnType<typeof loadConfig>;
export type ExtractionConfig = ReturnType<typeof loadExtractionConfig>;

export function loadExtractionConfig() {
  const config = z.object({
    CHUNK_SIZE: z.coerce.number().int().min(100).default(1000),
    CHUNK_OVERLAP: z.coerce.number().int().min(0).default(150),
    OUTPUT_DIR: z.string().default("output")
  }).parse(process.env);
  if (config.CHUNK_OVERLAP >= config.CHUNK_SIZE) {
    throw new Error("CHUNK_OVERLAP must be smaller than CHUNK_SIZE");
  }
  return {
    chunkSize: config.CHUNK_SIZE,
    chunkOverlap: config.CHUNK_OVERLAP,
    outputDir: config.OUTPUT_DIR
  };
}

export function loadConfig() {
  const config = schema.parse(process.env);
  if (config.CHUNK_OVERLAP >= config.CHUNK_SIZE) {
    throw new Error("CHUNK_OVERLAP must be smaller than CHUNK_SIZE");
  }
  return {
    embeddingProvider: config.EMBEDDING_PROVIDER,
    openAiApiKey: config.OPENAI_API_KEY,
    openAiBaseUrl: config.OPENAI_BASE_URL || undefined,
    openAiChatModel: config.OPENAI_CHAT_MODEL,
    ollamaBaseUrl: config.OLLAMA_BASE_URL,
    embeddingModel: config.EMBEDDING_MODEL,
    embeddingDimensions: config.EMBEDDING_DIMENSIONS,
    databaseUrl: config.DATABASE_URL,
    chunkSize: config.CHUNK_SIZE,
    chunkOverlap: config.CHUNK_OVERLAP,
    embeddingBatchSize: config.EMBEDDING_BATCH_SIZE,
    outputDir: config.OUTPUT_DIR
  };
}
