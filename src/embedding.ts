import OpenAI from "openai";

interface EmbeddingOptions {
  provider: "openai" | "ollama";
  model: string;
  dimensions: number;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  ollamaBaseUrl: string;
}

export class EmbeddingService {
  private readonly openAiClient?: OpenAI;

  constructor(private readonly options: EmbeddingOptions) {
    if (options.provider === "openai") {
      this.openAiClient = new OpenAI({
        apiKey: options.openAiApiKey,
        baseURL: options.openAiBaseUrl
      });
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const vectors = this.options.provider === "ollama"
      ? await this.embedWithOllama(texts)
      : await this.embedWithOpenAi(texts);
    if (vectors.length !== texts.length) {
      throw new Error(`Embedding provider returned ${vectors.length} vectors for ${texts.length} texts`);
    }
    for (const vector of vectors) {
      if (vector.length !== this.options.dimensions) {
        throw new Error(
          `Model ${this.options.model} returned ${vector.length} dimensions, but EMBEDDING_DIMENSIONS is ${this.options.dimensions}`
        );
      }
    }
    return vectors;
  }

  private async embedWithOpenAi(texts: string[]): Promise<number[][]> {
    if (!this.openAiClient) throw new Error("OpenAI embedding client is not configured");
    const response = await this.openAiClient.embeddings.create({
      model: this.options.model,
      input: texts,
      dimensions: this.options.dimensions,
      encoding_format: "float"
    });
    return response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }

  private async embedWithOllama(texts: string[]): Promise<number[][]> {
    console.log(`Requesting Ollama embeddings (${this.options.model})...`);
    const response = await fetch(`${this.options.ollamaBaseUrl.replace(/\/$/, "")}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.options.model, input: texts }),
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embedding request failed (${response.status}): ${body}`);
    }
    const body = await response.json() as { embeddings?: number[][] };
    if (!Array.isArray(body.embeddings)) {
      throw new Error("Ollama response did not contain embeddings");
    }
    return body.embeddings;
  }
}
