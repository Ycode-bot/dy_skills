# Activity CMS PSD For Claude Code

Use this tool to convert annotated activity PSD files into activityincms delivery packages.

## Generate A Package

```bash
./activity-cms-psd "/path/to/activity.psd" --out "/path/to/activity-output"
```

On first run, the CLI creates a local `.venv` and installs `Pillow`, `psd-tools[composite]`, and `tinify`. Adobe Photoshop is not required.

Tinify compression runs by default when an API key is configured:

```bash
export ACTIVITY_CMS_PSD_TINIFY_KEY="your-tinify-api-key"
```

Use `--no-compress` to skip compression.

Default output contains only:

```txt
assets/
cms-page-config.json
theme.json
theme.md
```

Use `--debug` only when troubleshooting PSD parsing:

```bash
./activity-cms-psd "/path/to/activity.psd" --out "/path/to/activity-output" --debug
```

## Claude Code Guidance

- Do not hand-write the CMS JSON when this CLI can be used.
- Read `references/psd-annotation-guide.md` before interpreting PSD layer names.
- Treat `切图:` layers/groups as required assets.
- Treat `组件:` layers/groups as real activityincms components.
- Leave business IDs blank and keep todos in `cms-page-config.json`.
