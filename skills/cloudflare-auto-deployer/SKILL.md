---
name: cloudflare-auto-deployer
description: Detect, prepare, and run Cloudflare Pages or Workers deployments with Wrangler. Use when Codex needs to inspect a project for `wrangler.toml` or `wrangler.jsonc`, determine whether it targets Cloudflare Pages or Cloudflare Workers, verify `CLOUDFLARE_API_TOKEN` access, generate GitHub Actions deployment workflows, or perform a guarded production deployment with explicit user confirmation.
---

# Cloudflare Auto Deployer

Use this skill to automate Cloudflare deployment workflows without relying on dashboard clicks.

Default goals:
- detect whether a project should deploy as Cloudflare Pages or Cloudflare Workers
- prefer official Wrangler commands over browser automation
- verify token presence before any live deploy
- plan first, then deploy only after explicit confirmation for production-facing changes
- keep deployment commands copy-pasteable and CI-friendly

## Quick Start

1. Ensure the user has a Cloudflare API token and, for Pages CI-style deploys, an account ID.
2. Install dependencies the first time:

```bash
cd skills/cloudflare-auto-deployer
npm install
```

3. Inspect a project:

```bash
node scripts/cloudflare-deploy.mjs detect /path/to/project
```

4. Verify the token:

```bash
export CLOUDFLARE_API_TOKEN="cfut_..."
node scripts/cloudflare-deploy.mjs verify-token
```

5. Print a deployment plan without shipping anything:

```bash
node scripts/cloudflare-deploy.mjs deploy /path/to/project
node scripts/cloudflare-deploy.mjs deploy /path/to/project --mode pages --pages-project cms-psd --assets dist
node scripts/cloudflare-deploy.mjs deploy /path/to/project --mode workers --env production
```

6. Print a GitHub Actions workflow:

```bash
node scripts/cloudflare-deploy.mjs github-action /path/to/project
```

Read [references/cloudflare-auth-and-permissions.md](references/cloudflare-auth-and-permissions.md) before guiding token setup or account scoping. Read [references/deployment-modes.md](references/deployment-modes.md) when detection is ambiguous or the user has both Pages and Workers projects.

## Workflow

### 0. Confirm deployment risk

- Before any live deployment, tell the user whether the target looks like Pages or Workers.
- Explain that `--run` performs a live Cloudflare deploy.
- For production domains, ask for explicit confirmation before running the deploy command.
- Prefer a plan-only run first. The helper prints commands by default and only deploys when `--run` is present.

### 1. Inspect the project

- Look for `wrangler.toml`, `wrangler.jsonc`, or `wrangler.json`.
- If `pages_build_output_dir` is present, treat the project as Pages unless the user explicitly overrides the mode.
- If `main`, `assets`, or standard Worker bindings are present, treat the project as Workers.
- If the repo contains both a Worker and Pages output, ask which target should be deployed before executing anything live.

### 2. Validate credentials

- Require `CLOUDFLARE_API_TOKEN` for live deploys and token verification.
- For Pages direct-upload flows, prefer setting `CLOUDFLARE_ACCOUNT_ID` too because Cloudflare's CI examples rely on it.
- Never ask the user to paste a token into source control or workflow YAML directly.
- If a token is missing, stop and show the exact `export CLOUDFLARE_API_TOKEN="..."` command.

### 3. Plan the deploy command

- Use the helper script to print the detected mode, config path, likely asset directory, and exact Wrangler command.
- For Pages:
  - prefer `npx wrangler pages deploy <DIRECTORY> --project-name=<PROJECT_NAME>`
  - include branch and commit metadata only when the user asks
- For Workers:
  - prefer `npx wrangler deploy`
  - pass `--env`, `--keep-vars`, or `--secrets-file` only when those behaviors are explicitly desired

### 4. Build only when needed

- If the project requires a build step, pass `--build "<command>"` to the helper so the build runs before deployment.
- Keep build and deploy in one controlled flow only when the user wants end-to-end automation.
- If the build output directory is unclear, stop after the plan and ask for the correct output folder instead of guessing during a live deploy.

### 5. Generate CI when useful

- Use the `github-action` subcommand to print a GitHub Actions workflow based on the detected mode.
- Keep Cloudflare secrets in GitHub Secrets as `CLOUDFLARE_API_TOKEN` and, for Pages, `CLOUDFLARE_ACCOUNT_ID`.
- Do not commit live credentials into the repo.

## CLI Contract

Run:

```bash
node scripts/cloudflare-deploy.mjs <detect|verify-token|deploy|github-action> [project-dir] [options]
```

Supported subcommands:
- `detect <project-dir>`: inspect config and infer Pages vs Workers
- `verify-token`: call Cloudflare's token verification endpoint
- `deploy <project-dir>`: print or run a deploy command
- `github-action <project-dir>`: print a GitHub Actions workflow

Common deploy options:
- `--mode <auto|pages|workers>`: override detection
- `--config <path>`: explicit Wrangler config path
- `--build <command>`: build before deploy when `--run` is present
- `--run`: execute the deploy instead of only printing the plan

Pages deploy options:
- `--pages-project <name>`
- `--assets <dir>`
- `--branch <name>`
- `--commit-hash <sha>`
- `--commit-message <message>`
- `--commit-dirty`

Workers deploy options:
- `--env <name>`
- `--keep-vars`
- `--secrets-file <path>`
- `--route <pattern>` repeatable
- `--domain <hostname>` repeatable
- `--wrangler-dry-run`

GitHub Actions options:
- `--write <path>`: write the generated workflow instead of printing it

## Troubleshooting

- Missing token: export `CLOUDFLARE_API_TOKEN` and retry.
- Pages deploy missing account context: export `CLOUDFLARE_ACCOUNT_ID`.
- Wrong mode detected: rerun with `--mode pages` or `--mode workers`.
- Multiple Cloudflare targets in one repo: plan each target separately and avoid assuming one deploy updates all services.
- Dashboard drift: for Workers, use `--keep-vars` if the user intentionally manages non-secret vars in the dashboard and wants to avoid overwriting them.
- Token scope errors: reduce or widen permissions based on the target product, then verify again.

## References

- Auth and token guidance: [references/cloudflare-auth-and-permissions.md](references/cloudflare-auth-and-permissions.md)
- Deployment mode selection: [references/deployment-modes.md](references/deployment-modes.md)
