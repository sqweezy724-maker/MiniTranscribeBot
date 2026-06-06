import axios, { AxiosError } from "axios";
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

interface GroqLLMResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class GroqLLMProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly apiUrl = "https://api.groq.com/openai/v1/chat/completions";

  constructor(apiKey: string, model = "llama-3.3-70b-versatile") {
    if (!apiKey) throw new Error("LLM_API_KEY is required for GroqLLMProvider");
    this.apiKey = apiKey;
    this.model = model;
  }

  async analyze(text: string): Promise<LLMReport> {
    let response;
    try {
      response = await axios.post<GroqLLMResponse>(
        this.apiUrl,
        {
          model: this.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `Transcript:\n\n${text}` },
          ],
          temperature: 0.1,
          response_format: { type: "json_object" },
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: TIMEOUT_MS,
        }
      );
    } catch (err) {
      // Re-throw with a clear message that includes the HTTP status + body
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const body = err.response?.data;
        const detail = body?.error?.message ?? body?.message ?? JSON.stringify(body);
        throw new Error(
          `Groq LLM API error ${status}: ${detail ?? err.message}`
        );
      }
      throw err;
    }

    const raw = response.data?.choices?.[0]?.message?.content ?? "";
    if (!raw.trim()) throw new Error("Groq LLM returned empty response");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`LLM_INVALID_JSON: response was not valid JSON — ${raw.slice(0, 300)}`);
    }

    return validateReport(parsed);
  }
}
