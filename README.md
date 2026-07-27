# PDF RAG Pipeline

一个用于构建 RAG 知识库的 Node.js / TypeScript 小项目：

```text
PDF -> Markdown + JSON -> Chunk -> OpenAI-compatible Embedding -> PostgreSQL/pgvector
```

支持单个 PDF 或目录批量导入、保留中间产物、重复导入覆盖、HNSW 向量索引，以及命令行语义检索。

## 环境要求

- Node.js 20+
- Docker（用于本地 PostgreSQL + pgvector）
- Ollama 本地模型，或 OpenAI/兼容 Embeddings API

## 快速开始

```bash
npm install
docker compose up -d
cp .env.example .env
```

Windows PowerShell 复制配置：

```powershell
Copy-Item .env.example .env
```

默认配置使用免费的本地 Ollama `bge-m3`。先安装 [Ollama](https://ollama.com/)，再下载模型：

```bash
ollama pull bge-m3
```

确保 Ollama 正在运行，`.env.example` 中的默认配置即可直接使用：

```dotenv
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=bge-m3
EMBEDDING_DIMENSIONS=1024
```

如果暂时没有 Embedding API Key，可以只执行解析和切块。该命令不需要数据库，也不需要 `.env`：

```bash
npm run dev -- extract ./pdfs/example.pdf
```

输出位于 `output/<文件哈希前12位>/`，可以直接打开 `document.md`、`document.json` 和 `chunks.json` 查看。

导入单个 PDF：

```bash
npm run dev -- ingest ./pdfs/example.pdf
```

递归导入目录中的所有 PDF：

```bash
npm run dev -- ingest ./pdfs
```

执行向量检索：

```bash
npm run dev -- search "这份文档的核心结论是什么？" --limit 5
```

检索知识库并通过 OpenAI 兼容中转站生成最终答案：

```bash
npm run dev -- ask "这个电阻的额定功率是多少？" --limit 5
```

`ingest` 和 `search` 使用 Ollama 本地 Embedding；`ask` 先用 Ollama + pgvector 检索，再把命中的文本交给 `OPENAI_BASE_URL` 对应的 `/chat/completions`。因此中转站不需要支持 Embedding。

检索结果以 JSON 输出，包含相似度分数、原文、来源路径和页码范围，可直接接到 RAG 的上下文组装阶段。

## 中间产物

每份 PDF 会在 `output/<文件哈希前12位>/` 下生成：

- `document.md`：按页组织的 Markdown
- `document.json`：文档、页级文本和 PDF 元数据
- `chunks.json`：切块文本、页码范围、字符长度估算出的 token 数

这些文件不会包含 embedding，避免输出目录体积快速膨胀；向量直接写入数据库。

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `EMBEDDING_PROVIDER` | `ollama` | `ollama` 或 `openai` |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama 服务地址 |
| `OPENAI_API_KEY` | 空 | 使用 `openai` provider 时必填 |
| `OPENAI_BASE_URL` | 空 | OpenAI 兼容服务地址 |
| `OPENAI_CHAT_MODEL` | `gpt-5.5` | `ask` 使用的聊天模型 |
| `EMBEDDING_MODEL` | `bge-m3` | 向量模型 |
| `EMBEDDING_DIMENSIONS` | `1024` | 向量维度，最大 2000 以支持 pgvector HNSW |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/rag` | PostgreSQL 连接串 |
| `CHUNK_SIZE` | `1000` | 每个 chunk 的目标字符数 |
| `CHUNK_OVERLAP` | `150` | 相邻 chunk 重叠字符数 |
| `EMBEDDING_BATCH_SIZE` | `64` | 每次 embedding 请求的 chunk 数量 |
| `OUTPUT_DIR` | `output` | 中间产物目录 |

修改 `EMBEDDING_DIMENSIONS` 后，如果数据库中已经建表，需要删除本地数据卷后重建，或迁移 `rag_chunks.embedding` 的类型。程序启动时会检查数据库维度并在不一致时明确报错。

如果需要切回 OpenAI：

```dotenv
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-your-key
OPENAI_BASE_URL=
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

本地开发阶段若数据库已经以其他向量维度创建，且数据可以丢弃，可用 `docker compose down -v` 后再 `docker compose up -d` 重建。不同模型生成的向量不能混合检索。

## 数据表

- `rag_documents`：来源、标题、文件哈希、页数和 PDF 元数据
- `rag_chunks`：文本、页码、模型名和 `vector(n)` embedding

同一路径的 PDF 再次导入时，文档记录会更新，旧 chunks 会在同一事务中删除并重建。向量列使用 cosine distance 的 HNSW 索引。

## 生产使用建议

- 将 `source_path` 换成对象存储 URL 或业务文档 ID，避免部署机器路径变化造成重复数据。
- 大批量导入时可把解析/embedding/写库拆成队列任务，并加入 API 限流重试。
- 扫描版 PDF 需要先接 OCR；当前解析器适用于含文本层的 PDF。
- 中文 token 数与字符数并非固定比例，若模型上下文控制要求严格，可接入对应模型的 tokenizer。

## 构建

```bash
npm run typecheck
npm run build
npm start -- search "测试问题"
```
