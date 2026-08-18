---
title: Roles & Permissions
description: Five project roles, expressed as capabilities — and the two invariants that protect them.
---

A Raven project has members, and each member holds exactly one role.

```
OWNER      everything, including deleting the project
ADMIN      everything except deleting it or creating another owner
DEVELOPER  build things: keys, webhooks, rooms — but not who has access
VIEWER     read-only
BILLING    usage and billing, and nothing else
```

## What each role can do

| Capability | Owner | Admin | Developer | Viewer | Billing |
|---|:-:|:-:|:-:|:-:|:-:|
| `project:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `project:write` | ✓ | ✓ | | | |
| `project:delete` | ✓ | | | | |
| `members:read` | ✓ | ✓ | ✓ | ✓ | |
| `members:manage` | ✓ | ✓ | | | |
| `keys:read` | ✓ | ✓ | ✓ | ✓ | |
| `keys:manage` | ✓ | ✓ | ✓ | | |
| `webhooks:read` | ✓ | ✓ | ✓ | ✓ | |
| `webhooks:manage` | ✓ | ✓ | ✓ | | |
| `rooms:write` | ✓ | ✓ | ✓ | | |
| `chat:read` | ✓ | ✓ | ✓ | ✓ | |
| `usage:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `audit:read` | ✓ | ✓ | | | |
| `billing:manage` | ✓ | | | | ✓ |

Two of these are judgement calls worth stating plainly:

**Developers can manage API keys.** They are building the thing. Making
them ask an admin for a key every time pushes people towards sharing one,
which is worse than the risk it avoids. They still cannot add members,
change project settings, or delete anything.

**Billing sees usage and nothing else.** Not conversations, not
connections, not keys. Someone who needs an invoice does not need a list
of your customers' conversations.

`keys:read` covers key *metadata* — name, environment, last used. The
secret half of a key is not readable by anyone at any role, including the
owner, because it was never stored.

## 404 or 403?

Both, and the difference is deliberate:

| Situation | Response |
|---|---|
| Not a member of the project | **404** `RAVEN_PROJECT_NOT_FOUND` |
| A member, but the role lacks the capability | **403** `RAVEN_PERMISSION_DENIED` |

A non-member gets exactly what they would get for a project that does not
exist. A 403 there would confirm the id is real and belongs to someone,
which is what an attacker enumerating ids is trying to learn.

A member gets a 403, because they already know the project exists. A 404
would send them hunting for a bug when the answer is "ask for access". The
message names both the role and the capability:

```json
{
  "code": "RAVEN_PERMISSION_DENIED",
  "message": "Your role in this project (viewer) does not allow keys:manage",
  "requestId": "req_9f2c41ab77e0c3d5b1a4e8f2"
}
```

## Managing members

```http
GET    /v1/projects/{id}/members
POST   /v1/projects/{id}/members      { "email": "…", "role": "DEVELOPER" }
PATCH  /v1/projects/{id}/members/{userId}   { "role": "ADMIN" }
DELETE /v1/projects/{id}/members/{userId}
```

Listing returns each member's capabilities alongside their role:

```json
{
  "userId": "…",
  "email": "dev@example.com",
  "role": "DEVELOPER",
  "capabilities": ["project:read", "members:read", "keys:read", "keys:manage", "…"]
}
```

That is there so a dashboard can hide actions it would only be refused
for, without keeping its own copy of the table above — two copies would
drift, and the front-end copy is the one that would be wrong.

There is no invitation flow yet: the person must already have a Raven
account, and adding an unknown address returns a 404 that says so rather
than creating a pending row that never becomes anything.

## Two rules that protect the model

**Only an owner can create or remove an owner.** Without this, an admin
could promote themselves to owner and then demote the actual owner out of
their own project, which would make the OWNER role decorative.

**A project always keeps at least one owner.** Demoting or removing the
last one is refused with a 400. A project with no owner cannot be
administered by anyone — not even to appoint a replacement — so it would
be permanently stuck.

```json
{
  "code": "RAVEN_VALIDATION_FAILED",
  "message": "This is the project's only owner. Promote someone else to owner first."
}
```

## Existing projects

Whoever created a project is its owner; that was already recorded, and the
migration turned it into an OWNER membership. Nothing changed for a
project with one person on it.

`Project.ownerId` still records who created it, but authorization no
longer reads it — an owner is simply a member holding the OWNER role.

## Where roles do not apply

Roles govern the **control plane**: the dashboard, the CLI, and the
`/v1/projects/...` routes, all authenticated with a developer session.

They do not govern **API keys**. A key is not a person and has no role; it
carries a project and an environment, and grants the runtime operations
that key type allows. See [Environments](/production/environments).

Chat has its own separate member roles *within a conversation*
(`MEMBER`, `MODERATOR`, `ADMIN`) which are unrelated to these — those are
about your application's end users, not about who administers your Raven
project. See [Chat Overview](/chat/overview).

