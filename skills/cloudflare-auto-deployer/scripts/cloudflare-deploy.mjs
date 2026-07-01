#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_BUILD_DIRS = ["dist", "build", "out", "public"];

const HELP_TEXT = `Cloudflare deployment helper

Usage:
  node scripts/cloudflare-deploy.mjs detect <project-dir> [options]
  node scripts/cloudflare-deploy.mjs verify-token
  node scripts/cloudflare-deploy.mjs deploy <project-dir> [options]
  node scripts/cloudflare-deploy.mjs github-action <project-dir> [options]

Examples:
  node scripts/cloudflare-deploy.mjs detect ../my-project
  node scripts/cloudflare-deploy.mjs verify-token
  node scripts/cloudflare-deploy.mjs deploy ../my-project
  node scripts/cloudflare-deploy.mjs deploy ../my-project --mode pages --pages-project cms-psd --assets dist
  node scripts/cloudflare-deploy.mjs deploy ../my-project --mode workers --env production --run
  node scripts/cloudflare-deploy.mjs github-action ../my-project --write .github/workflows/cloudflare-deploy.yml

Options:
  --mode <auto|pages|workers>    Override deployment type detection
  --config <path>                Explicit Wrangler config path
  --build <command>              Build command to run before --run deploy
  --run                          Execute the deployment instead of only printing the plan
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
    write: "",
    help: false
  };

  if (argv.length === 0 || argv[0] === "--help") {
    options.help = true;
    return options;
  }

  options.command = argv[0] || "";
  let index = 1;
  if (["detect", "deploy", "github-action"].includes(options.command)) {
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
      assetsDirectory:
        json.assets && typeof json.assets.directory === "string" ? json.assets.directory : "",
      raw: json
    };
  }

  if (extension !== ".toml") {
    return { name: "", pagesBuildOutputDir: "", main: "", assetsDirectory: "", raw: {} };
  }

  let currentSection = "";
  const result = { name: "", pagesBuildOutputDir: "", main: "", assetsDirectory: "", raw: {} };
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

async function findDefaultAssetsDir(projectDir, configMeta) {
  const candidates = [];
  if (configMeta.pagesBuildOutputDir) {
    candidates.push(configMeta.pagesBuildOutputDir);
  }
  if (configMeta.assetsDirectory) {
    candidates.push(configMeta.assetsDirectory);
  }
  candidates.push(...DEFAULT_BUILD_DIRS);

  for (const candidate of candidates) {
    const resolved = path.resolve(projectDir, candidate);
    if ((await pathKind(resolved)) === "directory") {
      return candidate;
    }
  }
  return "";
}

async function detectMode(projectDir, configMeta, forcedMode) {
  if (forcedMode && forcedMode !== "auto") {
    return forcedMode;
  }

  if (configMeta.pagesBuildOutputDir) {
    return "pages";
  }
  if (configMeta.main || configMeta.assetsDirectory || configMeta.name) {
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
    : { name: "", pagesBuildOutputDir: "", main: "", assetsDirectory: "", raw: {} };
  const mode = await detectMode(resolvedProjectDir, configMeta, options.mode);
  const defaultAssetsDir = await findDefaultAssetsDir(resolvedProjectDir, configMeta);

  return {
    projectDir: resolvedProjectDir,
    configPath,
    configMeta,
    mode,
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
  console.log(`Wrangler config: ${info.configPath || "not found"}`);
  console.log(`Config name: ${info.configMeta.name || "not set"}`);
  console.log(`Pages build output dir: ${info.configMeta.pagesBuildOutputDir || "not set"}`);
  console.log(`Worker entry: ${info.configMeta.main || "not set"}`);
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
    const projectName = options.pagesProject || info.configMeta.name;
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
    build: options.build,
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
      if (options.build) {
        console.log(`Running build: ${options.build}`);
        await spawnCommand(options.build, [], info.projectDir, true);
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
    default:
      fail(`unknown command: ${options.command}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
