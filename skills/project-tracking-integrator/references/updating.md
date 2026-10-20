# 按需更新

本文适用于从发布源下载或检查安装版本。用户要求修改本 skill 的规则、代码或修复已知问题时，直接编辑用户指定的源码目录并验证，不运行下载更新器覆盖本地修改；除非用户同时明确要求同步安装副本，否则不扩展修改位置。


Do not run the updater during ordinary tracking work. Do not mention update status, inspect `.update-state.json`, or contact GitHub unless the user explicitly asks to update, refresh, or check this Skill.

For an explicit update/check request, use the cached command by default:

```bash
python3 <skill-dir>/scripts/self_update.py --dest <skill-dir>
```

Only when the user explicitly says to force the update, bypass the cache, or re-download now, run:

```bash
python3 <skill-dir>/scripts/self_update.py --dest <skill-dir> --force
```

Do not run both commands in one invocation. If updating is the user's only request, report whether the Skill changed and stop. If the user also requested tracking work, continue after the update result.

Interpret the exit code as follows:

- `0`: already current, disabled, cached, or intentionally skipped; continue normally.
- `2`: the installed Skill changed, or `--check-only` found an update. After installation, re-read the updated `SKILL.md` and continue without running the updater again; after `--check-only`, report availability without claiming installation.
- `1`: the network or update failed; warn briefly and continue with the local version.

The updater stores non-secret timing, revision, and installed-tree digest state in `.update-state.json`. Explicit non-forced checks reuse a fresh result for 24 hours without contacting the network. When due, the updater first checks the latest Git commit that changed `skills/project-tracking-integrator`; it downloads the repository archive only when that revision differs, when no trusted local revision exists, or when installed files drift from their recorded digest. Failed checks use a one-hour retry cache. An explicit `--force` bypasses the cache and verifies installed-file integrity.

When a download is required, the updater validates the remote Skill, compares a complete file-tree digest, and replaces the installed directory atomically. It preserves local runtime directories, refuses to overwrite a Git working tree by default, and treats update failure as non-blocking.

Configure the explicit-check cache with `PROJECT_TRACKING_INTEGRATOR_UPDATE_INTERVAL_HOURS` and the failed-check retry delay with `PROJECT_TRACKING_INTEGRATOR_UPDATE_RETRY_HOURS`. Set `PROJECT_TRACKING_INTEGRATOR_FORCE_UPDATE=1` only as the environment-variable equivalent of an explicitly requested `--force`. Override the trusted source or branch only when explicitly requested with `PROJECT_TRACKING_INTEGRATOR_SKILL_SOURCE=owner/repo@project-tracking-integrator` or `PROJECT_TRACKING_INTEGRATOR_UPDATE_REF=<ref>`.
