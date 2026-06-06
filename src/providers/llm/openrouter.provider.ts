import axios from "axios";
import { LLMProvider, LLMReport } from "../../types";
import { validateReport } from "../../utils/validate-report";

const TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = `You are a meeting/audio analysis assistant.
Analyze the provided transcript and return ONLY a valid JSON object with this exact structure:
{
  "summary": "2-4 sentence summary of the audio content",
  "topics": ["topic1", "topic2"],
  "sentiment": "positive" | "neutral" | "negative",
  "action_items": ["action1", "action2"]
}
Rules:
- Return ONLY the raw JSON object, no markdown, no code fences, no explanation
- summary must be 2-4 sentences
- topics is an array of strings
- sentiment must be exactly one of: positive, neutral, negative
- action_items is an array of strings (can be empty)`;

interface OpenRouterMessage {
  role: "system" | "user";
  content: string;
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class OpenRouterLLMProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly apiUrl = "https://openrouter.ai/api/v1/chat/completions";

  constructor(apiKey: string, model = "openai/gpt-oss-120b:free") {
    if (!apiKey) throw new Error("LLM_API_KEY is required for OpenRouterLLMProvider");
    this.apiKey = apiKey;
    this.model = model;
  }

  async analyze(text: string): Promise<LLMReport> {
    const messages: OpenRouterMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Transcript:\n\n${text}` },
    ];

    let response;
    try {
      response = await axios.post<OpenRouterResponse>(
        this.apiUrl,
        {
          model: this.model,
          messages,
          temperature: 0.1,
          response_format: { type: "json_object" },
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://audio-saas.local",
          },
          timeout: TIMEOUT_MS,
        }
      );
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const body = err.response?.data;
        const detail = body?.error?.message ?? body?.message ?? JSON.stringify(body);
        throw new Error(
          `OpenRouter LLM API error ${status}: ${detail ?? err.message}`
        );
      }
      throw err;
    }

    const raw = response.data?.choices?.[0]?.message?.content ?? "";
    if (!raw.trim()) throw new Error("OpenRouter LLM returned empty response");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`LLM_INVALID_JSON: response was not valid JSON — ${raw.slice(0, 300)}`);
    }

    return validateReport(parsed);
  }
}
