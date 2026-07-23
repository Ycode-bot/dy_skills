# dy_skills

Reusable, repo-aware AI skills for engineering workflows.

These skills select the narrowest workflow required by the request. Repository-aware tasks may produce:

1. Findings
2. Action plan
3. Patch draft
4. Verification checklist

## Install

Use the exact repo path:

```bash
npx skills add Ycode-bot/dy_skills@i18n-structure-refactor -y -g
npx skills add Ycode-bot/dy_skills@activity-cms-psd -y -g
npx skills add Ycode-bot/dy_skills@workplace-viral-copywriter -y -g
npx skills add Ycode-bot/dy_skills@tinify-image-compressor -y -g
npx skills add Ycode-bot/dy_skills@cloudflare-auto-deployer -y -g
npx skills add Ycode-bot/dy_skills@project-tracking-integrator -y -g
```

Install all at once:

```bash
npx skills add Ycode-bot/dy_skills@i18n-structure-refactor -y -g && \
npx skills add Ycode-bot/dy_skills@activity-cms-psd -y -g && \
npx skills add Ycode-bot/dy_skills@workplace-viral-copywriter -y -g && \
npx skills add Ycode-bot/dy_skills@tinify-image-compressor -y -g && \
npx skills add Ycode-bot/dy_skills@cloudflare-auto-deployer -y -g && \
npx skills add Ycode-bot/dy_skills@project-tracking-integrator -y -g
```

Verify installation:

```bash
ls ~/.agents/skills
```

## Included Skills

- `i18n-structure-refactor`: Detects i18n patterns and generates migration/refactor plans.
- `activity-cms-psd`: Converts annotated activity PSDs into activityincms import JSON, sliced assets, theme notes, and UI/operator handoff docs.
- `workplace-viral-copywriter`: Generates story-first Chinese social copy for a capybara IP WeChat/Xiaohongshu account, covering life and workplace scenes with readable mini-stories, paired comic captions, cover hooks, interaction questions, and hashtags.
- `tinify-image-compressor`: Compresses, resizes, converts, and metadata-preserves local image batches with Tinify's Node.js API while keeping originals untouched by default.
- `cloudflare-auto-deployer`: Detects whether a repo targets Cloudflare Pages or Workers, verifies credentials, prints safe Wrangler deployment plans, and can generate GitHub Actions workflows.
- `project-tracking-integrator`: Discovers or establishes a multi-platform tracking system, implements data-team event contracts, and verifies source, runtime payloads, and platform ingestion.

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

`project-tracking-integrator` does not check for updates during ordinary tracking work. When the user explicitly asks to update or check the Skill, it reuses a fresh local result for 24 hours, then checks the latest commit for that Skill path and verifies the installed-tree digest. It downloads only when the revision changed, trusted state is missing, or installed files drifted. Installed copies update atomically; Git working trees are never overwritten by default.

Run an explicit cached update check:

```bash
python3 ~/.agents/skills/project-tracking-integrator/scripts/self_update.py \
  --dest ~/.agents/skills/project-tracking-integrator
```

Force an immediate re-check only when required:

```bash
python3 ~/.agents/skills/project-tracking-integrator/scripts/self_update.py \
  --dest ~/.agents/skills/project-tracking-integrator \
  --force
```

Change the explicit-check cache interval:

```bash
export PROJECT_TRACKING_INTEGRATOR_UPDATE_INTERVAL_HOURS=24
```

Browser-driven tracking acceptance requires the Codex `Browser` plugin (`browser:control-in-app-browser`). If it is unavailable, install or enable **Browser (OpenAI bundled)** from the Codex plugin panel and reopen the task before running `browser-verify`.

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
