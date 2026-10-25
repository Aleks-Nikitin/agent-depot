import { z } from "zod";
import { getKnowledgeDocs } from "./store";
import type { KnowledgeDoc, Tool } from "./types";

const input = z
  .object({
    query: z.string().trim().min(1).max(500),
  })
  .strict();

const STOP_WORDS = new Set(["the", "a", "after", "can", "i", "my", "is"]);

function queryWords(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length > 0 && !STOP_WORDS.has(word)),
    ),
  ];
}

function textWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 0);
}

function keywordHitsText(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  const words = textWords(text);
  return keywords.filter((keyword) => {
    if (lower.includes(keyword)) return true;
    return words.some(
      (word) =>
        word === keyword ||
        word.startsWith(keyword) ||
        (keyword.startsWith(word) && word.length >= 3),
    );
  });
}

function scoreDoc(doc: KnowledgeDoc, keywords: string[]): number {
  const titleHits = keywordHitsText(doc.title, keywords).length;
  const bodyHits = keywordHitsText(doc.text, keywords).length;
  return titleHits * 3 + bodyHits * 1;
}

function sentencesOf(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    while (i + 1 < text.length && (text[i + 1] === "." || text[i + 1] === "!" || text[i + 1] === "?")) {
      i += 1;
    }
    const sentence = text.slice(start, i + 1).trim();
    if (sentence) sentences.push(sentence);
    start = i + 1;
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function matchedSentence(text: string, keywords: string[]): string {
  const sentences = sentencesOf(text);
  if (sentences.length === 0) return text.trim();
  let best = sentences[0];
  let bestDensity = -1;
  let bestHits = -1;
  for (const sentence of sentences) {
    const hits = keywordHitsText(sentence, keywords).length;
    const words = Math.max(textWords(sentence).length, 1);
    const density = hits / words;
    if (hits > bestHits || (hits === bestHits && density > bestDensity)) {
      best = sentence;
      bestDensity = density;
      bestHits = hits;
    }
  }
  return best.trim();
}

export function searchKnowledge(args: unknown, docs: KnowledgeDoc[]) {
    const { query } = input.parse(args);
    const keywords = queryWords(query);
    const ranked = docs
      .map(doc => ({ id: doc.id, title: doc.title, text: doc.text, score: scoreDoc(doc, keywords), matchedSentence: matchedSentence(doc.text, keywords) }))
      .filter(doc => doc.score > 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 2);
    return { source: "acme_knowledge", query, matches: ranked };
}

export const knowledgeSearch: Tool = {
  id: "knowledge_search",
  description: "Search AcmeStore policy documents for returns, shipping, and refunds.",
  input,
  kind: "read",
  async run(args) {
    return searchKnowledge(args, getKnowledgeDocs());
  },
};
