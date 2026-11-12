# Internal actions and tool availability

`create_ticket` creates a support request immediately in the workspace database. It does not need human approval, including for older agents with `requireWriteApproval: true`. Tickets appear in **Tools & knowledge**, and successful playground replies link there. A ticket is an internal record, not an external helpdesk request, refund, payment or message. Publishing is not required to run an agent or create tickets.

The per-run write cap still applies: `maxWriteCalls` defaults to 2, maximum 5. Ownership, input/output validation and persistent idempotency remain enforced. The same runtime call is not executed twice; a separate new run is a new request and may create a new ticket. Evaluation suites execute ticket writes against disposable fixture data, leaving workspace tickets unchanged. Other evaluation writes remain denied; [isolated evaluation setup](isolated-evaluations.md) is required. The [GitHub connector](github-connector.md) uses persistent review/resume for exact repository/title/body approval before creating an external issue, even when other writes are automatic. Unknown external outcomes are reconciled rather than reposted.

## Removed messaging

Email never actually delivered messages, so it has been removed from the builder, templates, tool catalog and Gemini tool declarations. The runtime recognizes historical `send_email` IDs to explain removal; it cannot execute them or create new email records. Saving an old agent in the builder removes the retired ID. Old run history is preserved. Update old custom instructions and tests that explicitly request email delivery.

Brevo, Slack and Discord integrations were canceled. No webhook, provider, notification migration or additional dependency is introduced. UI success/error messages provide internal feedback.

## Read tools

- **Search workspace knowledge:** searches documents permitted for this owned agent and returns bounded versioned source excerpts with citations. With no private documents, it uses explicitly labeled sample policies; once private documents exist, it does not mix in samples. Inaccessible documents do not trigger sample fallback. An empty match is a valid result, not proof of policy. See [upload formats and source history](grounded-knowledge.md).
- **Read GitHub issues:** reads bounded issue metadata/excerpts from the agent's explicitly connected repository. Revoked or changed bindings are unavailable. Both connector reads and writes are disabled during isolated evaluations.
- **Look up an order:** reads an owned `WorkspaceOrder` record by order ID, returning no record when absent. It does not connect to an external shop. Tests use seeded orders in their isolated environment.
- **Explore sample sales:** always uses an illustrative prepared dataset. It cannot read a user's actual store sales or invent figures for products outside that dataset.
- **Compare competitor prices / Search recent news / Read a public webpage:** require `SERPAPI_API_KEY`. Without it, new selections are disabled with setup guidance; existing agents show playground warnings. Gemini is informed of missing capabilities rather than being given unusable tools. Search cache entries expire after five minutes; failed responses are not cached. Shopping results retain product links. Empty results are distinct from provider errors.

## Failures and recovery

New runs persist stable safe reasons for Gemini access, quota, model availability, bad requests, network problems and unusable responses. Tool setup, quota and service errors retain their distinct reasons. Chat, traces and saved runs translate these into explanations and next steps. Provider bodies, keys and raw exception messages are never copied into run events.

A failure after creating a ticket does not undo that ticket. The chat shows completed ticket actions and links to their records so a user can check before retrying. Configured transient provider failures may retry or use an explicitly approved fallback within per-run call/time/spend limits. Each request has a persisted reservation and attempt record. Completed tools are not replayed. See [runtime recovery](langchain-runtime.md).

The supplied run `8c45a590-17fb-4403-b657-c53c5fb6f4f6` stopped during its first model request, before any tool call. It only recorded `execution_failed`, so its original provider cause cannot be recovered from the export. A later request using that saved configuration reached Gemini successfully. This does not prove why the historical request failed. Local live search was also unconfigured during the audit, separately preventing a real whey-protein price comparison.
