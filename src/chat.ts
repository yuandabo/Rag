interface ChatOptions {
  apiKey?: string;
  baseUrl?: string;
  model: string;
}

export class ChatService {
  constructor(private readonly options: ChatOptions) {}

  async answer(question: string, context: string): Promise<string> {
    if (!this.options.baseUrl) throw new Error("OPENAI_BASE_URL is required for the ask command");
    const request = {
      model: this.options.model,
      messages: [
        {
          role: "system",
          content: "你是知识库问答助手。仅根据提供的资料回答；资料不足时明确说明。回答时引用资料中的文件名和页码。"
        },
        {
          role: "user",
          content: `资料：\n${context}\n\n问题：${question}`
        }
      ]
    };
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.options.apiKey) headers.Authorization = `Bearer ${this.options.apiKey}`;
    let response: Response | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(120000)
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
