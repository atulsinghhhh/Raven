# Security scanning

What runs automatically against this repository, what each scanner is
responsible for, and what to do when one goes red.

This page is about *scanning*. The design of Livqeno's own security model —
token scoping, key hashing, TURN credentials, plane separation — lives in
[rtc/security.md](./rtc/security.md),
[security/server-sdk.md](./security/server-sdk.md) and
[security/chat.md](./security/chat.md).

---

## Coverage

| Concern | Tool | Where | Blocks a merge? |
|---|---|---|---|
| Committed secrets | gitleaks | `security.yml` | yes |
| New vulnerable deps on a PR | `dependency-review-action` | `security.yml` | yes, ≥ high |
| Node dependencies | `pnpm audit` | `security.yml` | yes, prod ≥ high |
| Python dependencies | `pip-audit` | `security.yml` | yes |
| Go stdlib + modules | `govulncheck` | `security.yml`, gated per-image | yes |
| Static analysis | CodeQL | `codeql.yml` | yes |
| `apps/api` image | Trivy | `docker-publish.yml` | yes, CRITICAL |
| `services/sfu` image | Trivy | `sfu-publish.yml` | yes, CRITICAL |
| Dependency freshness | Dependabot | `dependabot.yml` | n/a (opens PRs) |

`security.yml` runs on every PR, every push to `main`, and Mondays at
05:00 UTC — advisories are published against dependencies that have not
changed, so a quiet week still needs a scan.

---

## Secret scanning

[gitleaks](https://github.com/gitleaks/gitleaks) over the **full commit
graph**, not just the diff: a key committed months ago and "removed" later
is still in every clone.

- Config: `.gitleaks.toml` — extends the upstream ruleset rather than
  replacing it.
- Accepted historical findings: `.gitleaksignore`, one fingerprint per
  entry, each with a written reason.
- Findings upload as a SARIF artifact; **nothing is printed to the job
  log.** A scanner that echoes the secret it found has published it to
  anyone who can read the build.

Run it locally before pushing:

```bash
docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:latest \
  detect --source=/repo --config=/repo/.gitleaks.toml --redact --no-banner
```

### If it fires

1. **Assume the secret is compromised** and rotate it first. Deleting the
   commit does not un-publish it — the push already happened.
2. Fix the current code so the value is not there.
3. Only then decide whether to rewrite history. For a public repo with
   forks, rotation matters far more than a clean log.
4. Add a `.gitleaksignore` entry **only** for a finding in history that you
   have read and confirmed is not a live credential, and write down why.

A finding on current code is fixed, never ignored.

### What is allowlisted, and why

`.env.example` (89 placeholder variables — the file's entire purpose),
lockfiles, recorded load-test output, Prisma's generated client, and the
vendored SDK builds under `apps/api/test/e2e-harness/vendor/`. Each entry
in `.gitleaks.toml` carries its reason. Nothing is excluded merely for
being noisy.

---

## Dependency scanning

### Node

```bash
pnpm audit --prod --audit-level high   # what CI blocks on
pnpm audit --audit-level moderate      # everything, advisory
```

Production dependencies gate at **high**, because they ship to users.
devDependencies are reported weekly but do not block: a moderate advisory
in a test runner should not stop a bugfix reaching production.

### Python

```bash
cd sdks/python && pip-audit --strict .
```

### Go

```bash
cd services/sfu && govulncheck ./...
```

govulncheck is call-graph aware — it reports a CVE only when the SFU
actually reaches the vulnerable symbol, which is what makes failing the
build on its output reasonable rather than noise.

It also covers the **Go standard library**, and that is the usual reason it
goes red. The fix is to bump `GO_VERSION` in `sfu-publish.yml`,
`security.yml` and `e2e.yml`, not to suppress the finding. Go 1.26.6 is the
current pin; 1.26.4 is affected by GO-2026-5856 (`crypto/tls`) and
GO-2026-5026 (`net/http`) among others.

### Containers

Trivy scans each image before it is pushed and **fails the build on a
CRITICAL, fixable** finding. Results upload as SARIF artifacts. They will
flow into GitHub code scanning once Advanced Security is enabled — the
upload step is written and commented in both workflows.

---

## Dependency updates

Dependabot, weekly on Mondays, across every ecosystem:

`npm` (root — one pnpm lockfile covers all workspaces) · `gomod`
(`/services/sfu`) · `pip` (`/sdks/python`) · `pub` (one entry per Flutter
package) · `github-actions` · `docker` (`/apps/api`, `/services/sfu`).

Updates are **grouped** so each ecosystem produces one or two readable PRs
rather than dozens nobody reviews. Pion is grouped separately from the rest
of the Go dependencies — it is the media stack, and its bumps deserve to be
read against the SFU's own tests.

**Majors are excluded from every group** and arrive as their own PR. A
major is an API break by definition; batching one in beside twelve patches
is how a breaking change gets merged unread.

GitHub Actions updates are not split by semver: an action pin is a supply
chain dependency running with repository credentials, and every bump is
worth looking at.

---

## Reporting a vulnerability

The policy, scope, safe harbour and response targets live in
**[SECURITY.md](../SECURITY.md)**. Reports go through GitHub private
vulnerability reporting, never a public issue.

Still to enable on the repository itself:

- [ ] Enable **private vulnerability reporting** in
      *Settings → Code security and analysis*
- [ ] Enable **secret scanning** and **push protection** (free for public
      repos) — that catches a secret at `git push`, before gitleaks ever
      sees it in CI
- [ ] Enable GitHub Advanced Security if available, so CodeQL and the Trivy
      SARIF uploads land in code scanning instead of artifacts

Known unfixed problems are written up in [issues/](./issues/) rather than
left to be discovered, including
[coturn fails open](./issues/05-coturn-fails-open.md), which is a real
security issue in the deployed configuration.
