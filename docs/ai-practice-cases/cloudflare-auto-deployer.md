# AI 实践案例说明｜Cloudflare 自动部署 Skill

> 申报定位建议：团队方法复用。若暂时无法提供他人真实复用记录，应改选“岗位场景应用”，不要仅凭已经创建 Skill 就申报团队复用。

## 1. 案例名称

使用 AI 沉淀 Cloudflare 自动部署 Skill，解决 Pages 与 Workers 项目识别、部署配置和生产发布风险控制问题。

## 2. 真实场景与原问题

- **适用岗位/团队：** 前端研发、全栈研发、DevOps、需要维护 Cloudflare Pages 或 Workers 项目的研发团队。
- **具体任务：** 接收一个已有或新建项目，判断其部署目标是 Cloudflare Pages 还是 Workers；识别配置文件、构建命令和产物目录；生成 Wrangler 部署命令及 GitHub Actions 工作流；在获得明确确认后执行真实部署。
- **原来的问题：**
  - 不同项目使用 `wrangler.toml`、`wrangler.jsonc` 或 `wrangler.json`，Pages 与 Workers 的配置特征和命令不同，人工判断容易选错模式。
  - 新前端项目需要重复确认构建命令、输出目录、项目名称、兼容日期和 CI 配置，操作分散且容易遗漏。
  - Cloudflare Token、Account ID、生产域名和 GitHub Secrets 涉及安全风险，手工操作时可能误写入代码、日志或工作流。
  - 缺少统一的“先检测、再规划、后执行”流程，直接运行部署命令可能造成误发生产环境。
- **使用频率：** 固定流程；适用于项目首次接入 Cloudflare、部署配置变更、CI 工作流建设及日常 Pages/Workers 发布。实际月均使用次数为 **[待补充真实次数]**。

## 3. AI 介入方式

- **使用工具：** Codex、Node.js、Cloudflare 官方 Wrangler CLI、GitHub Actions。
- **输入材料：** 目标项目代码、`package.json`、Wrangler 配置、框架配置、构建脚本、预期部署环境及用户明确提供的 Pages/Workers 目标信息。
- **核心 Prompt / 模板：**

  ```text
  请扫描目标项目的 Cloudflare 和构建配置，判断它应部署为 Pages 还是 Workers。
  先输出检测依据、配置路径、构建命令、产物目录、凭证要求和部署风险，
  再生成可复制的 Wrangler 命令及 GitHub Actions 工作流。
  默认只做计划，不执行真实部署；只有在我明确确认生产目标后才能运行。
  不得输出、提交或写入任何 Cloudflare Token。
  ```

- **AI 负责的环节：** 扫描配置、判断部署模式、推断前端框架及构建产物、生成部署计划、生成 Wrangler 命令、生成 GitHub Actions 工作流、检查凭证是否存在、提示最小权限和安全风险。
- **人工判断/修改/复核的环节：** 确认 Cloudflare 账号和目标项目、核对产物目录、确认生产域名和发布环境、创建并保管 API Token、批准真实部署、验证部署后的页面或 Worker 行为。
- **人工判断的复杂环节：** 同一仓库同时包含 Pages 与 Workers、构建产物目录不明确、Dashboard 中存在未入库变量、需要保留线上变量或涉及生产域名切换时，必须由人工决定目标和风险边界。

AI 介入后形成了一个统一 CLI：

```bash
node scripts/cloudflare-deploy.mjs detect /path/to/project
node scripts/cloudflare-deploy.mjs deploy /path/to/project
node scripts/cloudflare-deploy.mjs github-action /path/to/project
node scripts/cloudflare-deploy.mjs bootstrap-pages /path/to/project
```

真实发布必须显式添加 `--run`；默认命令只生成计划，不会直接改变线上环境。

## 4. 本人贡献与参与程度

- **本人角色：** 建议按真实情况选择“发起人 / 主导者 / 主要执行者”。如本人只使用了现成 Skill，应改为“使用者”。
- **本人具体完成的工作：**
  - 梳理 Pages 与 Workers 的识别规则、部署参数和安全边界。
  - 将项目检测、Token 验证、部署规划、CI 生成和 Pages 初始化统一为一套 CLI。
  - 明确生产发布必须人工确认，凭证只允许通过环境变量或 GitHub Secrets 管理。
  - 编写 Skill 使用说明、鉴权教程、部署模式说明和故障排查规则。
  - 根据真实项目验证结果持续调整模式识别和输出内容。
- **本人负责的关键判断、设计或推进环节：** 决定“默认只规划、不直接发布”的安全模型；确定 Pages/Workers 检测优先级；定义缺少 Token、目标冲突或构建产物不明确时必须停止的条件。
- **AI 负责的部分：** 辅助归纳 Cloudflare 配置模式、生成和检查 Node.js CLI、整理 SOP、产生部署命令与 GitHub Actions 草稿、补全异常场景检查清单。
- **其他成员贡献的部分：** **[待补充成员姓名/角色及其试用、代码评审、部署验证或反馈内容]**。
- **本人对推广、培训、落地、维护的贡献：** **[待补充，例如：在团队群发布使用说明、演示一次 Pages 接入、收集两位成员反馈、维护 Skill 版本]**。

## 5. 产出与效果

- **最终产出：**
  - 可复用的 Cloudflare 自动部署 Skill。
  - Node.js 自动化 CLI，支持 `detect`、`verify-token`、`deploy`、`github-action` 和 `bootstrap-pages`。
  - Cloudflare 鉴权与最小权限说明。
  - Pages/Workers 部署模式判断规则。
  - 生产部署确认、凭证保护和故障排查机制。
- **节省时间/提升质量：** 将原本分散的配置排查、命令查询、CI 编写和风险检查合并为一次标准化流程。请在提交前补充真实对比，例如：单个项目首次接入由 **[原耗时]** 缩短至 **[现耗时]**，减少 **[比例]**；配置返工由 **[次数]** 降至 **[次数]**。
- **是否已经多次使用：** 仓库能够证明 Skill 和 CLI 已完成沉淀，但不能单独证明真实项目使用次数。请补充 **[项目名称或脱敏代号、使用日期、执行结果]**。
- **是否被他人复用：** **[待补充复用者、复用日期、使用项目、反馈截图或代码记录]**。没有该证据时，不应申报“团队方法复用”。
- **是否被纳入复用：** 当前已纳入 Git 仓库统一管理；如已进入团队 Skill 库、研发 SOP 或项目模板，请补充对应链接。

## 6. 可复用材料

- [GitHub 仓库](https://github.com/Ycode-bot/dy_skills)
- [Skill 使用说明](https://github.com/Ycode-bot/dy_skills/blob/main/skills/cloudflare-auto-deployer/SKILL.md)
- [自动部署 CLI](https://github.com/Ycode-bot/dy_skills/blob/main/skills/cloudflare-auto-deployer/scripts/cloudflare-deploy.mjs)
- [Cloudflare 鉴权与权限说明](https://github.com/Ycode-bot/dy_skills/blob/main/skills/cloudflare-auto-deployer/references/cloudflare-auth-and-permissions.md)
- [Pages 与 Workers 模式说明](https://github.com/Ycode-bot/dy_skills/blob/main/skills/cloudflare-auto-deployer/references/deployment-modes.md)
- [依赖与运行环境](https://github.com/Ycode-bot/dy_skills/blob/main/skills/cloudflare-auto-deployer/package.json)
- Git 提交记录：`1b02927 Add Cloudflare auto deployer skill`、`ff00fd4 Enhance Cloudflare deployer bootstrap and setup`。

复用人员应先执行计划模式，并自行配置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。禁止把真实 Token 写入仓库、截图或申报文档。

## 7. 证明材料

### 7.1 个人使用/岗位场景证明

建议提交以下真实材料：

- `detect` 自动识别项目类型的终端截图。
- 生成部署计划、Wrangler 命令和 GitHub Actions 工作流的截图。
- `bootstrap-pages --apply` 产生的 Git Diff。
- GitHub Actions 成功运行记录或 Cloudflare 部署结果。
- 使用前后的耗时对比、错误数量或返工记录。
- Git 提交记录和 Skill 文件链接。

材料链接：**[待补充在线文档、截图或代码提交 URL]**。

### 7.2 团队方法复用证明

如申报“团队方法复用”，至少提交：

- 团队共享文档、模板或 SOP 链接。
- 团队成员实际使用截图或代码提交记录。
- 群内推广、培训或演示记录。
- 他人使用后的反馈、复用项目及结果。
- 可复用人员名单或适用范围说明。

材料链接：**[待补充团队复用证据 URL]**。

### 提交前检查

- 所有 Cloudflare Token、GitHub Secrets、账号信息和内部域名均已脱敏。
- 已补充至少一次真实使用记录和可核验结果。
- 若选择“团队方法复用”，已提供他人实际使用证据。
- 没有把脚本完成度误写成线上部署效果。
