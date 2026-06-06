import { LLMProvider } from "../../types";
import { GroqLLMProvider } from "./groq.provider";
import { OpenRouterLLMProvider } from "./openrouter.provider";

export function createLLMProvider(name: string, apiKey: string): LLMProvider {
  switch (name.toLowerCase()) {
    case "groq":
      return new GroqLLMProvider(apiKey);
    case "openrouter":
      return new OpenRouterLLMProvider(apiKey);
    default:
      throw new Error(`Unknown LLM provider: "${name}". Available: groq, openrouter`);
  }
}

export { GroqLLMProvider, OpenRouterLLMProvider };
