# 01 — Every environment shares one database, so dev SFUs join the production fleet

**Severity:** High · **Area:** RTC / data

## What is wrong

`DATABASE_URL` points every environment — a laptop, CI, and Azure production
— at the same Supabase project. `rtc_servers` is therefore a single global
fleet table, and a developer running `pnpm infra:up` registers an SFU into
**production**.

Observed live: the deployed API's readiness probe selected a node named
`sfu-local-01` with `internalUrl=http://sfu:7000` — a Docker service name
only resolvable on the laptop that registered it — and reported
`sfu: down`, because it could not reach it.

## Why it is worse than a noisy health check

`RtcServerAllocator.pickServer()` prefers the requested region but **falls
back to any region rather than failing the call**:

```
apps/api/src/modules/rtc-servers/rtc-server-allocator.service.ts
  pickServer()  → healthyServersWithCapacity(region)
                → if empty, healthyServersWithCapacity()   // any region
```

So when the Azure region is at capacity, a real customer's room can be
allocated to a developer's laptop. The allocation succeeds, the client is
handed a media address nothing can reach, and the call fails with no
obvious cause.

`pickHealthyForProbe()` has the same blind spot — it filters on
`status: HEALTHY` only, with no region or environment predicate:

```ts
// rtc-server-registry.service.ts
return this.prisma.rtcServer.findFirst({
  where: { status: RtcServerStatus.HEALTHY },
  orderBy: [{ activeRooms: 'asc' }],
});
```

## Reproduce

1. Point a local `.env` at the production Supabase project (the default).
2. `docker compose up -d sfu`
3. Query the production fleet:
   ```bash
   curl -s https://api.ravenstack.online/v1/rtc/servers -H "Authorization: Bearer <session-jwt>"
   ```
   `sfu-local-01` appears as HEALTHY alongside `sfu-eastasia-01`.

## Fix options, best first

1. **A Supabase project per environment.** Removes the whole class of
   problem — dev data, dev SFUs and dev webhooks stop touching production.
   Costs another free-tier project. Requires splitting `DATABASE_URL` per
   environment and updating `docs/deployment/managed-postgres.md`, which
   currently documents one shared database as deliberate.
2. **An environment column on `rtc_servers`**, set from the registering
   node's config, with every allocator and probe query filtering on it. A
   migration plus changes to `pickServer`, `healthyServersWithCapacity` and
   `pickHealthyForProbe`.
3. **Weakest:** stop running local SFUs against production. Relies on
   everyone remembering. The staleness sweeper marks a stopped node
   UNHEALTHY within `SFU_HEARTBEAT_TIMEOUT_SECONDS` (30s), which shortens
   the window but does not close it.

Options 1 and 2 are not exclusive; 2 is worth having even with 1.

## Files

- `apps/api/src/modules/rtc-servers/rtc-server-allocator.service.ts`
- `apps/api/src/modules/rtc-servers/rtc-server-registry.service.ts`
- `apps/api/prisma/schema.prisma` (`RtcServer`)
- `docs/deployment/managed-postgres.md`
