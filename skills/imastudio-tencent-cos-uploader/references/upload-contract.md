# ImaStudio Tencent COS Upload Contract

Use this reference only when maintaining or debugging the uploader.

## Environment endpoints

| Environment | IM API base URL |
| --- | --- |
| `test` | `https://imapi-qa.liveme.com` |
| `beta` | `https://imapi-beta.liveme.com` |
| `prod` | `https://imapi.liveme.com` |

The STS endpoint is `GET /api/rest/cos/getststoken`. It uses query parameters and no ImaStudio business authorization headers.

## Query parameter handling

The caller supplies a JSON object through `--params-file`. Only a non-empty string `cmimToken` is required. `appId` is fixed by `IMASTUDIO_APP_ID` in the uploader and overrides any legacy config value:

```json
{
  "cmimToken": "<your-login-token>"
}
```

Existing scalar query fields remain supported for compatibility. If a non-empty `appKey` is supplied, the legacy signing flow is retained; with only `cmimToken`, no `sign`, `timestamp`, or `nonce` is sent. Actual gateway authorization is deployment-dependent and must be verified separately.

Keep the real file outside Git. The CLI preserves caller-supplied scalar fields except for request-scoped fields. For each file it regenerates or sets:

- When `appKey` is supplied, `timestamp`: current Unix timestamp in seconds
- When `appKey` is supplied, `nonce`: 32 lowercase hexadecimal characters
- When `appKey` is supplied, `sign`: uppercase SHA-1 of `appId|appKey|timestamp|nonce`
- `fService`: always `private`
- `fType`: `picture`, `video`, or `audio`
- `fSuffix`: lowercase extension without the leading dot
- `fSize`: decimal byte count as a string

The CLI removes stale `key` and `durationSeconds` fields from the base query. The backend must generate a fresh, scoped key for each file.

## Supported extensions

- Images: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`, `.heic`, `.heif`, `.avif`
- Videos: `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, `.flv`, `.wmv`, `.m4v`, `.3gp`
- Audio: `.mp3`, `.wav`, `.ogg`, `.flac`, `.aac`, `.m4a`, `.wma`, `.opus`

This intentionally mirrors ImaStudio's default media extension registry. Documents and unknown binary files are skipped.

## STS response

The HTTP response must be JSON with `code: 200` and a `data` object. Temporary credentials may be returned at either location:

```text
data.credentials.tmpSecretId
data.credentials.tmpSecretKey
data.credentials.sessionToken
```

or:

```text
data.tmpSecretId
data.tmpSecretKey
data.sessionToken
```

`bucket`, `region`, and `key` are required. `domain`, `downloadUrl`, `startTime`, `expiredTime`, and `forceSignHost` are optional.

## Upload and URL resolution

Each file gets its own STS response and COS client. The Node SDK uploads from `FilePath`, switches to multipart upload at 5 MiB, uses 5 MiB chunks, and applies the requested per-file chunk concurrency.

The final URL is selected in this order:

1. STS `downloadUrl`
2. COS SDK response `Location`
3. `https://{domain}/{key}`

HTTP and protocol-relative results are normalized to HTTPS. If none of the three forms is available, the file is marked failed.

## Failure behavior

- A file failure does not stop unrelated files.
- SDK chunk retries are allowed, but the CLI does not automatically rerun completed files or the full batch.
- Exit `0`: all supported files uploaded, or a dry run completed.
- Exit `1`: one or more supported files failed or were cancelled; a manifest is still written.
- Exit `2`: invalid CLI arguments, environment, parameter file, or input paths.
- Parameter values and temporary credentials must never appear in the manifest or console output.
