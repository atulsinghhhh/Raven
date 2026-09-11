---
title: Project
description: The tenant boundary. Every room, conversation, key, and quota belongs to exactly one project.
---

A project is Livqeno's tenant. One Livqeno deployment serves many projects, and
nothing crosses between them.

## Why it exists

Livqeno needs to know *whose* room to create, whose data to attribute, and
whose limits apply. A project is the answer, and an
[API key](/concepts/api-key) is how a request names it. That is why the key
is a credential your backend holds rather than something derived from the
request: identification has to happen on something Livqeno can trust.

## What it scopes

Rooms, conversations, live streams, API keys, webhook endpoints,
connections, error events, audit entries, and usage. Names are scoped too —
two projects can both have a room called `support`.

## What it does not scope

The project itself: its name, and who administers it. Project membership is
a separate axis — see
[Roles & permissions](/production/roles-and-permissions).

## Minimal example

```bash
raven projects create my-video-app
raven projects list
```

```ts
// Your backend's own project, resolved from the API key it holds.
const project = await raven.projects.get();
```

## Related

- [Environment](/concepts/environment) — every project has three.
- [API key](/concepts/api-key) — scoped to one project and one environment.
- [Create a project](/get-started/create-a-project).
