# Guarded automatic actions

Saved agents choose `requireWriteApproval`. New builder configurations default to automatic supported writes; old configurations default to approval. Owners can enable human review in the builder. The trusted registry decides which tools support automatic execution; other writes still pause. Execution requests cannot override this policy. Evaluations always deny writes.

`maxWriteCalls` defaults to 2 and is bounded at 5, alongside model/tool/time/cost limits. The builder exposes this limit and preserves it across authentication, saves, duplication and restore. `tool_started.authorization` records `read`, `human` or `policy`; the trace labels automatic actions.

## Support tickets

`create_ticket` stores a bounded support request in the workspace database. A persistent idempotency key prevents repeated execution of the same call, and its output has a strict schema. Tools & Knowledge lists recent tickets. This is an application record, not an external ticketing-system connection, refund or account change.

## Record-only email

`send_email` does not send mail. No external email provider, API credentials or delivery settings are required. Its output explicitly says `recorded only, not sent`.

Automatic mode accepts only this strict shape:

```json
{
  "to": "customer@example.com",
  "template": "support_acknowledgement",
  "ticketId": "550e8400-e29b-41d4-a716-446655440000"
}
```

The template is `support_acknowledgement` or `review_request`; the ticket must exist in the caller's workspace. The server renders factual fixed text referencing that ticket, with no refund/payment/account-change promises. The same ticket/template/recipient combination is deduplicated across calls and runs. Owner isolation still applies.

Legacy freeform `subject`/`body` requires human review even when automatic mode is enabled. Subjects reject header injection, and automatic message content cannot be replaced with model prose. No HTML, sender override, CC/BCC or attachments are accepted. Output uses a strict schema. The approval panel previews the template's rendered text when review is required.

## Verification and scope

Runtime/database tests verify automatic tickets and email records, write caps, cross-owner knowledge isolation, sample-data provenance, human review for freeform messages and evaluation write denial. These tests send no external messages.

The requested Brevo work was canceled before committing; its local-only migration metadata was removed while preserving existing records. Slack/Discord webhooks and GitHub issue creation were discussed as possible future connectors; none is implemented or implied by a local ticket.

Jev was assessed using [TypeSafe's official documentation](https://docs.typesafe.ai/introduction/quickstart). Its Noul primitive returns a probability. Ownership checks, exact templates and limits remain deterministic code; Gemini remains the optional semantic evaluator. A future classifier could help prioritize or route tickets, but no new model provider is necessary for these permissions.
