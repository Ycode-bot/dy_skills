---
name: imastudio-tencent-cos-uploader
description: Batch upload local image, video, and audio files to ImaStudio's Tencent COS through the existing STS query-parameter flow and return a JSON URL manifest. Use when Codex needs reusable remote URLs for local media; do not use for documents, browser upload UI work, or direct permanent Tencent credentials.
---

# ImaStudio Tencent COS Uploader

Use this skill to turn local media files or folders into ImaStudio-hosted Tencent COS URLs.

## Workflow

1. Confirm that the user explicitly wants the files uploaded. A live run creates remote objects.
2. Resolve the requested files and target environment. Never infer `prod`; require `test`, `beta`, or `prod` explicitly.
3. Ensure the caller has provided a JSON file containing the base STS query parameters. Keep it outside the repository and never print its contents.
4. Install this skill's dependencies once with `pnpm install` from the skill directory.
5. For directories, large batches, or unclear input paths, run `--dry-run` first and report the discovered, supported, and skipped counts.
6. Run the uploader, then report the generated manifest path, environment, uploaded count, skipped count, and failures.
7. If only some files fail, do not rerun the entire batch automatically. Retry only the failed sources after the user requests it, because the first run may already have created remote objects.

## CLI

```bash
node scripts/upload-to-tencent-cos.mjs \
  ./images ./videos/demo.mp4 \
  --env test \
  --params-file /secure/path/sts-query.json \
  --out ./upload-result.json
```

Useful options:

- `--max-files <n>`: concurrent files, default `3`
- `--chunk-concurrency <n>`: concurrent chunks per file, default `3`
- `--dry-run`: inspect inputs without requesting STS credentials or uploading
- `--help`: show the complete CLI contract

The CLI accepts the same image, video, and audio extensions as the ImaStudio media upload layer. It recursively scans directories, deduplicates real file paths, requests a separate STS credential for every supported file, and writes a JSON file-to-URL manifest.

## Safety

- Never add STS query parameter files, CMIM tokens, temporary COS credentials, or complete signed URLs to Git.
- Never echo the parameter file or STS response. The result manifest contains only source metadata, COS keys, returned URLs, statuses, and sanitized errors.
- The STS call uses query parameters only. Do not add ImaStudio authorization headers.
- Keep `fService=private`; do not silently change the storage visibility.
- A `prod` upload must always come from an explicit user request that names or accepts the production environment.

Read [references/upload-contract.md](references/upload-contract.md) when changing endpoint mappings, STS fields, supported extensions, URL resolution, or retry behavior.
