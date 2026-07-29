import path from "node:path";
import { mkdir } from "node:fs/promises";
import express from "express";
import multer from "multer";
import { loadConfig } from "./config.js";
import { VectorStore } from "./db.js";
import { ask, ingest, search } from "./pipeline.js";

const config = loadConfig();
const app = express();
const port = Number(process.env.PORT || 3000);
const uploadDir = path.resolve("data/uploads");
await mkdir(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf"))
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.resolve("public")));

app.get("/api/library", async (_request, response, next) => {
  try {
    const store = new VectorStore(config.lanceDbPath, config.embeddingDimensions);
    await store.initialize();
    try {
      response.json(await store.inspect(20, false));
    } finally {
      await store.close();
    }
  } catch (error) {
    next(error);
  }
});

app.post("/api/ingest", upload.single("pdf"), async (request, response, next) => {
  try {
    if (!request.file) throw new Error("请选择 PDF 文件");
    // multer 默认按 latin1 处理文件名，需还原为 UTF-8
    const originalName = Buffer.from(request.file.originalname, "latin1").toString("utf-8");
    const safeName = originalName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 200);
    const target = path.join(uploadDir, safeName);
    await import("node:fs/promises").then(({ rename }) => rename(request.file!.path, target));
    response.json({ documents: await ingest(target, config) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/search", async (request, response, next) => {
  try {
    const query = String(request.body.query || "").trim();
    if (!query) throw new Error("请输入搜索内容");
    response.json({ results: await search(query, Math.min(Number(request.body.limit) || 5, 20), config) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/ask", async (request, response, next) => {
  try {
    const question = String(request.body.question || "").trim();
    if (!question) throw new Error("请输入问题");
    response.json(await ask(question, Math.min(Number(request.body.limit) || 5, 10), config));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(500).json({ error: error instanceof Error ? error.message : "未知错误" });
});

app.listen(port, "127.0.0.1", () => console.log(`RAG workspace: http://127.0.0.1:${port}`));
