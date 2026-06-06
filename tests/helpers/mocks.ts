import { TranscriptionProvider, LLMProvider, LLMReport } from "../../src/types";

export const MOCK_TRANSCRIPT = "This is a meeting about Q3 planning and budget allocation.";

export const MOCK_REPORT: LLMReport = {
  summary: "The meeting covered Q3 planning and budget allocation. Key decisions were made about resource distribution. Action items were assigned to team leads. Follow-up meeting scheduled for next week.",
  topics: ["Q3 planning", "budget allocation", "resource distribution"],
  sentiment: "neutral",
  action_items: ["Assign budget to teams", "Schedule follow-up meeting"],
};

// ─── Happy-path mocks ─────────────────────────────────────────────────────────

export function createMockTranscriptionProvider(
  transcript = MOCK_TRANSCRIPT
): TranscriptionProvider {
  return {
    transcribe: async (_filePath: string) => transcript,
  };
}

export function createMockLLMProvider(report = MOCK_REPORT): LLMProvider {
  return {
    analyze: async (_text: string) => report,
  };
}

// ─── Failing mocks ─────────────────────────────────────────────────────────────

export function createFailingTranscriptionProvider(
  failTimes = 1
): TranscriptionProvider & { callCount: number } {
  let callCount = 0;
  return {
    get callCount() { return callCount; },
    transcribe: async (_filePath: string) => {
      callCount++;
      if (callCount <= failTimes) {
        throw new Error("TRANSCRIPTION_FAILED: service temporarily unavailable");
      }
      return MOCK_TRANSCRIPT;
    },
  };
}

export function createAlwaysFailingTranscriptionProvider(): TranscriptionProvider {
  return {
    transcribe: async (_filePath: string) => {
      throw new Error("TRANSCRIPTION_FAILED: permanent error");
    },
  };
}

export function createInvalidJsonLLMProvider(failTimes = 2): LLMProvider & { callCount: number } {
  let callCount = 0;
  return {
    get callCount() { return callCount; },
    analyze: async (_text: string) => {
      callCount++;
      if (callCount <= failTimes) {
        // Return something that will fail validation
        throw new Error("LLM_INVALID_JSON: not valid json");
      }
      return MOCK_REPORT;
    },
  };
}

export function createInvalidStructureLLMProvider(): LLMProvider {
  return {
    analyze: async (_text: string) => {
      // Returns an object missing required fields — validation will throw
      return { summary: "ok" } as unknown as LLMReport;
    },
  };
}
