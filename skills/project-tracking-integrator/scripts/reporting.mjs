import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const labels = {
    PASS: '检查通过', FAILED: '检查未通过', FAIL: '检查未通过', INVALID: '输入校验未通过',
    NEEDS_REVIEW: '需进一步确认', INCOMPLETE: '尚未完成', BLOCKED: '暂时无法继续',
    MISSING_IMPLEMENTATION: '未找到埋点实现', UNREACHABLE: '未找到有效调用点',
    NOT_SENT: '未观察到事件发送', NOT_FOUND: '未找到符合条件的数据', NOT_AVAILABLE: '当前无法获取此证据',
    COUNT_MISMATCH: '上报次数不符合要求', DUPLICATED: '上报次数超过要求', CONTRACT_MISMATCH: '实现或数据与埋点要求不一致',
    QUERY_FAILED: '数据查询失败', NOT_RUN: '尚未验证', NOT_REQUIRED: '本次无需验证',
    LOCAL_READY: '本地验收通过', QA_READY: '测试环境验收通过', PRODUCTION_VERIFIED: '生产环境验收通过', NOT_READY: '尚未达到验收条件',
    established: '已有可用体系', partial: '体系尚不完整', absent: '未发现体系', unknown: '尚未确定',
    local: '本地', qa: '测试环境', production: '生产环境', source: '源码', browser: '浏览器', runtime: '发送证据', ingestion: '平台数据',
};
export function statusLabel(status) { return labels[status] || '未知结果，需补充说明'; }
export function withChineseLabels(value) {
    if (Array.isArray(value)) return value.map(withChineseLabels);
    if (!value || typeof value !== 'object') return value;
    const output = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withChineseLabels(item)]));
    if (typeof value.status === 'string') output.statusText = statusLabel(value.status);
    return output;
}
export function issueDetails(issue, defaults = {}) {
    return {
        ...issue,
        message: issue.message || '此项尚缺少充分证据',
        location: issue.location || defaults.location || '见本事件的证据位置',
        impact: issue.impact || defaults.impact || '本项结论尚不能作为完整验收通过的依据',
        attempted: issue.attempted || defaults.attempted || '已检查当前阶段提供的证据',
        nextStep: issue.nextStep || defaults.nextStep || '补充相关证据，修正问题后重查本项',
    };
}
export function formatIssue(issue) {
    const item = issueDetails(issue);
    const fields = ['property', 'expected', 'actual'].filter(key => key in item).map(key => `${({ property: '字段', expected: '预期', actual: '实际' })[key]}：${JSON.stringify(item[key])}`).join('；');
    return `${translateDiagnostic(item.message)}${fields ? `；${fields}` : ''}；位置：${item.location}；影响：${item.impact}；已检查：${item.attempted}；下一步：${item.nextStep}`;
}
export function humanizeReport(text) {
    return String(text).replace(/\b(PASS|FAILED|FAIL|INVALID|NEEDS_REVIEW|INCOMPLETE|BLOCKED|MISSING_IMPLEMENTATION|UNREACHABLE|NOT_SENT|NOT_FOUND|NOT_AVAILABLE|COUNT_MISMATCH|DUPLICATED|CONTRACT_MISMATCH|QUERY_FAILED|NOT_RUN|NOT_REQUIRED|LOCAL_READY|QA_READY|PRODUCTION_VERIFIED|NOT_READY|established|partial|absent|unknown)\b/g, statusLabel);
}

// Translate diagnostics at the presentation boundary; machine contracts remain stable.
const diagnosticPhrases = [
    ['Sensors browser ingestion runner requires every covered event to be a required Sensors target:', '神策验收要求覆盖事件是必需的神策目标：'],
    ['Sensors browser ingestion runner cannot verify required', '神策验收无法验证其他必需平台：'],
    ['browser verification input is invalid:', '浏览器验收输入无效：'],
    ['refusing to write outside the marker-owned session:', '禁止向本次自有会话目录以外写入：'],
    ['session artifact parent must not be a symlink:', '会话产物父目录不能是符号链接：'],
    ['session artifact parent escapes the marker-owned session:', '会话产物父目录超出自有目录：'],
    ['session artifact target must be a regular file:', '会话产物必须是普通文件：'],
    ['session root must be a real directory before writing artifacts', '写入前会话根路径必须是真实目录'],
    ['temporary session artifact must remain a regular file', '临时产物必须保持为普通文件'],
    ['--session is not a marker-owned temporary session', '--session 不是本次工具创建的临时会话'],
    ['explicit mode requires --journey, --spec, and --browser-report together', '显式输入必须同时提供 --journey、--spec 和 --browser-report'],
    ['provide --session, --bundle, or explicit --journey/--spec/--browser-report', '请提供 --session、--bundle 或完整的 --journey/--spec/--browser-report'],
    ['choose exactly one source: --actual or --query', '必须选择一种数据来源：--actual 或 --query'],
    ['credentials file permissions are too broad; run:', '凭证文件权限过宽，请执行：'],
    ['query mode requires', '查询模式需要'],
    ['configure it in the shell without passing it on the command line', '请通过私有配置或环境变量设置，不要把密钥放入命令参数'],
    ['production journey requires a readable tracking contract before browser actions', '生产浏览器操作前必须提供可读取的埋点契约'],
    ['production journey is blocked because smokeSafe is not true for:', '以下生产事件未声明安全测试，暂停操作：'],
    ['uses an unstable positional CSS selector', '使用了不稳定的位置型 CSS 选择器'],
    ['must record at least one of role, name, href, or scope', '必须记录 role、name、href 或 scope 中至少一项'],
    ['must be fresh after the previous step executedAt', '必须在上一步 executedAt 后重新解析'],
    ['must preserve journey step order', '必须符合旅程步骤顺序'],
    ['must fall within report.triggerWindow', '必须位于 report.triggerWindow 内'],
    ['must equal the locator authorized by the journey', '必须等于旅程声明的定位信息'],
    ['must match the authorized role locator', '必须匹配旅程声明的角色定位'],
    ['must match the authorized href locator', '必须匹配旅程声明的链接定位'],
    ['must record the resolved locator', '必须记录实际解析使用的定位信息'],
    ['must contain exactly', '必须包含且仅包含'],
    ['must contain at least one', '必须至少包含一个'],
    ['must contain non-empty event ids', '必须包含非空事件标识'],
    ['must not contain duplicate event ids', '不能包含重复事件标识'],
    ['must not contain a cycle', '不能包含循环引用'],
    ['must not be before', '不能早于'], ['must not be earlier than', '不能早于'], ['must not be after', '不能晚于'],
    ['must not conflict', '不能冲突'], ['conflicts with the CLI value', '与命令行参数冲突'],
    ['cannot be combined with a fixed browser trigger window', '不能与固定浏览器触发窗口同时使用'],
    ['cannot be combined with', '不能同时使用'],
    ['is only supported with', '仅可配合使用'], ['are only supported with', '仅可配合使用'],
    ['must be a non-empty ISO-8601 timestamp', '必须是非空 ISO-8601 时间戳'],
    ['must be a valid ISO-8601 timestamp', '必须是有效 ISO-8601 时间戳'],
    ['must be a valid URL or relative URL', '必须是有效 URL 或相对 URL'],
    ['must be a valid URL', '必须是有效 URL'],
    ['must be a host or host:port without protocol, path, query, or wildcard', '必须是 host 或 host:port，不能包含协议、路径、查询或通配符'],
    ['must be a non-negative integer', '必须是非负整数'], ['must be a positive integer', '必须是正整数'],
    ['must be an integer of at least', '必须是整数且至少为'], ['must be an integer from', '必须是整数，范围从'],
    ['must be an integer between', '必须是整数，范围从'], ['must be an integer', '必须是整数'],
    ['must be a non-empty string', '必须是非空字符串'], ['must be a string or boolean', '必须是字符串或布尔值'],
    ['must be a string', '必须是字符串'], ['must be a boolean', '必须是布尔值'],
    ['must be a JSON object', '必须是 JSON 对象'], ['must be an object', '必须是对象'], ['must be an array of event ids', '必须是事件标识数组'], ['must be an array', '必须是数组'],
    ['must use lowercase letters, numbers, and hyphens', '必须使用小写字母、数字和连字符'],
    ['must be unique', '必须唯一'], ['is missing or invalid', '缺失或无效'], ['is invalid', '无效'], ['is unsupported', '不受支持'],
    ['is required', '为必填项'], ['requires a value', '缺少参数值'], ['is unknown', '尚未确定'],
    ['must equal', '必须等于'], ['must use', '必须使用'], ['must define', '必须定义'], ['must be at least', '至少为'], ['must be', '必须为'],
    ['does not cover required contract event id:', '未覆盖必需契约事件：'], ['covers unknown contract event id:', '覆盖了未定义的契约事件：'],
    ['is missing journey-covered event id:', '缺少旅程覆盖的事件：'],
    ['does not contain a required Sensors target', '没有必需的神策目标'],
    ['unknown option:', '未知参数：'], ['unknown argument:', '未知参数：'], ['missing value for', '缺少参数值：'],
    ['cannot read JSON report', '无法读取 JSON 报告'], ['cannot read', '无法读取'],
    ['unsupported Sensors property name:', '不支持的神策字段名：'], ['unsupported type for property', '不支持的字段类型：'],
    ['invalid pattern for property', '字段正则无效：'], ['credentials profile not found:', '未找到凭证配置：'],
    ['credentials profile', '凭证配置'], ['credentials path is not a file:', '凭证路径不是文件：'],
    ['choose --profile or set credentials.default_profile', '请选择 --profile 或设置 credentials.default_profile'],
    ['contract does not define environment:', '契约未定义环境：'],
    ['query time window ends before it starts', '查询结束时间早于开始时间'],
    ['before ingestion verification', '（平台查询之前）'], ['before browser actions', '（浏览器操作之前）'],
    ['for strong browser report validation', '（强校验浏览器报告）'], ['for environment evidence', '（环境证据）'],
    ['for locator actions', '（定位操作）'], ['when a locator action passes', '（定位操作通过时）'],
    ['when clicking a role=link locator', '（点击链接角色时）'], ['before click', '（点击之前）'],
    ['for journey-covered event id:', '（旅程覆盖的事件）：'], ['when provided', '（提供时）'],
    ['for version 3 browser verification', '（版本 3 浏览器验收）'], ['for version 3', '（版本 3）'], ['in version 3', '（版本 3）'], ['for version 1', '（版本 1）'],
    ['origin', '源地址'], ['journey steps', '旅程步骤'], ['journey step id', '旅程步骤标识'], ['journey action', '旅程动作'], ['journey expectation', '旅程预期'],
    ['contract event id', '契约事件标识'], ['report step id', '报告步骤标识'], ['report result id', '报告结果标识'],
    ['loopback IP', '回环 IP'], ['a .local hostname', '.local 域名'], ['a .local host', '.local 域名'],
    ['local queries', '本地查询'], ['production journey', '生产旅程'], ['qa journey', '测试旅程'], ['local journey', '本地旅程'],
    ['production contract', '生产契约'], ['production contract', '生产契约'],
    ['for every live query', '（每次实时查询）'], ['requires', '需要'], ['and', '和'], ['or', '或'], [' to ', ' 至 '],
];
export function translateDiagnostic(message) {
    let result = String(message);
    for (const [english, chinese] of diagnosticPhrases) {
        // Whole fragments only; do not corrupt identifiers such as report or authorization.
        const escaped = english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(`(?<![A-Za-z_])${escaped}(?![A-Za-z_])`, 'g'), chinese);
    }
    return humanizeReport(result);
}
export function formatValidation(report) {
    const lines = [`结果：${statusLabel(report.status)}`];
    for (const issue of report.issues || []) lines.push(`- ${translateDiagnostic(typeof issue === 'string' ? issue : issue.message)}`);
    return `${lines.join('\n')}\n`;
}

export function isEntrypoint(moduleUrl, argument = process.argv[1]) {
    if (!argument) return false;
    try { return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argument); }
    catch { return false; }
}
