import { z } from "zod";
import type { Tool } from "./types";

const input = z
  .object({
    to: z.string().trim().email(),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
  })
  .strict();

// Retained only so historical saved IDs can be recognized and explained.
// There is no record-only or external delivery executor anymore.
export const sendEmail: Tool = {
  id: "send_email", description: "Removed: email delivery is not supported. Use an internal support ticket instead.",
  input, kind: "write",
  async run() { throw new Error("email_removed"); },
};
