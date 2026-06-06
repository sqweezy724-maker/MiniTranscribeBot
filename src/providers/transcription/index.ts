import { TranscriptionProvider } from "../../types";
import { GroqTranscriptionProvider } from "./groq.provider";
import { OpenAITranscriptionProvider } from "./openai.provider";

export function createTranscriptionProvider(
  name: string,
  apiKey: string
): TranscriptionProvider {
  switch (name.toLowerCase()) {
    case "groq":
      return new GroqTranscriptionProvider(apiKey);
    case "openai":
      return new OpenAITranscriptionProvider(apiKey);
    default:
      throw new Error(`Unknown transcription provider: ${name}`);
  }
}

export { GroqTranscriptionProvider, OpenAITranscriptionProvider };
