import type { KnowledgeDoc, Product } from "@/lib/integrations/types";

export type Order = { id: string; orderId: string; status: string; totalCents: number; currency: string };
export type Ticket = { id: string; subject: string };
export type DomainScope = { kind: "live"; ownerId: string } | { kind: "evaluation"; ownerId: string; attemptId: string };

/** No raw database client, SQL executor, credentials or model-selected owner. */
export interface DomainRepository {
  readonly scope: DomainScope;
  knowledge(): Promise<{ documents: KnowledgeDoc[]; sample: boolean }>;
  products(): Promise<Product[]>;
  order(orderId: string): Promise<Order | null>;
  createTicket(idempotencyKey: string, subject: string): Promise<Ticket>;
}

const isolated = new WeakSet<DomainRepository>();
// Only the guarded server-side evaluation adapter grants this capability.
export function registerIsolatedRepository(repository: DomainRepository) { isolated.add(repository); }
export function revokeIsolatedRepository(repository: DomainRepository) { isolated.delete(repository); }
export function isIsolatedRepository(repository: DomainRepository | undefined): boolean {
  return !!repository && repository.scope.kind === "evaluation" && isolated.has(repository);
}
