import { expect, it } from "vitest";
import { APICallError } from "ai";
import { modelFailureReason, toolFailureReason } from "./failures";
import { describeReason } from "@/lib/runs/format";
it.each([[400,"model_request_rejected"],[401,"model_access_denied"],[403,"model_access_denied"],[404,"model_not_found"],[429,"model_rate_limited"],[503,"model_unavailable"]])("maps Gemini HTTP %s without exposing response secrets", (status, reason) => {
  const error = new APICallError({ message: "SECRET body", url: "https://secret.example/?key=SECRET", requestBodyValues: {}, statusCode: status as number, responseBody: "SECRET" });
  expect(modelFailureReason(error)).toBe(reason);
  expect(describeReason(reason as string)).not.toContain("SECRET");
});
it("keeps arbitrary tool and driver exceptions private", () => {
  expect(toolFailureReason(new Error("password=secret"))).toBe("tool_execution_failed");
  expect(modelFailureReason(new Error("password=secret"))).toBe("model_response_invalid");
  expect(toolFailureReason(new Error("search_not_configured"))).toBe("search_not_configured");
  expect(describeReason("execution_failed")).toContain("No specific cause was recorded");
});
