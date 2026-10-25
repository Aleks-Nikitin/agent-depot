import { expect, it } from "vitest";
import { toYaml } from "./yaml";

it("preserves empty tool arrays and string values that YAML would coerce", () => {
  expect(toYaml({ name: "true", model: "gemini", enabledTools: [], version: 1 })).toBe('name: "true"\nmodel: "gemini"\nenabledTools: []\nversion: 1\n');
  expect(toYaml({ name: "123", instructions: "line one\nline two" })).toContain('name: "123"\ninstructions: |\n  line one\n  line two\n');
});
