interface ChatOptions {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  ollamaBaseUrl?: string;
}

type ChatProvider = "anthropic" | "openai" | "ollama";

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

const SYSTEM_PROMPT = "你是知识库问答助手。仅根据提供的资料回答；资料不足时明确说明。回答时引用资料中的文件名和页码。";

export class ChatService {
  constructor(private readonly options: ChatOptions) {}

  async answer(question: string, context: string): Promise<string> {
    if (!this.options.baseUrl) throw new Error("OPENAI_BASE_URL is required for the ask command");
    const provider = this.detectProvider();
    if (provider === "anthropic") return this.callAnthropic(question, context);
    if (provider === "ollama") return this.callOllama(question, context);
    return this.callOpenAiCompatible(question, context);
  }

  private detectProvider(): ChatProvider {
    if (process.env.CHAT_PROVIDER) {
      const v = process.env.CHAT_PROVIDER.toLowerCase();
      if (v === "anthropic" || v === "openai" || v === "ollama") return v;
    }
    const url = this.options.baseUrl ?? "";
    if (/\/api\/?($|\?)/.test(url) || /anthropic/i.test(url)) return "anthropic";
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url) && /11434/.test(url)) return "ollama";
    return "openai";
  }

  private async callAnthropic(question: string, context: string): Promise<string> {
    if (!this.options.apiKey) throw new Error("OPENAI_API_KEY is required for the anthropic chat provider");
    const baseUrl = this.options.baseUrl!.replace(/\/$/, "");
    const url = baseUrl.endsWith("/v1") ? `${baseUrl}/messages` : `${baseUrl}/v1/messages`;
    let response: Response | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": this.options.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.options.model,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: `资料：\n${context}\n\n问题：${question}` }]
        }),
        signal: AbortSignal.timeout(300000)
      });
      if (response.ok || (response.status !== 429 && response.status < 500)) break;
      if (attempt < 3) {
        console.warn(`Anthropic relay returned ${response.status}; retrying (${attempt}/2)...`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
      }
    }
    if (!response) throw new Error("Chat request did not receive a response");
    const text = await response.text();
    let body: {
      content?: Array<{ type?: string; text?: string }>;
      error?: { message?: string } | string;
    };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new Error(`Anthropic provider returned invalid JSON (${response.status}): ${text.slice(0, 500)}`);
    }
    if (!response.ok) {
      const msg = typeof body.error === "string" ? body.error : body.error?.message;
      throw new Error(`Anthropic chat failed (${response.status}): ${msg ?? text.slice(0, 500)}`);
    }
    const answer = body.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
    if (!answer) throw new Error("Anthropic provider returned no answer");
    return answer;
  }

  private async callOllama(question: string, context: string): Promise<string> {
    const ollamaUrl = (this.options.ollamaBaseUrl || "http://localhost:11434").replace(/\/$/, "");
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `资料：\n${context}\n\n问题：${question}` }
    ];
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

  private async callOpenAiCompatible(question: string, context: string): Promise<string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.options.apiKey) headers.Authorization = `Bearer ${this.options.apiKey}`;
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `资料：\n${context}\n\n问题：${question}` }
    ];
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
