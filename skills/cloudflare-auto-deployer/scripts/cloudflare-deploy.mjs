#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_BUILD_DIRS = ["dist", "build", "out", "public", "web-dist", ".output/public"];
const FRAMEWORK_OUTPUTS = {
  astro: "dist",
  "create-react-app": "build",
  next: "out",
  nuxt: ".output/public",
  sveltekit: "build",
  vite: "dist"
};

const HELP_TEXT = `Cloudflare deployment helper

Usage:
  node scripts/cloudflare-deploy.mjs detect <project-dir> [options]
  node scripts/cloudflare-deploy.mjs verify-token
  node scripts/cloudflare-deploy.mjs deploy <project-dir> [options]
  node scripts/cloudflare-deploy.mjs github-action <project-dir> [options]
  node scripts/cloudflare-deploy.mjs bootstrap-pages <project-dir> [options]

Examples:
  node scripts/cloudflare-deploy.mjs detect ../my-project
  node scripts/cloudflare-deploy.mjs verify-token
  node scripts/cloudflare-deploy.mjs deploy ../my-project
  node scripts/cloudflare-deploy.mjs deploy ../my-project --mode pages --pages-project cms-psd --assets dist
  node scripts/cloudflare-deploy.mjs deploy ../my-project --mode workers --env production --run
  node scripts/cloudflare-deploy.mjs github-action ../my-project --write .github/workflows/cloudflare-deploy.yml
  node scripts/cloudflare-deploy.mjs bootstrap-pages ../my-project --apply

Options:
  --mode <auto|pages|workers>    Override deployment type detection
  --config <path>                Explicit Wrangler config path
  --build <command>              Build command to run before --run deploy
  --run                          Execute the deployment instead of only printing the plan
  --apply                        Write inferred bootstrap changes back into the project
  --pages-project <name>         Cloudflare Pages project name
  --assets <dir>                 Build output or static assets directory
  --branch <name>                Pages deployment branch metadata
  --commit-hash <sha>            Pages deployment commit hash metadata
  --commit-message <message>     Pages deployment commit message metadata
  --commit-dirty                 Mark a Pages deployment as dirty
  --env <name>                   Wrangler environment for Workers deploys
  --keep-vars                    Preserve dashboard-managed vars on Workers deploys
  --secrets-file <path>          Upload Worker secrets from JSON or .env
  --route <pattern>              Additional Worker route, repeatable
  --domain <hostname>            Additional Worker custom domain, repeatable
  --wrangler-dry-run             Execute Workers deploy with Wrangler's --dry-run
  --compatibility-date <date>    Compatibility date for generated Pages Wrangler config
  --write <path>                 Write generated GitHub Actions workflow to a file
  --help                         Show this help text

Environment:
  CLOUDFLARE_API_TOKEN           Required for token verification and live deploys
  CLOUDFLARE_ACCOUNT_ID          Recommended for Pages direct-upload deploys
`;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    command: "",
    projectDir: "",
    mode: "auto",
    config: "",
    build: "",
    run: false,
    apply: false,
    pagesProject: "",
    assets: "",
    branch: "",
    commitHash: "",
    commitMessage: "",
    commitDirty: false,
    env: "",
    keepVars: false,
    secretsFile: "",
    route: [],
    domain: [],
    wranglerDryRun: false,
    compatibilityDate: "",
    write: "",
    help: false
  };

  if (argv.length === 0 || argv[0] === "--help") {
    options.help = true;
    return options;
  }

  options.command = argv[0] || "";
  let index = 1;
  if (["detect", "deploy", "github-action", "bootstrap-pages"].includes(options.command)) {
    const maybeProjectDir = argv[index];
    if (!maybeProjectDir || maybeProjectDir.startsWith("--")) {
      fail(`${options.command} requires <project-dir>`);
    }
    options.projectDir = maybeProjectDir;
    index += 1;
  }

  for (; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--run") {
      options.run = true;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--commit-dirty") {
      options.commitDirty = true;
      continue;
    }
    if (arg === "--keep-vars") {
      options.keepVars = true;
      continue;
    }
    if (arg === "--wrangler-dry-run") {
      options.wranglerDryRun = true;
      continue;
    }

    const next = argv[index + 1] || "";
    if (arg === "--mode") {
      options.mode = next;
      index += 1;
      continue;
    }
    if (arg === "--config") {
      options.config = next;
      index += 1;
      continue;
    }
    if (arg === "--build") {
      options.build = next;
      index += 1;
      continue;
    }
    if (arg === "--pages-project") {
      options.pagesProject = next;
      index += 1;
      continue;
    }
    if (arg === "--assets") {
      options.assets = next;
      index += 1;
      continue;
    }
    if (arg === "--branch") {
      options.branch = next;
      index += 1;
      continue;
    }
    if (arg === "--commit-hash") {
      options.commitHash = next;
      index += 1;
      continue;
    }
    if (arg === "--commit-message") {
      options.commitMessage = next;
      index += 1;
      continue;
    }
    if (arg === "--env") {
      options.env = next;
      index += 1;
      continue;
    }
    if (arg === "--secrets-file") {
      options.secretsFile = next;
      index += 1;
      continue;
    }
    if (arg === "--route") {
      options.route.push(next);
      index += 1;
      continue;
    }
    if (arg === "--domain") {
      options.domain.push(next);
      index += 1;
      continue;
    }
    if (arg === "--compatibility-date") {
      options.compatibilityDate = next;
      index += 1;
      continue;
    }
    if (arg === "--write") {
      options.write = next;
      index += 1;
      continue;
    }

    fail(`unknown option: ${arg}`);
  }

  return options;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(targetPath) {
  return (await fileExists(targetPath)) ? fs.readFile(targetPath, "utf8") : "";
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

function stripJsonComments(input) {
  let output = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;

  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const next = input[index + 1];

    if (inLineComment) {
      if (current === "\n") {
        inLineComment = false;
        output += current;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (!inString && current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (!inString && current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += current;
    if (inString) {
      if (!escape && current === "\"") {
        inString = false;
      }
      escape = !escape && current === "\\";
      if (current !== "\\") {
        escape = false;
      }
    } else if (current === "\"") {
      inString = true;
      escape = false;
    }
  }

  return output;
}

async function parseConfig(configPath) {
  const content = await fs.readFile(configPath, "utf8");
  const extension = path.extname(configPath).toLowerCase();

  if (extension === ".json" || extension === ".jsonc") {
    const json = JSON.parse(stripJsonComments(content));
    return {
      name: typeof json.name === "string" ? json.name : "",
      pagesBuildOutputDir: typeof json.pages_build_output_dir === "string" ? json.pages_build_output_dir : "",
      main: typeof json.main === "string" ? json.main : "",
      compatibilityDate: typeof json.compatibility_date === "string" ? json.compatibility_date : "",
      assetsDirectory:
        json.assets && typeof json.assets.directory === "string" ? json.assets.directory : "",
      raw: json
    };
  }

  if (extension !== ".toml") {
    return {
      name: "",
      pagesBuildOutputDir: "",
      main: "",
      compatibilityDate: "",
      assetsDirectory: "",
      raw: {}
    };
  }

  let currentSection = "";
  const result = {
    name: "",
    pagesBuildOutputDir: "",
    main: "",
    compatibilityDate: "",
    assetsDirectory: "",
    raw: {}
  };
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      continue;
    }
    const sectionMatch = /^\[(.+)\]$/.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }
    const kvMatch = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (!kvMatch) {
      continue;
    }
    const key = kvMatch[1];
    const value = kvMatch[2].trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

    if (!currentSection && key === "name") {
      result.name = value;
    } else if (!currentSection && key === "pages_build_output_dir") {
      result.pagesBuildOutputDir = value;
    } else if (!currentSection && key === "main") {
      result.main = value;
    } else if (!currentSection && key === "compatibility_date") {
      result.compatibilityDate = value;
    } else if (currentSection === "assets" && key === "directory") {
      result.assetsDirectory = value;
    }
  }

  return result;
}

async function findWranglerConfig(projectDir, explicitConfig) {
  if (explicitConfig) {
    const resolved = path.resolve(projectDir, explicitConfig);
    if (!(await fileExists(resolved))) {
      fail(`Wrangler config not found: ${resolved}`);
    }
    return resolved;
  }

  const candidates = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];
  for (const candidate of candidates) {
    const resolved = path.join(projectDir, candidate);
    if (await fileExists(resolved)) {
      return resolved;
    }
  }
  return "";
}

async function readPackageJson(projectDir) {
  const packagePath = path.join(projectDir, "package.json");
  if (!(await fileExists(packagePath))) {
    return { path: packagePath, data: null };
  }
  return {
    path: packagePath,
    data: JSON.parse(await fs.readFile(packagePath, "utf8"))
  };
}

function collectDependencies(packageJson) {
  const all = {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {})
  };
  return new Set(Object.keys(all));
}

function detectFrontendFramework(packageJson) {
  const deps = collectDependencies(packageJson);
  if (deps.has("next")) {
    return "next";
  }
  if (deps.has("nuxt") || deps.has("nuxi")) {
    return "nuxt";
  }
  if (deps.has("astro")) {
    return "astro";
  }
  if (deps.has("@sveltejs/kit")) {
    return "sveltekit";
  }
  if (deps.has("react-scripts")) {
    return "create-react-app";
  }
  if (deps.has("vite")) {
    return "vite";
  }
  if (deps.has("react") || deps.has("vue") || deps.has("svelte")) {
    return "frontend";
  }
  return "unknown";
}

async function inferAssetsDirFromFrontendConfigs(projectDir, framework) {
  const configCandidates = [
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mjs",
    "vite.config.cjs",
    "vite.config.mts",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "nuxt.config.ts",
    "nuxt.config.js",
    "astro.config.mjs",
    "astro.config.ts"
  ];

  for (const candidate of configCandidates) {
    const configPath = path.join(projectDir, candidate);
    const content = await readTextIfExists(configPath);
    if (!content) {
      continue;
    }

    const rootMatch = content.match(/root\s*:\s*["'`](.+?)["'`]/);
    const outDirMatch = content.match(/outDir\s*:\s*["'`](.+?)["'`]/);
    if (outDirMatch) {
      const resolved = path.resolve(projectDir, rootMatch?.[1] || ".", outDirMatch[1]);
      const relative = path.relative(projectDir, resolved);
      return relative || ".";
    }

    if (candidate.startsWith("next.config")) {
      const exportMatch = content.match(/output\s*:\s*["'`]export["'`]/);
      if (exportMatch) {
        return "out";
      }
    }

    if (candidate.startsWith("nuxt.config")) {
      const generateMatch = content.match(/nitro\s*:\s*\{[\s\S]*?preset\s*:\s*["'`]static["'`]/);
      if (generateMatch || framework === "nuxt") {
        return ".output/public";
      }
    }
  }

  return FRAMEWORK_OUTPUTS[framework] || "";
}

function inferBuildCommand(packageJson) {
  const scripts = packageJson?.scripts || {};
  const priorities = ["build:web", "build", "generate", "export"];
  for (const scriptName of priorities) {
    if (typeof scripts[scriptName] === "string" && scripts[scriptName].trim()) {
      return `npm run ${scriptName}`;
    }
  }
  return "";
}

async function findDefaultAssetsDir(projectDir, configMeta, packageJson, framework) {
  const candidates = [];
  if (configMeta.pagesBuildOutputDir) {
    candidates.push(configMeta.pagesBuildOutputDir);
  }
  if (configMeta.assetsDirectory) {
    candidates.push(configMeta.assetsDirectory);
  }

  const inferredFromConfigs = await inferAssetsDirFromFrontendConfigs(projectDir, framework);
  if (inferredFromConfigs) {
    candidates.push(inferredFromConfigs);
  }

  const scriptValues = Object.values(packageJson?.scripts || {});
  for (const scriptValue of scriptValues) {
    const match = String(scriptValue).match(/\b(?:vite build|next export|nuxi generate)\b[\s\S]*?(?:--outDir|--out-dir)\s+([^\s]+)/);
    if (match) {
      candidates.push(match[1]);
    }
  }

  candidates.push(...DEFAULT_BUILD_DIRS);
  const deduped = [...new Set(candidates.filter(Boolean))];

  for (const candidate of deduped) {
    const resolved = path.resolve(projectDir, candidate);
    if ((await pathKind(resolved)) === "directory") {
      return candidate;
    }
  }

  return deduped[0] || "";
}

async function detectMode(projectDir, configMeta, forcedMode) {
  if (forcedMode && forcedMode !== "auto") {
    return forcedMode;
  }

  if (configMeta.pagesBuildOutputDir) {
    return "pages";
  }
  if (configMeta.main || configMeta.assetsDirectory) {
    return "workers";
  }

  if ((await pathKind(path.join(projectDir, "functions"))) === "directory") {
    return "pages";
  }
  if (await fileExists(path.join(projectDir, "_worker.js"))) {
    return "pages";
  }
  if (await fileExists(path.join(projectDir, "_routes.json"))) {
    return "pages";
  }

  if (configMeta.name) {
    return "workers";
  }

  return "unknown";
}

async function inspectProject(projectDir, options) {
  const resolvedProjectDir = path.resolve(projectDir);
  if ((await pathKind(resolvedProjectDir)) !== "directory") {
    fail(`project directory not found: ${resolvedProjectDir}`);
  }

  const configPath = await findWranglerConfig(resolvedProjectDir, options.config);
  const configMeta = configPath
    ? await parseConfig(configPath)
    : {
        name: "",
        pagesBuildOutputDir: "",
        main: "",
        compatibilityDate: "",
        assetsDirectory: "",
        raw: {}
      };
  const packageMeta = await readPackageJson(resolvedProjectDir);
  const framework = detectFrontendFramework(packageMeta.data);
  const mode = await detectMode(resolvedProjectDir, configMeta, options.mode);
  const inferredBuildCommand = options.build || inferBuildCommand(packageMeta.data);
  const defaultAssetsDir = options.assets || (await findDefaultAssetsDir(resolvedProjectDir, configMeta, packageMeta.data, framework));

  return {
    projectDir: resolvedProjectDir,
    configPath,
    configMeta,
    packageJsonPath: packageMeta.path,
    packageJson: packageMeta.data,
    framework,
    mode,
    inferredBuildCommand,
    defaultAssetsDir
  };
}

async function resolveWranglerExecutable() {
  const localBin = path.resolve(__dirname, "../node_modules/.bin/wrangler");
  const localCmd = `${localBin}.cmd`;
  if (process.platform === "win32") {
    return (await fileExists(localCmd))
      ? { command: localCmd, argsPrefix: [] }
      : { command: "npx", argsPrefix: ["wrangler"] };
  }
  return (await fileExists(localBin))
    ? { command: localBin, argsPrefix: [] }
    : { command: "npx", argsPrefix: ["wrangler"] };
}

function formatCommand(command, args) {
  return [command, ...args]
    .map((part) => (/[\s"'$]/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function printInspection(info) {
  console.log(`Project: ${info.projectDir}`);
  console.log(`Detected mode: ${info.mode}`);
  console.log(`Frontend framework: ${info.framework}`);
  console.log(`Wrangler config: ${info.configPath || "not found"}`);
  console.log(`Config name: ${info.configMeta.name || "not set"}`);
  console.log(`Pages build output dir: ${info.configMeta.pagesBuildOutputDir || "not set"}`);
  console.log(`Worker entry: ${info.configMeta.main || "not set"}`);
  console.log(`Build command: ${info.inferredBuildCommand || "not found"}`);
  console.log(`Assets directory: ${info.defaultAssetsDir || "not found"}`);
}

async function verifyToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    fail('missing CLOUDFLARE_API_TOKEN. Set it first, for example: export CLOUDFLARE_API_TOKEN="cfut_..."');
  }

  const response = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    fail(`Cloudflare token verification failed: ${JSON.stringify(payload)}`);
  }

  const status = payload.result?.status || "unknown";
  console.log(`Token status: ${status}`);
  for (const message of payload.messages || []) {
    if (message?.message) {
      console.log(`Message: ${message.message}`);
    }
  }
}

async function buildDeployPlan(info, options) {
  if (info.mode === "unknown") {
    fail("could not detect whether this project targets Cloudflare Pages or Workers. Rerun with --mode pages or --mode workers.");
  }

  const wrangler = await resolveWranglerExecutable();
  const args = [...wrangler.argsPrefix];
  const requiredEnv = ["CLOUDFLARE_API_TOKEN"];

  if (info.mode === "pages") {
    const assetsDir = options.assets || info.defaultAssetsDir;
    const projectName =
      options.pagesProject ||
      info.configMeta.name ||
      info.packageJson?.name ||
      path.basename(info.projectDir);
    if (!assetsDir) {
      fail("Pages deploy requires an assets directory. Pass --assets or set pages_build_output_dir in Wrangler config.");
    }
    if (!projectName) {
      fail("Pages deploy requires a project name. Pass --pages-project or set name in Wrangler config.");
    }
    requiredEnv.push("CLOUDFLARE_ACCOUNT_ID");
    args.push("pages", "deploy", assetsDir, "--project-name", projectName);
    if (options.branch) {
      args.push("--branch", options.branch);
    }
    if (options.commitHash) {
      args.push("--commit-hash", options.commitHash);
    }
    if (options.commitMessage) {
      args.push("--commit-message", options.commitMessage);
    }
    if (options.commitDirty) {
      args.push("--commit-dirty");
    }
    if (info.configPath) {
      args.push("--config", info.configPath);
    }
  } else {
    args.push("deploy");
    if (info.configPath) {
      args.push("--config", info.configPath);
    }
    if (options.env) {
      args.push("--env", options.env);
    }
    if (options.keepVars) {
      args.push("--keep-vars");
    }
    if (options.secretsFile) {
      args.push("--secrets-file", options.secretsFile);
    }
    for (const route of options.route) {
      args.push("--route", route);
    }
    for (const domain of options.domain) {
      args.push("--domain", domain);
    }
    if (options.wranglerDryRun) {
      args.push("--dry-run");
    }
  }

  return {
    mode: info.mode,
    projectDir: info.projectDir,
    configPath: info.configPath,
    build: options.build || info.inferredBuildCommand,
    requiredEnv,
    command: wrangler.command,
    args
  };
}

function printDeployPlan(plan) {
  console.log(`Detected mode: ${plan.mode}`);
  console.log(`Project: ${plan.projectDir}`);
  console.log(`Wrangler config: ${plan.configPath || "not found"}`);
  console.log(`Required env: ${plan.requiredEnv.join(", ")}`);
  if (plan.build) {
    console.log(`Build command: ${plan.build}`);
  }
  console.log("Reminder: live deployment requires explicit confirmation and valid Cloudflare credentials.");
  console.log(`Deploy command: ${formatCommand(plan.command, plan.args)}`);
}

function spawnCommand(command, args, cwd, useShell = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: useShell
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`command failed with exit code ${code}`));
    });
    child.on("error", reject);
  });
}

async function ensureEnvVars(requiredEnv) {
  const missing = requiredEnv.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    fail(
      `missing required environment variables: ${missing.join(", ")}.\n` +
        `Set them before live deployment. Example:\n` +
        `  export CLOUDFLARE_API_TOKEN="cfut_..."\n` +
        `  export CLOUDFLARE_ACCOUNT_ID="your-account-id"`
    );
  }
}

function buildGitHubAction(plan) {
  if (plan.mode === "pages") {
    const deployArgs = plan.args.join(" ");
    return `name: Deploy to Cloudflare Pages

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Install dependencies
        run: npm install
${plan.build ? `      - name: Build\n        run: ${plan.build}\n` : ""}      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: ${deployArgs}
          gitHubToken: \${{ secrets.GITHUB_TOKEN }}
`;
  }

  const deployArgs = plan.args.join(" ");
  return `name: Deploy to Cloudflare Workers

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Install dependencies
        run: npm install
${plan.build ? `      - name: Build\n        run: ${plan.build}\n` : ""}      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: ${deployArgs}
          gitHubToken: \${{ secrets.GITHUB_TOKEN }}
`;
}

async function writeFileIfRequested(outputPath, content, projectDir) {
  if (!outputPath) {
    console.log(content);
    return;
  }
  const resolved = path.resolve(projectDir, outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content);
  console.log(`Wrote ${resolved}`);
}

function getCompatibilityDate(options, info) {
  return options.compatibilityDate || info.configMeta.compatibilityDate || new Date().toISOString().slice(0, 10);
}

function buildWranglerJsonc(projectName, assetsDir, compatibilityDate) {
  return `{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": ${JSON.stringify(projectName)},
  "compatibility_date": ${JSON.stringify(compatibilityDate)},
  "pages_build_output_dir": ${JSON.stringify(assetsDir)}
}
`;
}

function upsertTopLevelToml(content, key, value) {
  const pattern = new RegExp(`^${key}\\s*=.*$`, "m");
  const line = `${key} = "${value}"`;
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  return `${content.trimEnd()}\n${line}\n`;
}

async function writeWranglerConfig(info, bootstrap) {
  const configPath = info.configPath || path.join(info.projectDir, "wrangler.jsonc");
  const extension = path.extname(configPath).toLowerCase();

  if (!info.configPath || extension === ".json" || extension === ".jsonc") {
    let output;
    if (info.configPath) {
      const existing = JSON.parse(stripJsonComments(await fs.readFile(configPath, "utf8")));
      existing.$schema = existing.$schema || "./node_modules/wrangler/config-schema.json";
      existing.name = bootstrap.projectName;
      existing.compatibility_date = bootstrap.compatibilityDate;
      existing.pages_build_output_dir = bootstrap.assetsDir;
      output = `${JSON.stringify(existing, null, 2)}\n`;
    } else {
      output = buildWranglerJsonc(bootstrap.projectName, bootstrap.assetsDir, bootstrap.compatibilityDate);
    }
    await fs.writeFile(configPath, output);
    return configPath;
  }

  if (extension === ".toml") {
    let content = await fs.readFile(configPath, "utf8");
    content = upsertTopLevelToml(content, "name", bootstrap.projectName);
    content = upsertTopLevelToml(content, "compatibility_date", bootstrap.compatibilityDate);
    content = upsertTopLevelToml(content, "pages_build_output_dir", bootstrap.assetsDir);
    await fs.writeFile(configPath, content);
    return configPath;
  }

  fail(`unsupported Wrangler config type for auto-update: ${configPath}`);
}

async function updatePackageScripts(info, bootstrap) {
  if (!info.packageJson) {
    return "";
  }

  const packageJson = { ...info.packageJson, scripts: { ...(info.packageJson.scripts || {}) } };
  packageJson.scripts["cf:pages:deploy"] = `wrangler pages deploy ${bootstrap.assetsDir} --project-name ${bootstrap.projectName}`;
  packageJson.scripts["cf:pages:dev"] = `wrangler pages dev ${bootstrap.assetsDir}`;
  await fs.writeFile(info.packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  return info.packageJsonPath;
}

function buildBootstrapWarnings(info, bootstrap) {
  const warnings = [];
  if (!bootstrap.buildCommand) {
    warnings.push("No build command was inferred. Set one manually if this project must build before deploy.");
  }
  if (info.framework === "next") {
    warnings.push("Next.js requires static export for plain Pages uploads. Confirm the project uses output: 'export' if this is a static site.");
  }
  if (bootstrap.assetsDir === "public") {
    warnings.push("The inferred assets directory is public/. Confirm that this is a built output directory and not just source assets.");
  }
  return warnings;
}

function buildPagesBootstrap(info, options) {
  const projectName =
    options.pagesProject ||
    info.configMeta.name ||
    info.packageJson?.name ||
    path.basename(info.projectDir);
  const assetsDir = options.assets || info.defaultAssetsDir;
  const buildCommand = options.build || info.inferredBuildCommand;
  const compatibilityDate = getCompatibilityDate(options, info);
  const deployPlan = {
    mode: "pages",
    projectDir: info.projectDir,
    configPath: info.configPath || path.join(info.projectDir, "wrangler.jsonc"),
    build: buildCommand,
    requiredEnv: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    command: "npx",
    args: ["wrangler", "pages", "deploy", assetsDir, "--project-name", projectName]
  };
  const workflow = buildGitHubAction(deployPlan);

  return {
    framework: info.framework,
    projectName,
    assetsDir,
    buildCommand,
    compatibilityDate,
    workflow,
    deployPlan,
    warnings: buildBootstrapWarnings(info, {
      projectName,
      assetsDir,
      buildCommand,
      compatibilityDate
    })
  };
}

function printBootstrapPlan(info, bootstrap) {
  console.log(`Project: ${info.projectDir}`);
  console.log(`Frontend framework: ${bootstrap.framework}`);
  console.log(`Pages project name: ${bootstrap.projectName}`);
  console.log(`Build command: ${bootstrap.buildCommand || "not inferred"}`);
  console.log(`Build output directory: ${bootstrap.assetsDir || "not inferred"}`);
  console.log(`Wrangler config target: ${bootstrap.deployPlan.configPath}`);
  console.log(`Deploy command: ${formatCommand(bootstrap.deployPlan.command, bootstrap.deployPlan.args)}`);
  if (bootstrap.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of bootstrap.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

async function applyBootstrap(info, bootstrap, options) {
  if (!bootstrap.assetsDir) {
    fail("Cannot bootstrap Pages config without an inferred or explicit assets directory.");
  }

  const written = [];
  written.push(await writeWranglerConfig(info, bootstrap));
  const packageJsonPath = await updatePackageScripts(info, bootstrap);
  if (packageJsonPath) {
    written.push(packageJsonPath);
  }
  const workflowTarget = options.write || ".github/workflows/cloudflare-pages.yml";
  const workflowPath = path.resolve(info.projectDir, workflowTarget);
  await fs.mkdir(path.dirname(workflowPath), { recursive: true });
  await fs.writeFile(workflowPath, bootstrap.workflow);
  written.push(workflowPath);
  return written;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  switch (options.command) {
    case "detect": {
      const info = await inspectProject(options.projectDir, options);
      printInspection(info);
      return;
    }
    case "verify-token": {
      await verifyToken();
      return;
    }
    case "deploy": {
      const info = await inspectProject(options.projectDir, options);
      const plan = await buildDeployPlan(info, options);
      printDeployPlan(plan);
      if (!options.run) {
        console.log("Plan only. Re-run with --run to execute the deployment.");
        return;
      }

      await ensureEnvVars(plan.requiredEnv);
      console.log("Reminder: this will perform a live Cloudflare deployment.");
      if (plan.build) {
        console.log(`Running build: ${plan.build}`);
        await spawnCommand(plan.build, [], info.projectDir, true);
      }
      await spawnCommand(plan.command, plan.args, info.projectDir);
      return;
    }
    case "github-action": {
      const info = await inspectProject(options.projectDir, options);
      const plan = await buildDeployPlan(info, options);
      const workflow = buildGitHubAction(plan);
      await writeFileIfRequested(options.write, workflow, info.projectDir);
      return;
    }
    case "bootstrap-pages": {
      const info = await inspectProject(options.projectDir, { ...options, mode: "pages" });
      const bootstrap = buildPagesBootstrap(info, options);
      printBootstrapPlan(info, bootstrap);
      if (!options.apply) {
        console.log("Plan only. Re-run with --apply to write wrangler config, package scripts, and a GitHub Actions workflow.");
        return;
      }
      const written = await applyBootstrap(info, bootstrap, options);
      console.log("Updated files:");
      for (const filePath of written) {
        console.log(`- ${filePath}`);
      }
      return;
    }
    default:
      fail(`unknown command: ${options.command}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
