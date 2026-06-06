import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import { TranscriptionProvider } from "../../types";

const TIMEOUT_MS = 30_000;

export class GroqTranscriptionProvider implements TranscriptionProvider {
  private readonly apiKey: string;
  private readonly apiUrl = "https://api.groq.com/openai/v1/audio/transcriptions";

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("TRANSCRIPTION_API_KEY is required for GroqTranscriptionProvider");
    this.apiKey = apiKey;
  }

  async transcribe(filePath: string): Promise<string> {
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), {
      filename: path.basename(filePath),
    });
    form.append("model", "whisper-large-v3-turbo");  // current recommended model
    form.append("response_format", "text");

    let response;
    try {
      response = await axios.post<string>(this.apiUrl, form, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...form.getHeaders(),
        },
        timeout: TIMEOUT_MS,
      });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const body = err.response?.data;
        const detail = body?.error?.message ?? body?.message ?? JSON.stringify(body);
        throw new Error(
          `Groq Transcription API error ${status}: ${detail ?? err.message}`
        );
      }
      throw err;
    }

    if (typeof response.data !== "string" || response.data.trim() === "") {
      throw new Error("Groq transcription returned empty result");
    }

    return response.data.trim();
  }
}
