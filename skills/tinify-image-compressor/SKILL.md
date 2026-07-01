---
name: tinify-image-compressor
description: Compress, resize, convert, and metadata-preserve local image files with Tinify's Node.js API. Use when Codex needs to batch-optimize PNG, JPEG, or WebP assets, mirror directory structures into an output folder, validate a Tinify API key, or apply repeatable resize and format-conversion rules without overwriting originals by default.
---

# Tinify Image Compressor

Use this skill to run predictable Tinify-based image optimization against local files or folders.

Default goals:
- keep original images untouched unless the user explicitly asks for in-place replacement
- write optimized assets into a separate output path
- preserve relative folder structure for directory inputs
- support one-pass compression plus optional resize, format conversion, and metadata preservation
- remind the user before any live Tinify run that a valid API key and Tinify quota are required

## Quick Start

1. Ensure a Tinify API key is available in `TINIFY_API_KEY`.
2. Accept `ACTIVITY_CMS_PSD_TINIFY_KEY` as a fallback when that variable is already used in the surrounding workflow.
3. Install dependencies the first time:

```bash
cd skills/tinify-image-compressor
npm install
```

4. Use the helper CLI:

```bash
node scripts/compress-images.mjs assets --out dist/assets-optimized
node scripts/compress-images.mjs hero.png --out dist/hero.webp --convert webp
node scripts/compress-images.mjs poster.jpg --out dist/poster.jpg --resize fit:1600x1600 --preserve copyright,creation
node scripts/compress-images.mjs screenshots --out dist/shots --dry-run
```

Read [references/tinify-node-api.md](references/tinify-node-api.md) when you need the exact Tinify operation model, resize rules, or API error taxonomy.

## Workflow

### 0. Remind before live compression

- Before any non-`--dry-run` execution, explicitly remind the user that the run will call Tinify's API and consume Tinify quota.
- If no key is configured yet, stop and show the exact `export TINIFY_API_KEY="..."` or `export ACTIVITY_CMS_PSD_TINIFY_KEY="..."` command.
- If the user only wants to inspect path mapping first, prefer `--dry-run` because it does not call Tinify and does not consume quota.

### 1. Inspect the inputs

- Prefer local files and directories.
- Confirm whether the user wants a single file, a batch folder, or mirrored output for multiple roots.
- Use the helper on `.png`, `.jpg`, `.jpeg`, and `.webp` files by default.

### 2. Choose a safe output target

- For a single file input, allow either an explicit output file or an output directory.
- For multiple inputs or any directory input, require an output directory.
- Avoid overwriting the source tree unless the user explicitly asks for that behavior.

### 3. Validate before spending quota

- Run `--dry-run` first for large batches or unclear path mapping.
- Let the helper validate the API key before uploading images.
- If the user asks for quota debugging, report the helper's `compressionCount` summary after the run.

### 4. Apply only the requested transforms

- Use `--resize <method:widthxheight>` for Tinify resizing.
- Use `--convert <avif|webp|jpeg|png>` for deterministic output format selection.
- Use `--background <white|black|#RRGGBB>` only when converting transparent images to JPEG.
- Use `--preserve copyright,creation,location` only when the user explicitly wants metadata retained.

### 5. Report the result

Always summarize:
- how many files were discovered
- how many were optimized or skipped
- where the output was written
- total bytes before and after when available
- any Tinify account, client, server, or connection errors

## CLI Contract

Run:

```bash
node scripts/compress-images.mjs <input...> --out <path> [options]
```

Supported options:
- `--out <path>`: required output file or directory
- `--convert <avif|webp|jpeg|png>`: convert output type
- `--resize <method:widthxheight>`: Tinify resize shorthand
- `--preserve <comma,list>`: metadata fields to keep
- `--background <white|black|#RRGGBB>`: fill transparency during conversion
- `--api-key-env <NAME>`: use a custom environment variable name
- `--max-jobs <n>`: limit parallel uploads, default `4`
- `--dry-run`: print the planned work without calling Tinify
- `--help`: print usage

Resize shorthand rules:
- `scale:1600x` or `scale:x900`: require exactly one dimension
- `fit:1600x1600`, `cover:1200x628`, `thumb:512x512`: require both dimensions

## Troubleshooting

- Missing key: remind the user that live compression needs a Tinify API key, then show `export TINIFY_API_KEY="..."` or pass `--api-key-env`.
- `AccountError`: check the API key, monthly quota, or rate limiting.
- `ClientError`: inspect the source image, resize spec, background option, or output format.
- `ServerError` or `ConnectionError`: retry later and avoid claiming the failure is caused by the image itself.
- Transparent PNG to JPEG: add `--background`.

## References

- Tinify Node API summary: [references/tinify-node-api.md](references/tinify-node-api.md)
