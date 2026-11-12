# Versioned, scoped knowledge ingestion

In **Tools & knowledge**, upload UTF-8 `.txt` and `.md` policies up to 100,000 bytes, or paste up to 8,000 characters. The upload reader bounds the complete multipart body to 128 KiB and ten seconds before parsing. It validates extension, MIME type, encoding and control characters; it never runs uploaded content, renders HTML, fetches remote source URLs or invokes a model. PDF, Word, OCR and embedding/vector ingestion are not supported in this slice.

Save a new document or replace an existing one using its expected current version. Replacement appends an immutable `KnowledgeRevision` and updates the current projection. Concurrent stale replacements fail. SHA-256 content hashes, original filenames, titles and version numbers identify each source. Existing documents are backfilled as version 1. The workspace limit remains 100 documents. Deleting a document also deletes its stored revisions; excerpts already recorded in historical execution/evaluation evidence follow those records' existing retention.

Documents can be visible to all owned agents or only a selected set of owned agents. Browser-supplied IDs are checked against the signed-in owner. Live retrieval and evaluation snapshot capture apply the same agent filter. A workspace with private but inaccessible documents returns no sources rather than falling back to illustrative sample policy. Existing workspace documents retain their access by default. Access restrictions affect subsequent retrieval; they cannot recall content already returned in a prior execution event.

Knowledge Search ranks bounded overlapping text excerpts using keywords. Each match carries the exact excerpt, document ID, version, source filename, full-content hash, character offsets and line range. Trace cards display the source excerpts and citation identity. No match is an unsupported answer, not a successful policy lookup. Runtime instructions ask the model to cite returned sources and treat retrieved text as untrusted reference data, never authorization. Citation availability does not by itself guarantee that a live model's answer is supported; answer quality must be tested.

Evaluation snapshots preserve source metadata alongside text, while state-mutation checks retain their existing text-table contract. Publication recomputes visible source identity and rejects evidence after a source/version/access change affects the evaluated corpus. Benchmarks and repair checks use the same capture path. Serving releases do not freeze knowledge indefinitely: new runs retrieve the latest accessible source version, and their tool events record the version used. Existing conversation context and recorded excerpts are not retroactively erased.

Owner-authenticated APIs:

- `POST /api/knowledge`: existing pasted-text creation, now with a first immutable revision.
- `POST /api/knowledge/upload`: multipart `file`, optional `title`, `access` (`workspace` or `agents`), repeated `agentId`; replacement also requires `documentId` and `expectedVersion`.
- `GET /api/knowledge/:id`: current owned document and up to 50 revision identities.
- `GET /api/knowledge/:id?version=N`: an exact owned revision.
- `DELETE /api/knowledge/:id`: deletes owned document and revisions.

Three local PostgreSQL tests cover byte validation/version immutability, agent scopes and exact retrieval citations, and isolated evaluation/publication invalidation. These deterministic checks make no paid model calls.
