import { expect, it } from "vitest";
import { EmailInputSchema, LegacyEmailInput, renderSupportEmail, TemplateEmailInput } from "./email-policy";

it("renders only fixed factual content from a strict ticket reference", () => {
  const input = TemplateEmailInput.parse({ to: "customer@example.test", template: "support_acknowledgement", ticketId: "550e8400-e29b-41d4-a716-446655440000" });
  expect(renderSupportEmail(input)).toMatchObject({ to: input.to, subject: expect.stringContaining(input.ticketId), body: expect.stringContaining("does not confirm a refund") });
  expect(TemplateEmailInput.safeParse({ ...input, body: "Invented refund approved" }).success).toBe(false);
  expect(EmailInputSchema.safeParse({ ...input, to: "a@example.test,b@example.test" }).success).toBe(false);
  expect(TemplateEmailInput.safeParse({ ...input, ticketId: "invented" }).success).toBe(false);
});
it("rejects email header injection and unsupported fields", () => {
  expect(LegacyEmailInput.safeParse({ to: "a@example.test", subject: "Hello\r\nBcc: b@example.test", body: "Message" }).success).toBe(false);
  expect(LegacyEmailInput.safeParse({ to: "a@example.test", subject: "Hello", body: "Message", html: "<script/>" }).success).toBe(false);
});
