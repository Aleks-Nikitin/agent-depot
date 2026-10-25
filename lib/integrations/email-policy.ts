import { z } from "zod";

export const LegacyEmailInput = z.object({
  to: z.email().max(254),
  subject: z.string().trim().min(1).max(200).refine(value => !/[\r\n\x00]/.test(value), "Subject must be one line"),
  body: z.string().trim().min(1).max(5000).refine(value => !value.includes("\x00"), "Invalid message"),
}).strict();
export const TemplateEmailInput = z.object({
  to: z.email().max(254),
  template: z.enum(["support_acknowledgement", "review_request"]),
  ticketId: z.uuid(),
}).strict();
export const EmailInputSchema = z.union([TemplateEmailInput, LegacyEmailInput]);
export const RecordedEmailOutputSchema = LegacyEmailInput.extend({
  status: z.literal("recorded"), messageId: z.string().min(1), provider: z.literal("demo"), note: z.literal("recorded only, not sent"),
}).strict();

/** Automatic content is rendered by the server, never unconstrained model prose. */
export function renderSupportEmail(input: z.infer<typeof TemplateEmailInput>) {
  const reference = `Support request ${input.ticketId}`;
  return LegacyEmailInput.parse({ to: input.to,
    subject: input.template === "support_acknowledgement" ? `${reference} received` : `${reference}: review requested`,
    body: input.template === "support_acknowledgement"
      ? `Hello,\n\nWe have recorded your support request with reference ${input.ticketId}. This acknowledgement does not confirm a refund, payment or account change.\n\nCustomer Support`
      : `Please review the recorded support request with reference ${input.ticketId}. This message does not authorize a refund, payment or account change.\n\nCustomer Support`,
  });
}
