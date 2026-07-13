# dy_skills

Reusable, repo-aware AI skills for engineering workflows.

These skills are designed to **scan a codebase first**, then produce:
1. Findings
2. Action plan
3. Patch draft
4. Verification checklist

## Install

Use the exact repo path:

```bash
npx skills add Ycode-bot/dy_skills@i18n-structure-refactor -y -g
npx skills add Ycode-bot/dy_skills@framework-page-standardizer -y -g
npx skills add Ycode-bot/dy_skills@incident-runbook-from-code -y -g
npx skills add Ycode-bot/dy_skills@content-pipeline-migrator -y -g
npx skills add Ycode-bot/dy_skills@multi-repo-sync-guard -y -g
npx skills add Ycode-bot/dy_skills@activity-cms-psd -y -g
npx skills add Ycode-bot/dy_skills@workplace-viral-copywriter -y -g
npx skills add Ycode-bot/dy_skills@tinify-image-compressor -y -g
npx skills add Ycode-bot/dy_skills@cloudflare-auto-deployer -y -g
```

Install all at once:

```bash
npx skills add Ycode-bot/dy_skills@i18n-structure-refactor -y -g && \
npx skills add Ycode-bot/dy_skills@framework-page-standardizer -y -g && \
npx skills add Ycode-bot/dy_skills@incident-runbook-from-code -y -g && \
npx skills add Ycode-bot/dy_skills@content-pipeline-migrator -y -g && \
npx skills add Ycode-bot/dy_skills@multi-repo-sync-guard -y -g && \
npx skills add Ycode-bot/dy_skills@activity-cms-psd -y -g && \
npx skills add Ycode-bot/dy_skills@workplace-viral-copywriter -y -g && \
npx skills add Ycode-bot/dy_skills@tinify-image-compressor -y -g && \
npx skills add Ycode-bot/dy_skills@cloudflare-auto-deployer -y -g
```

Verify installation:

```bash
ls ~/.agents/skills
```

## Included Skills

- `i18n-structure-refactor`: Detects i18n patterns and generates migration/refactor plans.
- `framework-page-standardizer`: Standardizes page-level patterns (routing metadata, SEO, i18n, data-loading shape).
- `incident-runbook-from-code`: Produces production runbooks from code/logs/docs.
- `content-pipeline-migrator`: Scans Markdown/content pipelines and proposes batch migrations.
- `multi-repo-sync-guard`: Detects cross-repo duplicated modules and generates sync checklists.
- `activity-cms-psd`: Converts annotated activity PSDs into activityincms import JSON, sliced assets, theme notes, and UI/operator handoff docs.
- `workplace-viral-copywriter`: Generates story-first Chinese social copy for a capybara IP WeChat/Xiaohongshu account, covering life and workplace scenes with readable mini-stories, paired comic captions, cover hooks, interaction questions, and hashtags.
- `tinify-image-compressor`: Compresses, resizes, converts, and metadata-preserves local image batches with Tinify's Node.js API while keeping originals untouched by default.
- `cloudflare-auto-deployer`: Detects whether a repo targets Cloudflare Pages or Workers, verifies credentials, prints safe Wrangler deployment plans, and can generate GitHub Actions workflows.

## Skill Dependencies

`activity-cms-psd` uses Python PSD parsing dependencies. The CLI installs them automatically on first run:

```bash
cd skills/activity-cms-psd
./activity-cms-psd "/path/to/activity.psd" --out "/path/to/activity-output"
```

On first run, it creates a local `.venv` and installs `Pillow`, `psd-tools[composite]`, and `tinify`. Adobe Photoshop is not required.

The `activity-cms-psd` CLI checks `Ycode-bot/dy_skills@activity-cms-psd` for updates each time it runs. If an update is available, it refreshes the installed skill files, preserves the local `.venv`, and restarts once. If the network is unavailable, it continues with the local version.

Disable auto-update for a run:

```bash
ACTIVITY_CMS_PSD_AUTO_UPDATE=0 ./activity-cms-psd "/path/to/activity.psd" --out "/path/to/activity-output"
```

Asset compression runs by default with Tinify. Configure the API key before generating packages:

```bash
export ACTIVITY_CMS_PSD_TINIFY_KEY="your-tinify-api-key"
```

Use `--no-compress` when you need to skip compression or avoid consuming Tinify quota:

```bash
./activity-cms-psd "/path/to/activity.psd" --out "/path/to/activity-output" --no-compress
```

`tinify-image-compressor` includes a Node.js helper for batch image optimization. Install dependencies once, export a Tinify API key, then run the helper against a file or directory:

```bash
cd skills/tinify-image-compressor
npm install
export TINIFY_API_KEY="your-tinify-api-key"
node scripts/compress-images.mjs ./input-images --out ./optimized-images --dry-run
node scripts/compress-images.mjs ./input-images --out ./optimized-images --convert webp --resize fit:1600x1600
```

`cloudflare-auto-deployer` includes a Node.js helper for Cloudflare Pages and Workers deployment planning. Install dependencies once, export Cloudflare credentials, then inspect or deploy a project:

```bash
cd skills/cloudflare-auto-deployer
npm install
export CLOUDFLARE_API_TOKEN="cfut_..."
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
node scripts/cloudflare-deploy.mjs detect /path/to/project
node scripts/cloudflare-deploy.mjs deploy /path/to/project
node scripts/cloudflare-deploy.mjs github-action /path/to/project
node scripts/cloudflare-deploy.mjs bootstrap-pages /path/to/frontend --apply
```

You can also install dependencies manually:

```bash
./install.sh
```

Default output:

```txt
assets/
cms-page-config.json
theme.json
theme.md
```

## Skill Contract

All skills in this repo should return these sections:

- `Scan Findings`
- `Implementation Plan`
- `Patch Draft`
- `Verification Checklist`

Default behavior is **analysis + patch draft only**. Do not mutate files unless explicitly requested.

## Versioning

- Start at `v0.1.0` as a public beta.
- Keep changes backward-compatible when possible.

## License

MIT
