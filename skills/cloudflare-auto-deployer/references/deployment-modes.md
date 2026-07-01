# Deployment Modes

Primary sources:
- [Wrangler Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
- [Wrangler Pages commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/)

Use this file when a repo has multiple Cloudflare targets or when the deploy mode is unclear.

## Pages

Prefer Pages mode when one or more of these are true:
- `pages_build_output_dir` exists in Wrangler config
- the repo contains a Pages-style `functions/` directory
- the target is a static site or prebuilt frontend bundle
- the live target is a `*.pages.dev` project

Official direct-upload command:

```bash
npx wrangler pages deploy <DIRECTORY> --project-name=<PROJECT_NAME>
```

Useful Pages deploy flags from the official commands reference:
- `--branch`
- `--commit-hash`
- `--commit-message`
- `--commit-dirty`

## Workers

Prefer Workers mode when one or more of these are true:
- the Wrangler config uses `main`
- the project exposes Worker bindings, routes, or custom domains
- the target is a `*.workers.dev` service or a custom domain attached to a Worker
- the project uses Worker assets or Worker runtime APIs

Official deploy command:

```bash
npx wrangler deploy
```

Useful Workers deploy flags from the official commands reference:
- `--env`
- `--keep-vars`
- `--secrets-file`
- `--route`
- `--domain`
- `--dry-run`

## Mixed repos

Some repos contain both:
- a Pages frontend
- one or more Workers

In that case:
- do not assume one deploy updates every Cloudflare service
- deploy each target separately
- print the exact target name, project directory, and mode before running live deployment
