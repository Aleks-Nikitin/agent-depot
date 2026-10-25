import { z } from "zod";
import type { Tool } from "./types";

const input = z
  .object({
    to: z.string().trim().email(),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
  })
  .strict();

export const sendEmail: Tool = {
  id: "send_email",
  description: "Send an outbound email. This is a write action and should be treated as side-effecting.",
  input,
  kind: "write",
  async run(args) {
    const { to, subject, body } = input.parse(args);
    return {
      status: "queued",
      messageId: "msg_acme_sample_1042",
      to,
      subject,
      preview: body.slice(0, 140),
      provider: "acme_mail_sample",
    };
  },
};
