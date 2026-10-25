import { z } from "zod";
import type { Tool } from "./types";

const input = z
  .object({
    to: z.string().trim().email(),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
  })
  .strict();

type RecordedEmail = {
  status: "recorded";
  messageId: string;
  to: string;
  subject: string;
  body: string;
  provider: "mock";
  note: "recorded only, not sent";
};

const recordedEmails: RecordedEmail[] = [];

export const sendEmail: Tool = {
  id: "send_email",
  description: "Record a sample email. Application execution uses the guarded persistent runtime adapter.",
  input,
  kind: "write",
  async run(args) {
    const { to, subject, body } = input.parse(args);
    const recorded: RecordedEmail = {
      status: "recorded",
      messageId: `msg_sample_${String(recordedEmails.length + 1).padStart(4, "0")}`,
      to,
      subject,
      body,
      provider: "mock",
      note: "recorded only, not sent",
    };
    recordedEmails.push(recorded);
    return {
      ...recorded,
      recordedCount: recordedEmails.length,
    };
  },
};
