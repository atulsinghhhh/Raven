# 06 — Chat attachments need an Azure Blob driver, or a non-Azure bucket

**Severity:** Medium · **Area:** Storage

## What is wrong

Chat attachments are **disabled in production**. `STORAGE_BUCKET` is unset,
so the API returns `ATTACHMENTS_NOT_CONFIGURED` rather than half-working.

The obvious fix — point `STORAGE_ENDPOINT` at Azure Blob Storage — does not
work. `apps/api/src/modules/chat/attachments/s3-presign.util.ts` is a
hand-rolled **AWS Signature V4** presigner:

```
username/credential → SigV4 query-string presigned GET and PUT
```

Azure Blob authenticates with SharedKey or SAS, a completely different
scheme. Pointing the existing driver at Blob returns 403 on every upload
and download.

The presigner is hand-rolled deliberately — it avoids several megabytes of
`@aws-sdk` for two operations — so this is not an accident to undo.

## Options

1. **Use an S3-compatible store** — config only, no code:
   ```bash
   STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   STORAGE_REGION=auto
   STORAGE_BUCKET=raven-attachments
   STORAGE_FORCE_PATH_STYLE=false   # R2 uses virtual-host style, MinIO needs path-style
   ```
   Cloudflare R2 has 10 GB free and **zero egress fees**, which matters:
   attachment downloads are egress, and Azure charges ~$0.087/GB past
   100 GB (see issue 02). Backblaze B2 works equally well.
2. **Write an Azure Blob driver.** Introduce a `StorageDriver` seam behind
   the presign util and add a SAS implementation. Keeps everything on
   Azure, costs real code and tests. The seam is worth having regardless.
3. **Leave attachments off** until chat needs them. The API already
   degrades cleanly.

Note `STORAGE_ENDPOINT` must be `https://` in production —
`env.validation.ts` refuses to boot otherwise.

## Files

- `apps/api/src/modules/chat/attachments/s3-presign.util.ts`
- `apps/api/src/modules/chat/attachments/**`
- `apps/api/src/shared/config/env.validation.ts`
- `docs/deployment/production.md` §11.3
