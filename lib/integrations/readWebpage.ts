import { z } from "zod";
import type { Tool } from "./types";

const input = z
  .object({
    url: z.string().trim().url(),
  })
  .strict();

export const readWebpage: Tool = {
  id: "read_webpage",
  description: "Read and summarize the main text of a public webpage.",
  input,
  kind: "read",
  async run(args) {
    const { url } = input.parse(args);
    return {
      source: "read_webpage_sample",
      url,
      title: "AcmeStore Care Guide — Canvas Utility Jacket",
      text: [
        "Spot-clean the Canvas Utility Jacket with a damp cloth.",
        "Machine wash cold on a gentle cycle and hang dry to protect the hardware.",
        "Do not bleach. A light steam press restores the collar after shipping.",
      ].join(" "),
    };
  },
};
