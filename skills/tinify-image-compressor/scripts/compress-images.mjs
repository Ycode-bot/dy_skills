#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const DEFAULT_API_KEY_ENVS = ["TINIFY_API_KEY", "ACTIVITY_CMS_PSD_TINIFY_KEY"];
const RESIZE_METHODS = new Set(["scale", "fit", "cover", "thumb"]);
const CONVERT_TYPES = {
  avif: { mime: "image/avif", extension: ".avif" },
  webp: { mime: "image/webp", extension: ".webp" },
  jpeg: { mime: "image/jpeg", extension: ".jpg" },
  png: { mime: "image/png", extension: ".png" }
};
const PRESERVE_FIELDS = new Set(["copyright", "creation", "location"]);

const HELP_TEXT = `Tinify image compression helper

Live compression requires a Tinify API key and consumes Tinify quota.
Use --dry-run first to preview input/output mapping without calling Tinify.

Usage:
  node scripts/compress-images.mjs <input...> --out <path> [options]

Examples:
  node scripts/compress-images.mjs assets --out dist/assets-optimized
  node scripts/compress-images.mjs hero.png --out dist/hero.webp --convert webp
  node scripts/compress-images.mjs screenshots --out dist/shots --resize fit:1600x1600
  node scripts/compress-images.mjs sticker.png --out dist/sticker.jpg --convert jpeg --background white
  node scripts/compress-images.mjs assets --out dist/assets-optimized --dry-run

Options:
  --out <path>                    Output file or directory
  --convert <avif|webp|jpeg|png> Convert output format
  --resize <method:widthxheight> Resize shorthand, e.g. fit:1600x1600
  --preserve <comma,list>         Metadata to preserve: copyright,creation,location
  --background <value>            white, black, or #RRGGBB for transparent -> JPEG conversions
  --api-key-env <NAME>            Use a custom API key environment variable
  --max-jobs <n>                  Parallel uploads, default 4
  --dry-run                       Print the planned work without calling Tinify
  --help                          Show this message
`;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    inputs: [],
    output: "",
    convert: "",
    resize: null,
    preserve: [],
    background: "",
    apiKeyEnv: "",
    maxJobs: 4,
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

    if (arg === "--out") {
      options.output = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (arg === "--convert") {
      options.convert = (argv[index + 1] || "").toLowerCase();
      index += 1;
      continue;
    }

    if (arg === "--resize") {
      options.resize = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (arg === "--preserve") {
      options.preserve = String(argv[index + 1] || "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (arg === "--background") {
      options.background = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (arg === "--api-key-env") {
      options.apiKeyEnv = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (arg === "--max-jobs") {
      options.maxJobs = Number.parseInt(argv[index + 1] || "", 10);
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      fail(`unknown option: ${arg}`);
    }

    options.inputs.push(arg);
  }

  return options;
}

function parseResizeSpec(rawSpec) {
  if (!rawSpec) {
    return null;
  }

  const match = /^([a-z]+):(\d*)x(\d*)$/i.exec(rawSpec.trim());
  if (!match) {
    fail(`invalid resize spec "${rawSpec}". Use method:widthxheight, e.g. fit:1600x1600`);
  }

  const method = match[1].toLowerCase();
  const width = match[2] ? Number.parseInt(match[2], 10) : undefined;
  const height = match[3] ? Number.parseInt(match[3], 10) : undefined;

  if (!RESIZE_METHODS.has(method)) {
    fail(`unsupported resize method "${method}". Use one of: ${Array.from(RESIZE_METHODS).join(", ")}`);
  }

  if (method === "scale") {
    if ((width && height) || (!width && !height)) {
      fail('resize method "scale" requires exactly one dimension, e.g. scale:1600x or scale:x900');
    }
  } else if (!width || !height) {
    fail(`resize method "${method}" requires both width and height, e.g. ${method}:1600x1600`);
  }

  return { method, width, height };
}

function parsePreserveFields(values) {
  const unique = [];
  for (const value of values) {
    if (!PRESERVE_FIELDS.has(value)) {
      fail(`unsupported preserve field "${value}". Use: ${Array.from(PRESERVE_FIELDS).join(", ")}`);
    }
    if (!unique.includes(value)) {
      unique.push(value);
    }
  }
  return unique;
}

function parseBackground(value) {
  if (!value) {
    return "";
  }

  if (value === "white" || value === "black") {
    return value;
  }

  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    return value;
  }

  fail(`invalid background "${value}". Use white, black, or a hex color like #000000`);
}

function detectConvertType(value) {
  if (!value) {
    return null;
  }

  const type = CONVERT_TYPES[value];
  if (!type) {
    fail(`unsupported convert target "${value}". Use one of: ${Object.keys(CONVERT_TYPES).join(", ")}`);
  }
  return type;
}

function normalizeRootName(inputPath, kind) {
  const resolved = path.resolve(inputPath);
  const parsed = path.parse(resolved);
  const candidate = kind === "file" ? path.basename(parsed.dir) || parsed.name : parsed.base;
  return candidate.replace(/[^a-zA-Z0-9._-]+/g, "-") || "input";
}

function makeUniqueRootNames(inputs, kinds) {
  const seen = new Map();
  return inputs.map((inputPath, index) => {
    const baseName = normalizeRootName(inputPath, kinds[index]);
    const count = (seen.get(baseName) || 0) + 1;
    seen.set(baseName, count);
    return count === 1 ? baseName : `${baseName}-${count}`;
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = -1;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

async function pathKind(targetPath) {
  try {
    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
      return "directory";
    }
    if (stats.isFile()) {
      return "file";
    }
    return "other";
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "missing";
    }
    throw error;
  }
}

function isSupportedImage(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function collectFiles(inputPath, groupName) {
  const absoluteInput = path.resolve(inputPath);
  const kind = await pathKind(absoluteInput);

  if (kind === "missing") {
    fail(`input not found: ${inputPath}`);
  }

  if (kind === "file") {
    if (!isSupportedImage(absoluteInput)) {
      return [];
    }

    return [
      {
        groupName,
        inputPath: absoluteInput,
        rootPath: path.dirname(absoluteInput),
        relativePath: path.basename(absoluteInput)
      }
    ];
  }

  if (kind !== "directory") {
    fail(`unsupported input type: ${inputPath}`);
  }

  const items = [];
  async function walk(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(nextPath);
        continue;
      }
      if (entry.isFile() && isSupportedImage(nextPath)) {
        items.push({
          groupName,
          inputPath: nextPath,
          rootPath: absoluteInput,
          relativePath: path.relative(absoluteInput, nextPath)
        });
      }
    }
  }

  await walk(absoluteInput);
  return items;
}

function chooseOutputMode(inputKinds, outputKind, outputTarget) {
  const hasDirectoryInput = inputKinds.includes("directory");
  const multipleInputs = inputKinds.length > 1;

  if (hasDirectoryInput || multipleInputs) {
    if (outputKind === "file") {
      fail("directory or multi-input runs require --out to be a directory");
    }
    return "directory";
  }

  if (outputKind === "missing") {
    if (outputTarget.endsWith(path.sep) || path.extname(outputTarget) === "") {
      return "directory";
    }
  }

  return outputKind === "directory" ? "directory" : "file";
}

function buildOutputPath(item, outputTarget, outputMode, convertType, preserveInputRoots) {
  if (outputMode === "file") {
    return path.resolve(outputTarget);
  }

  const relativePath = preserveInputRoots ? path.join(item.groupName, item.relativePath) : item.relativePath;
  const sourceExtension = path.extname(relativePath);
  const relativeBase = relativePath.slice(0, relativePath.length - sourceExtension.length);
  const outputExtension = convertType ? convertType.extension : sourceExtension;
  return path.join(path.resolve(outputTarget), `${relativeBase}${outputExtension}`);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function summarizePlan(plan) {
  console.log(`Planned files: ${plan.length}`);
  for (const item of plan) {
    console.log(`- ${item.inputPath} -> ${item.outputPath}`);
  }
}

async function loadTinify() {
  try {
    const module = await import("tinify");
    return module.default || module;
  } catch (error) {
    if (error && String(error.message || "").includes("Cannot find package 'tinify'")) {
      fail('missing dependency "tinify". Run "npm install" inside skills/tinify-image-compressor first.');
    }
    throw error;
  }
}

function resolveApiKey(apiKeyEnv) {
  if (apiKeyEnv) {
    const customValue = process.env[apiKeyEnv];
    if (!customValue) {
      fail(
        `environment variable ${apiKeyEnv} is not set.\n` +
          `Set it before running live compression, for example:\n` +
          `  export ${apiKeyEnv}="your-tinify-api-key"`
      );
    }
    return { key: customValue, source: apiKeyEnv };
  }

  for (const envName of DEFAULT_API_KEY_ENVS) {
    if (process.env[envName]) {
      return { key: process.env[envName], source: envName };
    }
  }

  fail(
    `missing Tinify API key. Live compression calls Tinify and consumes quota.\n` +
      `Set one of these environment variables before running:\n` +
      `  export TINIFY_API_KEY="your-tinify-api-key"\n` +
      `  export ACTIVITY_CMS_PSD_TINIFY_KEY="your-tinify-api-key"\n` +
      `Or run with --dry-run first to preview the output mapping without calling Tinify.`
  );
}

async function validateTinify(tinify) {
  await new Promise((resolve, reject) => {
    tinify.validate((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function describeTinifyError(error) {
  const name = error?.constructor?.name || "Error";
  const message = error?.message || String(error);

  if (name === "AccountError") {
    return `Tinify AccountError: ${message}`;
  }
  if (name === "ClientError") {
    return `Tinify ClientError: ${message}`;
  }
  if (name === "ServerError") {
    return `Tinify ServerError: ${message}`;
  }
  if (name === "ConnectionError") {
    return `Tinify ConnectionError: ${message}`;
  }

  return `${name}: ${message}`;
}

async function processFile(tinify, item, options) {
  await fs.mkdir(path.dirname(item.outputPath), { recursive: true });

  let source = tinify.fromFile(item.inputPath);
  if (options.resize) {
    source = source.resize(options.resize);
  }
  if (options.convertType) {
    source = source.convert({ type: options.convertType.mime });
    if (options.background) {
      source = source.transform({ background: options.background });
    }
  }
  if (options.preserve.length > 0) {
    source = source.preserve(...options.preserve);
  }

  await source.toFile(item.outputPath);

  const [beforeStats, afterStats] = await Promise.all([
    fs.stat(item.inputPath),
    fs.stat(item.outputPath)
  ]);

  return {
    inputPath: item.inputPath,
    outputPath: item.outputPath,
    beforeBytes: beforeStats.size,
    afterBytes: afterStats.size
  };
}

function printSummary(results, compressionCount) {
  const totalBefore = results.reduce((sum, item) => sum + item.beforeBytes, 0);
  const totalAfter = results.reduce((sum, item) => sum + item.afterBytes, 0);
  const totalSaved = totalBefore - totalAfter;
  const percent = totalBefore > 0 ? ((totalSaved / totalBefore) * 100).toFixed(1) : "0.0";

  console.log(`Optimized files: ${results.length}`);
  console.log(`Total size: ${formatBytes(totalBefore)} -> ${formatBytes(totalAfter)} (${percent}% smaller)`);
  if (typeof compressionCount === "number") {
    console.log(`Tinify compression count this month: ${compressionCount}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  if (args.inputs.length === 0) {
    fail("at least one input path is required");
  }

  if (!args.output) {
    fail("--out is required");
  }

  if (!Number.isInteger(args.maxJobs) || args.maxJobs < 1) {
    fail("--max-jobs must be a positive integer");
  }

  const convertType = detectConvertType(args.convert);
  const resize = parseResizeSpec(args.resize);
  const preserve = parsePreserveFields(args.preserve);
  const background = parseBackground(args.background);
  if (background && !convertType) {
    fail("--background requires --convert so Tinify can apply a transform");
  }

  const inputKinds = await Promise.all(args.inputs.map((inputPath) => pathKind(path.resolve(inputPath))));
  const rootNames = makeUniqueRootNames(args.inputs, inputKinds);

  const collected = await Promise.all(
    args.inputs.map(async (inputPath, index) => ({
      inputPath,
      rootName: rootNames[index],
      kind: inputKinds[index],
      files: await collectFiles(inputPath, rootNames[index])
    }))
  );

  const plan = collected.flatMap((item) => item.files);
  if (plan.length === 0) {
    fail("no supported image files were found");
  }

  const outputKind = await pathKind(path.resolve(args.output));
  const outputMode = chooseOutputMode(
    collected.map((item) => item.kind),
    outputKind,
    args.output
  );
  const preserveInputRoots = collected.length > 1;

  const jobs = plan.map((item) => ({
    ...item,
    outputPath: buildOutputPath(item, args.output, outputMode, convertType, preserveInputRoots)
  }));

  if (args.dryRun) {
    summarizePlan(jobs);
    return;
  }

  const { key, source } = resolveApiKey(args.apiKeyEnv);
  const tinify = await loadTinify();
  tinify.key = key;

  console.log("Reminder: this run will call Tinify's API and may consume compression quota.");
  await validateTinify(tinify);

  console.log(`Using API key from ${source}`);
  console.log(`Processing ${jobs.length} file(s)...`);

  const results = await mapLimit(jobs, args.maxJobs, async (job) => {
    try {
      const result = await processFile(tinify, job, {
        resize,
        preserve,
        background,
        convertType
      });
      console.log(`OK  ${job.inputPath} -> ${job.outputPath}`);
      return result;
    } catch (error) {
      throw new Error(`${job.inputPath}: ${describeTinifyError(error)}`);
    }
  });

  printSummary(results, tinify.compressionCount);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
