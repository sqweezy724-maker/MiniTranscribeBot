import { describe, it, expect } from "vitest";
import { validateReport } from "../../src/utils/validate-report";

describe("validateReport", () => {
  const validReport = {
    summary: "This is a valid summary with enough content.",
    topics: ["topic1", "topic2"],
    sentiment: "neutral" as const,
    action_items: ["Do this", "Do that"],
  };

  it("accepts a fully valid report", () => {
    const result = validateReport(validReport);
    expect(result).toEqual(validReport);
  });

  it("accepts positive sentiment", () => {
    const result = validateReport({ ...validReport, sentiment: "positive" });
    expect(result.sentiment).toBe("positive");
  });

  it("accepts negative sentiment", () => {
    const result = validateReport({ ...validReport, sentiment: "negative" });
    expect(result.sentiment).toBe("negative");
  });

  it("accepts empty topics and action_items arrays", () => {
    const result = validateReport({ ...validReport, topics: [], action_items: [] });
    expect(result.topics).toEqual([]);
    expect(result.action_items).toEqual([]);
  });

  it("throws if summary is missing", () => {
    expect(() => validateReport({ ...validReport, summary: undefined })).toThrow();
  });

  it("throws if summary is empty string", () => {
    expect(() => validateReport({ ...validReport, summary: "" })).toThrow();
  });

  it("throws if summary is a number", () => {
    expect(() => validateReport({ ...validReport, summary: 42 })).toThrow();
  });

  it("throws if topics is not an array", () => {
    expect(() => validateReport({ ...validReport, topics: "topic" })).toThrow();
  });

  it("throws if topics contains non-strings", () => {
    expect(() => validateReport({ ...validReport, topics: [1, 2] })).toThrow();
  });

  it("throws if sentiment is invalid", () => {
    expect(() => validateReport({ ...validReport, sentiment: "happy" })).toThrow();
    expect(() => validateReport({ ...validReport, sentiment: "" })).toThrow();
    expect(() => validateReport({ ...validReport, sentiment: null })).toThrow();
  });

  it("throws if action_items is not an array", () => {
    expect(() => validateReport({ ...validReport, action_items: "do stuff" })).toThrow();
  });

  it("throws if action_items contains non-strings", () => {
    expect(() => validateReport({ ...validReport, action_items: [true, false] })).toThrow();
  });

  it("throws if input is null", () => {
    expect(() => validateReport(null)).toThrow();
  });

  it("throws if input is a primitive", () => {
    expect(() => validateReport("string")).toThrow();
    expect(() => validateReport(42)).toThrow();
  });
});
