import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import { TranscriptionProvider } from "../../types";

const TIMEOUT_MS = 30_000;

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  private readonly apiKey: string;
  private readonly apiUrl = "https://api.openai.com/v1/audio/transcriptions";

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("TRANSCRIPTION_API_KEY is required for OpenAITranscriptionProvider");
    this.apiKey = apiKey;
  }

  async transcribe(filePath: string): Promise<string> {
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), {
      filename: path.basename(filePath),
    });
    form.append("model", "whisper-1");
    form.append("response_format", "text");

    const response = await axios.post<string>(this.apiUrl, form, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...form.getHeaders(),
      },
      timeout: TIMEOUT_MS,
    });

    if (typeof response.data !== "string" || response.data.trim() === "") {
      throw new Error("OpenAI transcription returned empty result");
    }

    return response.data.trim();
  }
}
