# Audit logs

Every administrative action on a project is recorded permanently.

```http
GET /v1/projects/{projectId}/audit-logs
```

Requires `audit:read`, which owners and admins hold. A developer can
create API keys but cannot read who else has been creating them — see
[roles.md](roles.md).

## What an entry looks like

```json
{
  "publicId": "aud_SymceSuFMYAUvZbYOtxdSA",
  "projectId": "b357b46d-8fc9-4f9d-a5c2-cdfee6b30a9e",
  "environment": "PRODUCTION",
  "actorId": "32b1e402-9138-43af-b26d-a2f1b62f3535",
  "actorEmail": "dev@example.com",
  "action": "api_key.created",
  "resourceType": "api_key",
  "resourceId": "rvk_prod_y2KZHYFCezTE",
  "metadata": { "name": "backend" },
  "requestId": "req_9755fd8325d28074ed5ce6cc",
  "ipAddress": "203.0.113.7",
  "userAgent": "raven-cli/0.1.0",
  "createdAt": "2026-08-19T11:31:04.221Z"
}
```

`actorEmail` is stored on the entry rather than joined from the user
table. An audit trail matters most precisely when the person who acted is
gone, and a dangling reference would leave you with "someone did this".

`requestId` matches the `x-request-id` on the request that caused it, so
an entry ties back to a specific call — and to the error the developer is
holding, if there was one. See [error-codes.md](error-codes.md).

## Recorded actions

| Action | Resource |
|---|---|
| `project.created` | `project` |
| `project.updated` | `project` |
| `project.archived` | `project` |
| `api_key.created` | `api_key` |
| `api_key.revoked` | `api_key` |
| `member.added` | `member` |
| `member.removed` | `member` |
| `member.role_changed` | `member` |
| `webhook.created` | `webhook` |
| `webhook.updated` | `webhook` |
| `webhook.deleted` | `webhook` |

## Filtering

```http
GET .../audit-logs?action=api_key.revoked
GET .../audit-logs?actorId={userId}
GET .../audit-logs?resourceId=rvk_prod_y2KZHYFCezTE
GET .../audit-logs?limit=200
```

Newest first. Default 50, maximum 200. An unrecognised `action` is
rejected with a 400 rather than ignored — silently returning everything
when someone filtered for something specific is how a person concludes
"nothing happened" from a typo.

Filtering by `resourceId` gives you the whole life of one thing:

```json
[
  { "action": "api_key.revoked", "createdAt": "2026-08-19T14:02:11.004Z" },
  { "action": "api_key.created", "createdAt": "2026-08-19T11:31:04.221Z" }
]
```

## What is never recorded

- **Secrets.** Not API key secrets, not webhook signing secrets, not
  passwords. A key's public id is recorded because that is what makes the
  entry useful; its secret half was shown once and never stored anywhere,
  including here.
- **Message content.** Chat bodies are not administrative actions and do
  not appear.
- **Field values on updates.** `project.updated` records *which* fields
  changed, not what they changed to. A project description is the
  developer's own text and belongs in the project, not copied into a
  permanent log.

## Entries cannot be changed

There is no endpoint that updates or deletes an entry, and no code path in
Raven that does either. An audit log an administrator can edit is not an
audit log.

## When the write fails

Recording is awaited, but a failure is logged at error level and does not
fail the request.

This is a deliberate trade. By the time the entry is written the mutation
has already committed, so reporting failure would tell the caller their
key was not created when it was — and their retry would create a second
one. A missing audit row is a gap; a duplicated production key is an
incident.

The failure is logged loudly rather than swallowed, because an audit trail
that quietly stops recording is worth less than none at all: the whole
value is in being trusted.
