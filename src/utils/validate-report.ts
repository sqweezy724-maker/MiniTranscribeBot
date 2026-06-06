import { LLMReport } from "../types";

/**
 * Validates that the raw object matches the strict LLMReport schema.
 * Throws if any field is invalid.
 */
export function validateReport(obj: unknown): LLMReport {
  if (typeof obj !== "object" || obj === null) {
    throw new Error("Report must be a non-null object");
  }

  const r = obj as Record<string, unknown>;

  if (typeof r.summary !== "string" || r.summary.trim() === "") {
    throw new Error("Invalid report: summary must be a non-empty string");
  }

  if (!Array.isArray(r.topics) || !r.topics.every((t) => typeof t === "string")) {
    throw new Error("Invalid report: topics must be an array of strings");
  }

  const validSentiments = ["positive", "neutral", "negative"] as const;
  if (!validSentiments.includes(r.sentiment as (typeof validSentiments)[number])) {
    throw new Error(`Invalid report: sentiment must be one of ${validSentiments.join(", ")}`);
  }

  if (!Array.isArray(r.action_items) || !r.action_items.every((a) => typeof a === "string")) {
    throw new Error("Invalid report: action_items must be an array of strings");
  }

  return {
    summary: r.summary as string,
    topics: r.topics as string[],
    sentiment: r.sentiment as LLMReport["sentiment"],
    action_items: r.action_items as string[],
  };
}
