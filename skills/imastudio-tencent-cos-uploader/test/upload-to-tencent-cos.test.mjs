import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CliError,
  ENV_ENDPOINTS,
  buildStsQuery,
  createRequestSign,
  detectMediaType,
  normalizeStsData,
  parseArgs,
  readParamsFile,
  requestStsToken,
  resolveResultUrl,
  runUploadBatch,
  scanInputs,
  uploadWithCos,
  validateOptions,
  writeManifest
} from "../scripts/upload-to-tencent-cos.mjs";

const temporaryDirectories = [];

async function createTemporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "imastudio-cos-uploader-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })
  ));
});

test("parses the documented CLI and requires an explicit environment", () => {
  const options = parseArgs([
    "./media",
    "--env", "beta",
    "--params-file", "/secure/query.json",
    "--max-files", "4",
    "--chunk-concurrency", "2"
  ]);

  assert.equal(options.env, "beta");
  assert.equal(options.maxFiles, 4);
  assert.equal(options.chunkConcurrency, 2);
  assert.deepEqual(options.inputs, ["./media"]);
  assert.doesNotThrow(() => validateOptions(options));
  assert.throws(
    () => validateOptions({ ...options, env: "" }),
    (error) => error instanceof CliError && error.exitCode === 2
  );
});

test("detects the same media extension families as the ImaStudio upload layer", () => {
  assert.equal(detectMediaType("poster.JPEG"), "image");
  assert.equal(detectMediaType("clip.MOV"), "video");
  assert.equal(detectMediaType("voice.OPUS"), "audio");
  assert.equal(detectMediaType("document.pdf"), undefined);
});

test("recursively scans, sorts, deduplicates real paths, and retains unsupported files", async () => {
  const root = await createTemporaryDirectory();
  const nested = path.join(root, "nested");
  await fs.mkdir(nested);
  await fs.writeFile(path.join(root, "z.mp4"), "video");
  await fs.writeFile(path.join(nested, "a.png"), "image");
  await fs.writeFile(path.join(nested, "notes.txt"), "text");

  const items = await scanInputs([root, path.join(root, "z.mp4")]);
  assert.deepEqual(
    items.map((item) => path.basename(item.source)),
    ["a.png", "notes.txt", "z.mp4"]
  );
  assert.deepEqual(items.map((item) => item.type), ["image", undefined, "video"]);
});

test("reads scalar query parameters without accepting nested values", async () => {
  const root = await createTemporaryDirectory();
  const validFile = path.join(root, "valid.json");
  const invalidFile = path.join(root, "invalid.json");
  await fs.writeFile(validFile, JSON.stringify({ appId: "webAgent", appKey: "key", userId: "1" }));
  await fs.writeFile(invalidFile, JSON.stringify({ appId: "webAgent", appKey: "key", nested: {} }));

  assert.deepEqual(await readParamsFile(validFile), {
    appId: "webAgent",
    appKey: "key",
    userId: "1"
  });
  await assert.rejects(() => readParamsFile(invalidFile), /must be a scalar value/);
});

test("rebuilds request-scoped STS fields and computes the existing uppercase SHA-1 signature", () => {
  const timestamp = 1_725_000_000;
  const nonce = "0123456789abcdef0123456789abcdef";
  const expected = createHash("sha1")
    .update(`webAgent|app-key|${timestamp}|${nonce}`)
    .digest("hex")
    .toUpperCase();

  assert.equal(createRequestSign("webAgent", "app-key", timestamp, nonce), expected);
  const query = buildStsQuery({
    appId: "webAgent",
    appKey: "app-key",
    cmimToken: "secret-token",
    key: "stale-key",
    sign: "stale-sign",
    custom: "preserved"
  }, {
    source: "/tmp/example.PNG",
    size: 42,
    type: "image"
  }, { timestamp, nonce });

  assert.equal(query.cmimToken, "secret-token");
  assert.equal(query.custom, "preserved");
  assert.equal(query.fService, "private");
  assert.equal(query.fType, "picture");
  assert.equal(query.fSuffix, "png");
  assert.equal(query.fSize, "42");
  assert.equal(query.sign, expected);
  assert.equal("key" in query, false);
});

test("normalizes top-level and nested STS credentials and validates upload scope", () => {
  const common = { bucket: "bucket-1", region: "ap-test", key: "path/file.png" };
  const topLevel = normalizeStsData({
    ...common,
    tmpSecretId: "id",
    tmpSecretKey: "key",
    sessionToken: "token"
  });
  const nested = normalizeStsData({
    ...common,
    credentials: {
      tmpSecretId: "nested-id",
      tmpSecretKey: "nested-key",
      sessionToken: "nested-token"
    }
  });

  assert.equal(topLevel.credentials.tmpSecretId, "id");
  assert.equal(nested.credentials.sessionToken, "nested-token");
  assert.throws(() => normalizeStsData({ credentials: nested.credentials }), /bucket, region, or key/);
});

test("resolves download URLs in frontend-compatible priority order", () => {
  const base = { key: "folder/file.png", domain: "http://cdn.example.com/" };
  assert.equal(
    resolveResultUrl({ ...base, downloadUrl: "http://download.example.com/file.png" }, { Location: "ignored.example.com" }),
    "https://download.example.com/file.png"
  );
  assert.equal(
    resolveResultUrl(base, { Location: "bucket.cos.example.com/folder/file.png" }),
    "https://bucket.cos.example.com/folder/file.png"
  );
  assert.equal(resolveResultUrl(base), "https://cdn.example.com/folder/file.png");
});

test("STS request uses query parameters without ImaStudio authorization headers", async () => {
  let observedUrl = "";
  let observedOptions;
  const fetchImpl = async (url, options) => {
    observedUrl = String(url);
    observedOptions = options;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: 200,
          data: {
            credentials: {
              tmpSecretId: "id",
              tmpSecretKey: "key",
              sessionToken: "token"
            },
            bucket: "bucket",
            region: "region",
            key: "object-key"
          }
        };
      }
    };
  };

  const result = await requestStsToken({
    endpoint: "https://imapi-qa.liveme.com",
    query: { appId: "webAgent", marker: "value" },
    signal: new AbortController().signal,
    fetchImpl
  });
  assert.equal(result.key, "object-key");
  assert.match(observedUrl, /^https:\/\/imapi-qa\.liveme\.com\/api\/rest\/cos\/getststoken\?/);
  assert.match(observedUrl, /marker=value/);
  assert.equal(observedOptions.method, "GET");
  assert.equal(observedOptions.headers, undefined);
});

test("rejects an unsuccessful STS envelope without exposing response data", async () => {
  await assert.rejects(() => requestStsToken({
    endpoint: "https://imapi-qa.liveme.com",
    query: { appId: "webAgent" },
    signal: new AbortController().signal,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { code: 403, msg: "denied", data: { tmpSecretKey: "must-not-leak" } };
      }
    })
  }), (error) => {
    assert.match(error.message, /code 403/);
    assert.equal(error.message.includes("must-not-leak"), false);
    return true;
  });
});

test("COS adapter uploads from FilePath with configured chunks", async () => {
  let observedParams;
  const result = await uploadWithCos({
    item: { source: "/tmp/example.mp4", size: 10, type: "video" },
    stsData: {
      credentials: { tmpSecretId: "id", tmpSecretKey: "key", sessionToken: "token" },
      bucket: "bucket",
      region: "region",
      key: "objects/example.mp4"
    },
    chunkConcurrency: 4,
    signal: new AbortController().signal,
    createCosClient: async () => ({
      uploadFile(params, callback) {
        observedParams = params;
        params.onTaskReady("task-1");
        callback(null, { Location: "bucket.example.com/objects/example.mp4" });
      }
    })
  });

  assert.equal(observedParams.FilePath, "/tmp/example.mp4");
  assert.equal(observedParams.ChunkSize, 5 * 1024 * 1024);
  assert.equal(observedParams.SliceSize, 5 * 1024 * 1024);
  assert.equal(observedParams.ChunkParallelLimit, 4);
  assert.equal(result.Location, "bucket.example.com/objects/example.mp4");
});

test("COS adapter cancels an active task when the signal aborts", async () => {
  const controller = new AbortController();
  let notifyReady;
  const ready = new Promise((resolve) => {
    notifyReady = resolve;
  });
  let cancelledTask = "";
  const upload = uploadWithCos({
    item: { source: "/tmp/example.png", size: 10, type: "image" },
    stsData: {
      credentials: { tmpSecretId: "id", tmpSecretKey: "key", sessionToken: "token" },
      bucket: "bucket",
      region: "region",
      key: "objects/example.png"
    },
    chunkConcurrency: 3,
    signal: controller.signal,
    createCosClient: async () => ({
      uploadFile(params) {
        params.onTaskReady("task-to-cancel");
        notifyReady();
      },
      cancelTask(taskId) {
        cancelledTask = taskId;
      }
    })
  });

  await ready;
  controller.abort();
  await assert.rejects(() => upload, /upload cancelled/);
  assert.equal(cancelledTask, "task-to-cancel");
});

test("batch upload limits file concurrency, preserves order, and records partial failures", async () => {
  const items = ["a.png", "b.mp4", "c.mp3", "notes.txt"].map((name, index) => ({
    source: `/tmp/${name}`,
    size: index + 1,
    ...(name.endsWith(".png") ? { type: "image" }
      : name.endsWith(".mp4") ? { type: "video" }
        : name.endsWith(".mp3") ? { type: "audio" }
          : {})
  }));
  let active = 0;
  let maximumActive = 0;
  const requestSts = async ({ query }) => ({
    credentials: { tmpSecretId: "id", tmpSecretKey: "key", sessionToken: "token" },
    bucket: "bucket",
    region: "region",
    key: `objects/${query.fSuffix}-${query.fSize}`,
    domain: "cdn.example.com"
  });
  const uploadCos = async ({ item }) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    if (item.source.endsWith("b.mp4")) throw new Error("simulated failure\nsecret detail");
    return {};
  };

  const manifest = await runUploadBatch({
    items,
    env: "test",
    baseQuery: { appId: "webAgent", appKey: "app-key" },
    maxFiles: 2,
    chunkConcurrency: 2,
    signal: new AbortController().signal,
    requestSts,
    uploadCos,
    now: () => new Date("2026-09-10T00:00:00.000Z")
  });

  assert.ok(maximumActive <= 2);
  assert.deepEqual(manifest.items.map((item) => item.status), ["uploaded", "failed", "uploaded", "skipped"]);
  assert.deepEqual(manifest.summary, { discovered: 4, uploaded: 2, failed: 1, skipped: 1 });
  assert.equal(manifest.items[1].error.includes("\n"), false);
  assert.equal(manifest.items[0].url, "https://cdn.example.com/objects/png-1");
  assert.equal(manifest.environment, "test");
  assert.equal(ENV_ENDPOINTS.test, "https://imapi-qa.liveme.com");
});

test("dry run performs no upload and writes a private JSON manifest atomically", async () => {
  const root = await createTemporaryDirectory();
  const output = path.join(root, "results", "manifest.json");
  let called = false;
  const manifest = await runUploadBatch({
    items: [
      { source: "/tmp/a.png", size: 1, type: "image" },
      { source: "/tmp/a.pdf", size: 2 }
    ],
    env: "prod",
    dryRun: true,
    signal: new AbortController().signal,
    requestSts: async () => {
      called = true;
    }
  });
  const written = await writeManifest(manifest, output);
  const saved = JSON.parse(await fs.readFile(written, "utf8"));
  const stat = await fs.stat(written);

  assert.equal(called, false);
  assert.equal(saved.summary.planned, 1);
  assert.equal(saved.summary.skipped, 1);
  assert.equal(stat.mode & 0o077, 0);
});
