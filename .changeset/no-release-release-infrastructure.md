---
---

Release and CI hardening only — no published package's behaviour changed,
so nothing is versioned by this changeset.

Package READMEs and LICENSE files were added (they ship in the tarball but
change no code), Prettier/ruff/golangci-lint/analysis_options were
introduced, and the SFU's Go module path was corrected to
`github.com/atulsinghhhh/Raven/services/sfu`.

The `@ravenkash/*` packages have never been published, so the first release
should be 0.1.0 exactly as it stands rather than 0.1.1.
