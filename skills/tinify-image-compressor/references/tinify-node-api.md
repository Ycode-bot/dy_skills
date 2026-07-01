# Tinify Node API Reference Notes

Source of truth:
- [Tinify Node.js reference](https://tinify.com/developers/reference/nodejs)

Use this file when the helper script needs to be extended beyond its current CLI surface.

## Core operations

- Authentication: set `tinify.key` before any upload.
- Validation: call `tinify.validate(...)` to verify the API key and network connection before compressing.
- Compression inputs:
  - `tinify.fromFile(path)`
  - `tinify.fromBuffer(buffer)`
  - `tinify.fromUrl(url)`
- Compression outputs:
  - `.toFile(path)`
  - `.toBuffer(...)`

## Resize behavior

Tinify resize methods:
- `scale`: require exactly one dimension
- `fit`: require both width and height
- `cover`: require both width and height and crop intelligently
- `thumb`: require both width and height and use more aggressive thumbnail logic

Tinify does not upscale images past the original dimensions.

## Convert behavior

The API supports conversion between AVIF, WebP, JPEG, and PNG.

Useful patterns:
- single target type: `convert({ type: "image/webp" })`
- multiple target types: `convert({ type: ["image/webp", "image/png"] })`
- smallest available supported type: `convert({ type: "*/*" })`

If converting transparent images to JPEG, apply `transform({ background: ... })`.

## Metadata preservation

Supported preserve fields:
- `copyright`
- `creation`
- `location`

`location` is JPEG-only.

Preserving metadata increases output size, so do it only when the user asks.

## Error taxonomy

Tinify documents four API-facing error types:
- `AccountError`: invalid key, quota issue, or rate limit trouble
- `ClientError`: invalid request or source image problem
- `ServerError`: temporary Tinify-side issue, safe to retry later
- `ConnectionError`: network problem, safe to retry after connection recovers

## Compression accounting

- Initial upload plus optimized result counts as one compression.
- Each additional resize counts as an extra compression.
- Each conversion counts as an extra compression.
- Metadata preservation does not count as an extra compression.

After validation or a successful request, `tinify.compressionCount` exposes the monthly count.
