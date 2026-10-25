import { knowledgeDocs as seedKnowledgeDocs } from "./data/knowledge";
import { products as seedProducts } from "./data/products";
import type { KnowledgeDoc, Product } from "./types";

const knowledgeDocs: KnowledgeDoc[] = seedKnowledgeDocs.map((doc) => ({ ...doc }));
const products: Product[] = seedProducts.map((product) => ({ ...product }));

export function getKnowledgeDocs(): KnowledgeDoc[] {
  return knowledgeDocs;
}

export function addKnowledgeDoc(input: { title: string; text: string }): KnowledgeDoc {
  const base =
    input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "doc";
  let id = base;
  let n = 2;
  const used = new Set(knowledgeDocs.map((doc) => doc.id));
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  const doc: KnowledgeDoc = { id, title: input.title, text: input.text };
  knowledgeDocs.push(doc);
  return doc;
}

export function getProducts(): Product[] {
  return products;
}
