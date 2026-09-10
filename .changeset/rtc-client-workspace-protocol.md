---
"@ravenkash/rtc": patch
"@ravenkash/client": patch
---

`@ravenkash/rtc` and `@ravenkash/client` are installable again.

Both shipped at 0.1.0 with the workspace protocol still in their published
manifests — `"@ravenkash/effects": "workspace:*"` for `rtc`, plus
`"@ravenkash/chat"` and `"@ravenkash/rtc"` for `client`. The packages were
public and downloadable the whole time; they just could not be installed by
anyone outside this repo:

```
npm  install @ravenkash/rtc → EUNSUPPORTEDPROTOCOL Unsupported URL Type "workspace:"
pnpm add     @ravenkash/rtc → ERR_PNPM_WORKSPACE_PKG_NOT_FOUND @ravenkash/effects@workspace:*
```

That made step 2 of the documented quickstart — `npm install @ravenkash/rtc`
— impossible to follow, while `@ravenkash/server` installed fine, so the
break only showed up once a developer got as far as the browser half.

No source change was needed: `workspace:*` is correct in the repo, and pnpm
rewrites it to a concrete version when it packs. The 0.1.0 tarballs were
published by hand with `npm publish`, which rewrites nothing and bypassed
every gate in `.github/workflows/release.yml`. Three gates now cover that
path — a `prepublishOnly` guard in each package that refuses an npm-driven
publish, a packed-tarball inspection that reads the manifest npm would
actually receive, and a metadata check that fails a package using the
protocol without the guard wired up.

0.1.0 stays on the registry as-is; npm unpublish is restricted to 72 hours
and that window is long closed. Anyone stuck on it can use an npm
`overrides` entry pinning `@ravenkash/effects` to `0.1.0` until 0.1.1 lands.
