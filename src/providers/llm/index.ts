import { LLMProvider } from "../../types";
import { OpenRouterLLMProvider } from "./openrouter.provider";
import { GroqLLMProvider } from "./groq.provider";

export function createLLMProvider(name: string, apiKey: string): LLMProvider {
  switch (name.toLowerCase()) {
    case "openrouter":
      return new OpenRouterLLMProvider(apiKey);
    case "groq":
      return new GroqLLMProvider(apiKey);
    default:
      throw new Error(`Unknown LLM provider: ${name}`);
  }
}

export { OpenRouterLLMProvider, GroqLLMProvider };
