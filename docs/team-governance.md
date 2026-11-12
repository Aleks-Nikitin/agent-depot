# Teams, policy hierarchy and shared libraries

Registered users can create organizations under **Teams**, add teams, and grant existing registered accounts member or admin access. No invitation email is sent. Organization owners/admins manage policy, membership and library versions; members can apply packs to their own agents in teams they belong to. The organization owner cannot be removed or demoted through this interface.

Membership shares library and policy data only. Personal agents, run records, knowledge documents, workspace budgets and connector credentials remain owner-isolated. This is not a shared service-account workspace or a pooled organization budget. Adding a member does not grant access to another person's GitHub token or private documents.

## Organization → team → agent

Rules intersect with existing workspace policy. A team may tighten its organization's allowed tools, model profiles, GitHub repositories, model/tool/write/time/cost ceilings, daily ceiling per workspace and concurrency ceiling. Team settings cannot expand the parent. Mandatory organization instructions remain active when a team changes its additional instructions. Review requirements combine by tightening; explicitly exempt trusted internal tools retain their existing behavior. External GitHub issue creation always requires approval.

In an agent's **Governance** tab, choose a team and up to two pinned pack versions. Preview shows the effective organization/team revision chain, requested tools, automatic ceiling reductions, added scenarios, mandatory instruction blocks and denied fields. Confirming the preview saves a new agent draft; it never promotes a serving release. Models and repository targets are not silently substituted to make a configuration pass. Stale previews and changed draft revisions are rejected.

An agent's team assignment is also recorded outside its editable configuration. Ordinary builder edits, duplication and rollback preserve the binding; removing it from a configuration cannot bypass the assignment. Changing or detaching an existing assignment requires admin access to the original organization. Policy revision changes require saving a new reviewed binding. Revoked memberships and stale bindings block subsequent admission, model reservations, approval continuation and guarded tool effects. Already in-flight provider calls cannot be recalled.

Runtime permission checks apply before effects and estimated-spend reservations. GitHub executors recheck organization/team resource scope inside their durable effect transactions. Changing tool descriptions or agent instructions cannot expand an allowed repository set. Mandatory instruction blocks are included in system context; semantic obedience still requires evaluation and is not guaranteed merely by attaching instructions.

## Versioned shared packs

Each pack version contains shared instructions, compatible model profiles, requested tools and up to five validated regression scenarios. Payloads are limited to 12 KB; one organization supports 30 packs and each pack supports 100 versions. Pack versions are immutable and hash-checked. Applying a pack pins its exact version/hash in agent configuration, adds its requested tools only within inherited policy, and appends missing scenarios without replacing existing tests. The agent still supports at most five saved scenarios overall.

Publishing a newer pack does not rewrite existing agent pins. Its contents are visible to organization members: do not put credentials or private customer data in shared instructions or fixtures. The UI shows the latest ten versions per pack; exact older version references remain available through the API.

Organization/team revisions, effective rules and pinned packs participate in evaluation manifests. Publication rejects stale governance or changed source evidence. A previously approved release can remain selected while execution is blocked by tightened policy; review, evaluate and promote a compatible draft to restore service. Shared library changes do not automatically authorize releases.

Management APIs use the existing authenticated same-origin boundary:

- `GET /api/governance`: accessible organizations, teams and library versions.
- `POST /api/governance`: validated `create_organization`, `create_team`, `update_policy`, `change_member` or `save_pack` action.
- `POST /api/agents/:id/governance`: permission preview for `{ expectedVersion, teamId, packs: [{ id, version }] }`.
- `PUT /api/agents/:id/governance`: the same selection plus the returned `previewHash`, to save the reviewed draft.

Local PostgreSQL tests cover two-team reuse, immutable pins and scenario deduplication, edit/rollback preservation, field-level permission denials, non-expanding connector resources, membership revocation and publication invalidation after policy changes. No paid model calls are made.
