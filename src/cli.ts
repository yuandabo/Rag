#!/usr/bin/env node
import { Command } from "commander";
import { ZodError } from "zod";
import { loadConfig, loadExtractionConfig } from "./config.js";
import { ask, extract, ingest, search } from "./pipeline.js";

const program = new Command()
  .name("rag-pipeline")
  .description("PDF knowledge-base ingestion pipeline for LanceDB")
  .version("1.0.0");

program
  .command("extract")
  .description("Parse PDFs and write Markdown/JSON/chunks without embeddings")
  .argument("<path>", "PDF file or directory")
  .action(async (input: string) => extract(input, loadExtractionConfig()));

program
  .command("ingest")
  .description("Parse and ingest one PDF or a directory of PDFs")
  .argument("<path>", "PDF file or directory")
  .action(async (input: string) => ingest(input, loadConfig()));

program
  .command("search")
  .description("Run semantic similarity search")
  .argument("<query>", "Natural-language query")
  .option("-k, --limit <number>", "Number of results", "5")
  .action(async (query: string, options: { limit: string }) => {
    const limit = Number.parseInt(options.limit, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be between 1 and 100");
    await search(query, limit, loadConfig());
  });

program
  .command("ask")
  .description("Retrieve LanceDB context and answer through the chat relay")
  .argument("<question>", "Natural-language question")
  .option("-k, --limit <number>", "Number of context chunks", "5")
  .action(async (question: string, options: { limit: string }) => {
    const limit = Number.parseInt(options.limit, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("limit must be between 1 and 20");
    await ask(question, limit, loadConfig());
  });

program.parseAsync().catch((error: unknown) => {
  if (error instanceof ZodError) {
    console.error(error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
