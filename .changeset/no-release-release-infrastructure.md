---
---

Release and CI hardening only — no published package's behaviour changed,
so nothing is versioned by this changeset.

Package READMEs and LICENSE files were added (they ship in the tarball but
change no code), Prettier/ruff/golangci-lint/analysis_options were
introduced, and the SFU's Go module path was corrected to
`github.com/atulsinghhhh/Raven/services/sfu`.

No version bump here regardless: these are README, LICENSE and tooling
changes. (The claim that once stood here — that the `@ravenkash/*` packages
had never been published — was not true; all eight are on npm at 0.1.0.)
