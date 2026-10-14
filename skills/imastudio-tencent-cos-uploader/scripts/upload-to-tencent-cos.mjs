#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const ENV_ENDPOINTS = Object.freeze({
  test: "https://imapi-qa.liveme.com",
  beta: "https://imapi-beta.liveme.com",
  prod: "https://imapi.liveme.com"
});

export const MEDIA_EXTENSIONS = Object.freeze({
  image: Object.freeze([
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".ico", ".heic", ".heif", ".avif"
  ]),
  video: Object.freeze([
    ".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv", ".m4v", ".3gp"
  ]),
  audio: Object.freeze([
    ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma", ".opus"
  ])
});

const EXTENSION_TYPES = new Map(
  Object.entries(MEDIA_EXTENSIONS).flatMap(([type, extensions]) =>
    extensions.map((extension) => [extension, type])
  )
);
const DEFAULT_FILE_CONCURRENCY = 3;
const DEFAULT_CHUNK_CONCURRENCY = 3;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 8;
const CHUNK_SIZE = 5 * 1024 * 1024;
const STS_PATH = "/api/rest/cos/getststoken";
const RESERVED_QUERY_FIELDS = new Set([
  "timestamp",
  "nonce",
  "sign",
  "fService",
  "fType",
  "fSuffix",
  "fSize",
  "key",
  "durationSeconds"
]);

const HELP_TEXT = `ImaStudio Tencent COS batch uploader

Uploads local image, video, and audio files through ImaStudio's STS endpoint.
A live run creates remote objects. Use --dry-run to inspect a batch without network calls.

Usage:
  node scripts/upload-to-tencent-cos.mjs <input...> --env <test|beta|prod> --params-file <path> [options]

Examples:
  node scripts/upload-to-tencent-cos.mjs ./images --env test --dry-run
  node scripts/upload-to-tencent-cos.mjs ./images ./demo.mp4 --env test --params-file /secure/sts-query.json --out ./upload-result.json

Options:
  --env <test|beta|prod>       Required target environment
  --params-file <path>         JSON file containing base STS query parameters; required for live uploads
  --out <path>                 JSON manifest path; defaults to the current directory with a timestamp
  --max-files <n>              Concurrent files, default 3, range 1-8
  --chunk-concurrency <n>      Concurrent chunks per file, default 3, range 1-8
  --dry-run                    Scan and validate inputs without requesting STS or uploading
  --help                       Show this message
`;

export class CliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

function readOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new CliError(`${option} requires a value`);
  }
  return value;
}

function parseConcurrency(raw, option) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < MIN_CONCURRENCY || value > MAX_CONCURRENCY) {
    throw new CliError(`${option} must be an integer between ${MIN_CONCURRENCY} and ${MAX_CONCURRENCY}`);
  }
  return value;
}

export function parseArgs(argv) {
  const options = {
    inputs: [],
    env: "",
    paramsFile: "",
    out: "",
    maxFiles: DEFAULT_FILE_CONCURRENCY,
    chunkConcurrency: DEFAULT_CHUNK_CONCURRENCY,
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--env") {
      options.env = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--params-file") {
      options.paramsFile = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--max-files") {
      options.maxFiles = parseConcurrency(readOptionValue(argv, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--chunk-concurrency") {
      options.chunkConcurrency = parseConcurrency(readOptionValue(argv, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new CliError(`unknown option: ${arg}`);
    }
    options.inputs.push(arg);
  }

  return options;
}

export function validateOptions(options) {
  if (options.help) return;
  if (options.inputs.length === 0) {
    throw new CliError("at least one input file or directory is required");
  }
  if (!Object.hasOwn(ENV_ENDPOINTS, options.env)) {
    throw new CliError("--env must be one of: test, beta, prod");
  }
  if (!options.dryRun && !options.paramsFile) {
    throw new CliError("--params-file is required for live uploads");
  }
}

export function detectMediaType(filePath) {
  return EXTENSION_TYPES.get(path.extname(filePath).toLowerCase());
}

async function visitInput(candidate, state) {
  let resolved;
  let stat;
  try {
    resolved = await fs.realpath(path.resolve(candidate));
    stat = await fs.stat(resolved);
  } catch {
    throw new CliError(`input does not exist or cannot be read: ${path.resolve(candidate)}`);
  }

  if (stat.isDirectory()) {
    if (state.directories.has(resolved)) return;
    state.directories.add(resolved);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await visitInput(path.join(resolved, entry.name), state);
    }
    return;
  }

  if (!stat.isFile() || state.files.has(resolved)) return;
  state.files.add(resolved);
  const type = detectMediaType(resolved);
  state.items.push({
    source: resolved,
    size: stat.size,
    ...(type ? { type } : {})
  });
}

export async function scanInputs(inputs) {
  const state = {
    directories: new Set(),
    files: new Set(),
    items: []
  };

  for (const input of inputs) {
    await visitInput(input, state);
  }
  state.items.sort((left, right) => left.source.localeCompare(right.source));

  if (state.items.length === 0) {
    throw new CliError("no files were discovered in the provided inputs");
  }
  if (!state.items.some((item) => item.type)) {
    throw new CliError("no supported image, video, or audio files were discovered");
  }
  return state.items;
}

function isScalarQueryValue(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

export async function readParamsFile(paramsFile) {
  const resolved = path.resolve(paramsFile);
  let raw;
  try {
    raw = await fs.readFile(resolved, "utf8");
  } catch {
    throw new CliError(`parameter file does not exist or cannot be read: ${resolved}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError("parameter file must contain valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError("parameter file must contain a JSON object");
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!isScalarQueryValue(value)) {
      throw new CliError(`parameter file field ${key} must be a scalar value`);
    }
  }
  if (!String(parsed.appId || "").trim() || !String(parsed.appKey || "").trim()) {
    throw new CliError("parameter file must include non-empty appId and appKey fields");
  }
  return { ...parsed };
}

export function createRequestSign(appId, appKey, timestamp, nonce) {
  return createHash("sha1")
    .update(`${appId}|${appKey}|${timestamp}|${nonce}`)
    .digest("hex")
    .toUpperCase();
}

export function buildStsQuery(baseQuery, item, requestContext = {}) {
  if (!item.type) {
    throw new CliError(`cannot build STS query for unsupported file: ${item.source}`);
  }

  const query = {};
  for (const [key, value] of Object.entries(baseQuery)) {
    if (!RESERVED_QUERY_FIELDS.has(key) && value !== null && value !== undefined) {
      query[key] = value;
    }
  }

  const timestamp = requestContext.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = requestContext.nonce ?? randomBytes(16).toString("hex");
  const appId = String(query.appId || "");
  const appKey = String(query.appKey || "");
  if (!appId || !appKey) {
    throw new CliError("STS query requires appId and appKey");
  }

  const suffix = path.extname(item.source).slice(1).toLowerCase();
  return {
    ...query,
    fService: "private",
    fType: item.type === "image" ? "picture" : item.type,
    fSuffix: suffix,
    fSize: String(item.size),
    timestamp,
    nonce,
    sign: createRequestSign(appId, appKey, timestamp, nonce)
  };
}

function toSearchParams(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) {
      params.set(key, String(value));
    }
  }
  return params;
}

function createLinkedTimeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("STS request timed out")), timeoutMs);
  const abortFromParent = () => controller.abort(parentSignal.reason);

  if (parentSignal.aborted) {
    abortFromParent();
  } else {
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      parentSignal.removeEventListener("abort", abortFromParent);
    }
  };
}

export async function requestStsToken({ endpoint, query, signal, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch API is unavailable; Node.js 22 or newer is required");
  }

  const url = new URL(STS_PATH, endpoint);
  url.search = toSearchParams(query).toString();
  const timeout = createLinkedTimeoutSignal(signal, 30_000);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: timeout.signal
    });
    if (!response.ok) {
      throw new Error(`STS request failed with HTTP ${response.status}`);
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error("STS response is not valid JSON");
    }
    if (!body || body.code !== 200) {
      throw new Error(`STS request failed with code ${body?.code ?? "unknown"}`);
    }
    if (!body.data || typeof body.data !== "object") {
      throw new Error("STS response does not contain data");
    }
    return normalizeStsData(body.data);
  } finally {
    timeout.cleanup();
  }
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function normalizeStsData(data) {
  if (!data || typeof data !== "object") {
    throw new Error("STS data is invalid");
  }
  const nested = data.credentials && typeof data.credentials === "object"
    ? data.credentials
    : {};
  const credentials = {
    tmpSecretId: data.tmpSecretId || nested.tmpSecretId,
    tmpSecretKey: data.tmpSecretKey || nested.tmpSecretKey,
    sessionToken: data.sessionToken || nested.sessionToken
  };

  if (!credentials.tmpSecretId || !credentials.tmpSecretKey || !credentials.sessionToken) {
    throw new Error("STS response is missing temporary credentials");
  }
  if (!data.bucket || !data.region || !data.key) {
    throw new Error("STS response is missing bucket, region, or key");
  }

  return {
    ...data,
    credentials,
    startTime: positiveNumber(data.startTime),
    expiredTime: positiveNumber(data.expiredTime)
  };
}

function normalizeDomain(domain) {
  if (!domain) return "";
  return String(domain).trim().replace(/^https?:\/\//i, "").replace(/^\/\//, "").replace(/\/+$/, "");
}

export function toHttps(value) {
  const raw = String(value || "").trim();
  if (raw.startsWith("//")) return `https:${raw}`;
  if (/^http:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, "https://");
  return raw;
}

export function resolveResultUrl(stsData, uploadData = {}) {
  if (stsData.downloadUrl) {
    return toHttps(stsData.downloadUrl);
  }
  if (uploadData.Location) {
    const location = String(uploadData.Location).trim();
    return toHttps(/^https?:\/\//i.test(location) || location.startsWith("//")
      ? location
      : `https://${location}`);
  }
  const domain = normalizeDomain(stsData.domain);
  if (domain) {
    return `https://${domain}/${String(stsData.key).replace(/^\/+/, "")}`;
  }
  throw new Error("upload succeeded but no usable download URL was returned");
}

async function createDefaultCosClient(stsData, chunkConcurrency) {
  const cosModule = await import("cos-nodejs-sdk-v5");
  const COS = cosModule.default || cosModule;
  const domain = normalizeDomain(stsData.domain);
  return new COS({
    SecretId: stsData.credentials.tmpSecretId,
    SecretKey: stsData.credentials.tmpSecretKey,
    SecurityToken: stsData.credentials.sessionToken,
    StartTime: stsData.startTime,
    ExpiredTime: stsData.expiredTime,
    Protocol: "https:",
    ...(domain ? { Domain: domain } : {}),
    ForceSignHost: stsData.forceSignHost ?? false,
    ChunkRetryTimes: 3,
    ChunkParallelLimit: chunkConcurrency,
    UploadIdCacheLimit: 100
  });
}

export async function uploadWithCos({ item, stsData, chunkConcurrency, signal, createCosClient = createDefaultCosClient }) {
  if (signal.aborted) {
    throw new Error("upload cancelled");
  }

  const cos = await createCosClient(stsData, chunkConcurrency);
  if (signal.aborted) {
    throw new Error("upload cancelled");
  }
  return await new Promise((resolve, reject) => {
    let taskId = "";
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abortUpload);
      callback(value);
    };
    const abortUpload = () => {
      try {
        if (taskId && typeof cos.cancelTask === "function") {
          cos.cancelTask(taskId);
        }
      } catch {
        // Cancellation errors do not replace the original abort reason.
      }
      finish(reject, new Error("upload cancelled"));
    };

    signal.addEventListener("abort", abortUpload, { once: true });
    try {
      cos.uploadFile({
        Bucket: stsData.bucket,
        Region: stsData.region,
        Key: stsData.key,
        FilePath: item.source,
        SliceSize: CHUNK_SIZE,
        ChunkSize: CHUNK_SIZE,
        ChunkParallelLimit: chunkConcurrency,
        onTaskReady(id) {
          taskId = id;
          if (signal.aborted) abortUpload();
        }
      }, (error, data) => {
        if (signal.aborted) {
          abortUpload();
          return;
        }
        if (error) {
          finish(reject, new Error(error.message || "Tencent COS upload failed"));
          return;
        }
        finish(resolve, data || {});
      });
    } catch (error) {
      finish(reject, error);
    }
  });
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

async function runWorkerPool(items, concurrency, worker) {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

export async function runUploadBatch({
  items,
  env,
  baseQuery = {},
  maxFiles = DEFAULT_FILE_CONCURRENCY,
  chunkConcurrency = DEFAULT_CHUNK_CONCURRENCY,
  dryRun = false,
  signal,
  requestSts = requestStsToken,
  uploadCos = uploadWithCos,
  now = () => new Date()
}) {
  const startedAt = now().toISOString();
  const results = items.map((item) => ({
    source: item.source,
    size: item.size,
    ...(item.type ? { type: item.type } : {}),
    status: item.type ? (dryRun ? "planned" : "pending") : "skipped",
    ...(!item.type ? { reason: "unsupported file extension" } : {})
  }));

  if (!dryRun) {
    const supported = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.type);

    await runWorkerPool(supported, maxFiles, async ({ item, index }) => {
      if (signal.aborted) {
        results[index] = { ...results[index], status: "failed", error: "upload cancelled" };
        return;
      }

      try {
        const query = buildStsQuery(baseQuery, item);
        const stsData = await requestSts({
          endpoint: ENV_ENDPOINTS[env],
          query,
          signal
        });
        const uploadData = await uploadCos({
          item,
          stsData,
          chunkConcurrency,
          signal
        });
        results[index] = {
          ...results[index],
          status: "uploaded",
          key: stsData.key,
          url: resolveResultUrl(stsData, uploadData)
        };
      } catch (error) {
        results[index] = {
          ...results[index],
          status: "failed",
          error: sanitizeError(error)
        };
      }
    });
  }

  const summary = {
    discovered: results.length,
    uploaded: results.filter((item) => item.status === "uploaded").length,
    failed: results.filter((item) => item.status === "failed").length,
    skipped: results.filter((item) => item.status === "skipped").length
  };
  if (dryRun) {
    summary.planned = results.filter((item) => item.status === "planned").length;
  }

  return {
    version: 1,
    environment: env,
    dryRun,
    startedAt,
    finishedAt: now().toISOString(),
    summary,
    items: results
  };
}

function defaultOutputPath() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(`tencent-cos-upload-result-${timestamp}.json`);
}

export async function writeManifest(manifest, outputPath) {
  const resolved = path.resolve(outputPath || defaultOutputPath());
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, resolved);
  return resolved;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  validateOptions(options);

  const items = await scanInputs(options.inputs);
  const baseQuery = options.dryRun ? {} : await readParamsFile(options.paramsFile);
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("upload cancelled"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  try {
    process.stderr.write(`Discovered ${items.length} file(s); target environment: ${options.env}\n`);
    const manifest = await runUploadBatch({
      items,
      env: options.env,
      baseQuery,
      maxFiles: options.maxFiles,
      chunkConcurrency: options.chunkConcurrency,
      dryRun: options.dryRun,
      signal: controller.signal
    });
    const outputPath = await writeManifest(manifest, options.out);
    process.stdout.write(`${outputPath}\n`);
    process.stderr.write(
      `Uploaded ${manifest.summary.uploaded}; failed ${manifest.summary.failed}; skipped ${manifest.summary.skipped}`
      + `${options.dryRun ? `; planned ${manifest.summary.planned}` : ""}\n`
    );
    return manifest.summary.failed > 0 ? 1 : 0;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entryUrl) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const exitCode = error instanceof CliError ? error.exitCode : 2;
      process.stderr.write(`Error: ${sanitizeError(error)}\n`);
      process.exitCode = exitCode;
    });
}
