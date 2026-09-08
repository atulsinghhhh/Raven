# 07 — SFU image is not published by CI

**Severity:** Low · **Area:** CI/CD

## What is wrong

`.github/workflows/docker-publish.yml` builds, scans and publishes
**`apps/api` only**. `services/sfu` has no image pipeline, so the SFU image
in ACR is whatever someone last pushed from a laptop with
`infrastructure/azure/04-images.sh`.

Consequences:

- The running SFU image is not traceable to a commit.
- It never passes the Trivy scan the API image must pass.
- It is built on a developer machine, so `--platform linux/amd64` is load-
  bearing and easy to forget. An arm64 build pushed by mistake fails on the
  VM with `exec format error`.

## Fix

Add a second job to the **existing** workflow rather than a new one — the
API job already has the registry login and scan steps to copy. Sketch:

```yaml
  build-sfu:
    name: Build, scan & publish (sfu)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v3
      - # build services/sfu, platforms: linux/amd64
      - # trivy scan, fail on CRITICAL
      - # push to GHCR, then promote to ACR in the deploy-azure job
```

Gate it on `paths: ["services/sfu/**"]` so API-only changes do not rebuild
it.

The `deploy-azure` job added in the same file already promotes the API image
from GHCR to ACR with `docker buildx imagetools create`; extend it to
promote the SFU tag the same way, so the deployed bytes are the scanned
bytes.

## Note

Deploying a new SFU image is **not** a rolling restart — rooms live in the
process and a restart drops the calls on that node. `docs/rtc/scaling.md`
covers draining; the drain endpoint is
`POST /v1/rtc/servers/:name/drain`. Any SFU deploy automation must drain
first, not just `docker compose up -d`.

## Files

- `.github/workflows/docker-publish.yml`
- `infrastructure/azure/04-images.sh`
- `services/sfu/Dockerfile`
