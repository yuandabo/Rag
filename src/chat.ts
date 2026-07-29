interface ChatOptions {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  ollamaBaseUrl?: string;
}

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

export class ChatService {
  constructor(private readonly options: ChatOptions) {}

  async answer(question: string, context: string): Promise<string> {
    if (!this.options.baseUrl) throw new Error("OPENAI_BASE_URL is required for the ask command");
    const messages = [
      {
        role: "system",
        content: "你是知识库问答助手。仅根据提供的资料回答；资料不足时明确说明。回答时引用资料中的文件名和页码。"
      },
      {
        role: "user",
        content: `资料：\n${context}\n\n问题：${question}`
      }
    ];

    // 优先调用 Ollama 原生接口以关闭思考、加速响应
    if (this.isOllama()) {
      return this.callOllama(messages);
    }
    return this.callOpenAiCompatible(messages);
  }

  private isOllama(): boolean {
    const url = this.options.baseUrl ?? "";
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) && /11434/.test(url);
  }

  private async callOllama(messages: Array<{ role: string; content: string }>): Promise<string> {
    const ollamaUrl = (this.options.ollamaBaseUrl || "http://localhost:11434").replace(/\/$/, "");
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        messages,
        stream: false,
        think: false,
        options: { num_ctx: 8192 }
      }),
      signal: AbortSignal.timeout(300000)
    });
    const text = await response.text();
    let body: OllamaChatResponse;
    try {
      body = JSON.parse(text) as OllamaChatResponse;
    } catch {
      throw new Error(`Ollama returned invalid JSON (${response.status}): ${text.slice(0, 500)}`);
    }
    if (!response.ok) {
      throw new Error(`Ollama chat failed (${response.status}): ${body.error ?? text.slice(0, 500)}`);
    }
    const answer = body.message?.content;
    if (!answer) throw new Error("Ollama returned no answer");
    return answer;
  }

  private async callOpenAiCompatible(messages: Array<{ role: string; content: string }>): Promise<string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.options.apiKey) headers.Authorization = `Bearer ${this.options.apiKey}`;
    let response: Response | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      response = await fetch(`${this.options.baseUrl!.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: this.options.model, messages }),
        signal: AbortSignal.timeout(300000)
      });
      if (response.ok || (response.status !== 429 && response.status < 500)) break;
      if (attempt < 3) {
        console.warn(`Chat relay returned ${response.status}; retrying (${attempt}/2)...`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
      }
    }
    if (!response) throw new Error("Chat request did not receive a response");
    const text = await response.text();
    let body: {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new Error(`Chat provider returned invalid JSON (${response.status}): ${text.slice(0, 500)}`);
    }
    if (!response.ok) {
      throw new Error(`Chat request failed (${response.status}): ${body.error?.message ?? text.slice(0, 500)}`);
    }
    const answer = body.choices?.[0]?.message?.content;
    if (!answer) throw new Error("Chat provider returned no answer");
    return answer;
  }
}
