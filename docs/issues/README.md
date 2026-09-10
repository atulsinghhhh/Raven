# Known issues

Open problems found while deploying Livqeno to production (Supabase + Azure +
Vercel). Each file is self-contained: what is wrong, how to reproduce it, why
it matters, and where to start. Pick one up without needing the deployment
context in your head.

Ordered by what will hurt first.

| # | Issue | Severity | Area |
|---|---|---|---|
| 01 | [Every environment shares one database, so dev SFUs join the production fleet](01-shared-database-sfu-registry.md) | **High** | RTC / data |
| 02 | [Credit burn outpaces the budget (~$95/mo against $100)](02-azure-cost-overrun.md) | **High** | Infra / cost |
| 03 | [bcrypt blocks the event loop; authenticated REST tops out at ~13 req/s](03-bcrypt-blocks-event-loop.md) | Medium | API / perf |
| 04 | [Vercel has no Git integration, so `git push` does not deploy](04-vercel-git-integration.md) | Medium | CI/CD |
| 05 | [coturn fails open: an unreadable config becomes an open relay](05-coturn-fails-open.md) | Medium | Security |
| 06 | [Chat attachments need an Azure Blob driver, or a non-Azure bucket](06-azure-blob-storage-driver.md) | Medium | Storage |
| 07 | [SFU image is not published by CI](07-sfu-image-not-in-ci.md) | Low | CI/CD |
| 08 | [SSH access is pinned to a single IP and breaks when it changes](08-ssh-pinned-to-one-ip.md) | Low | Ops |
| 09 | [Browser RTC call has never been verified end to end](09-browser-rtc-unverified.md) | Low | Testing |
| 10 | [Something strips comments from docker-compose.yml](10-docker-compose-comment-stripping.md) | Low | Tooling |

## Conventions

- One file per issue, named `NN-short-slug.md`.
- Every claim should be reproducible. If a number appears, say which command
  produced it.
- Never paste secret values. Names and fingerprints only.
- When you fix one, delete the file and remove its row above — a stale
  issues list is worse than none.
