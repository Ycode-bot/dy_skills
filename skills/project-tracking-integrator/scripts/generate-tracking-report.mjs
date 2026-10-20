import { validateReviews, selectReviewedEvidence, reviewWindowMatches } from './evidence-review.mjs';
import { isEntrypoint, translateDiagnostic, humanizeReport, withChineseLabels, issueDetails, formatIssue, statusLabel } from './reporting.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FAILURE_STATUSES = new Set([
    'MISSING_IMPLEMENTATION', 'UNREACHABLE', 'NOT_SENT', 'NOT_FOUND', 'COUNT_MISMATCH',
    'DUPLICATED', 'CONTRACT_MISMATCH', 'QUERY_FAILED', 'FAILED',
]);
const ENVIRONMENT_ORDER = ['local', 'qa', 'production'];
const READY_STATES = { local: 'LOCAL_READY', qa: 'QA_READY', production: 'PRODUCTION_VERIFIED' };
const EVIDENCE_STAGES = ['source', 'browser', 'runtime', 'ingestion'];

const HELP = `埋点验收报告汇总

用法：node scripts/generate-tracking-report.mjs --spec <contract.json> [参数]
--mode full-lifecycle：完整闭环，要求源码、浏览器、平台和开发证据；默认 full-lifecycle；--mode legacy 显式兼容旧报告。
--development <report.json>：业务影响与文档证据。
--scan <report.json>：体系扫描。
--source / --browser / --runtime / --ingestion <report.json>：对应阶段报告，可重复传入。
--review <review.json>：明确选择补查证据、解决旧结论及复核窗口；保留历史，不直接指定通过状态。
--format markdown|json：默认中文 Markdown；--out 保存文件；--help 显示帮助。
`;

function usage(message) {
    const error = new Error(message);
    error.isUsageError = true;
    throw error;
}

function parseArgs(argv) {
    const options = {
        spec: '', scan: '', mode: 'full-lifecycle', development: '', review: '', source: [], browser: [], runtime: [], ingestion: [], format: 'markdown', out: '', help: false,
    };
    const repeatable = new Set(['--source', '--browser', '--runtime', '--ingestion']);
    const single = new Set(['--spec', '--scan', '--format', '--out', '--mode', '--development', '--review']);
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help') {
            options.help = true;
            continue;
        }
        if (!repeatable.has(arg) && !single.has(arg)) usage(`unknown argument: ${arg}`);
        const value = argv[++index];
        if (!value || value.startsWith('--')) usage(`missing value for ${arg}`);
        const key = arg.slice(2);
        if (repeatable.has(arg)) options[key].push(value);
        else options[key] = value;
    }
    if (!['legacy', 'full-lifecycle'].includes(options.mode)) usage('--mode 仅支持 legacy 或 full-lifecycle');
    if (!options.help && !options.spec) usage('--spec is required');
    if (!['markdown', 'json'].includes(options.format)) usage('--format must be markdown or json');
    return options;
}

async function readJson(file) {
    if (!file) return null;
    try {
        return JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
    }
    catch (error) {
        usage(`cannot read JSON report ${file}: ${error.message}`);
    }
}

async function readJsonList(files) {
    return Promise.all((files || []).map(readJson));
}

function asReports(value) {
    if (!value) return [];
    return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function defaultEvidence(platform, environment = '') {
    if (!environment) {
        return platform === 'sensors' ? ['source', 'runtime', 'ingestion'] : ['source', 'runtime'];
    }
    if (environment === 'local') return ['source', 'browser', 'ingestion'];
    return ['browser', 'ingestion'];
}

function orderedEnvironments(contract) {
    const names = Object.keys(contract.environments || {});
    return names.sort((left, right) => {
        const leftIndex = ENVIRONMENT_ORDER.indexOf(left);
        const rightIndex = ENVIRONMENT_ORDER.indexOf(right);
        return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
    });
}

function contractRows(contract, mode = 'legacy') {
    if (!contract || !Array.isArray(contract.events) || contract.events.length === 0) usage('contract.events must contain at least one event');
    const rows = [];
    const environments = orderedEnvironments(contract);
    for (const [index, event] of contract.events.entries()) {
        const targets = event.targets || { sensors: { status: 'required', event: event.event } };
        for (const [platform, target] of Object.entries(targets)) {
            const targetStatus = target.status || 'unknown';
            if (!['required', 'unknown'].includes(targetStatus)) continue;
            const base = {
                id: event.id || `event-${index + 1}`,
                businessEvent: event.businessEvent || event.id || target.event || '未命名事件',
                trigger: event.trigger || '',
                platform,
                event: target.event || '',
                targetStatus,
            };
            if (environments.length === 0) {
                rows.push({
                    ...base,
                    environment: '',
                    environmentStatus: 'required',
                    smokeSafe: null,
                    requiredEvidence: mode === 'full-lifecycle' ? ['source', 'browser', 'ingestion'] : defaultEvidence(platform),
                });
                continue;
            }
            const requirements = event.validation?.environments || {};
            for (const environment of environments) {
                const requirement = requirements[environment] || { status: 'unknown', evidence: [] };
                if (['optional', 'disabled'].includes(requirement.status)) continue;
                rows.push({
                    ...base,
                    environment,
                    environmentStatus: requirement.status || 'unknown',
                    smokeSafe: requirement.smokeSafe ?? null,
                    requiredEvidence: mode === 'full-lifecycle' ? [...new Set(['source', 'browser', 'ingestion', ...(requirement.evidence || [])])] : requirement.evidence?.length
                        ? requirement.evidence
                        : defaultEvidence(platform, environment),
                });
            }
        }
    }
    return rows;
}

function environmentName(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') return value.name || '';
    return '';
}

function expectedEnvironmentEvidence(contract, environment) {
    const profile = contract?.environments?.[environment];
    if (!profile?.query) return null;
    let value = profile.query.value || '';
    if (!value && profile.query.valueFrom === 'browser-host' && profile.startUrl) {
        try {
            value = new URL(profile.startUrl).host;
        }
        catch {
            return null;
        }
    }
    return { property: profile.query.property || 'lmweb_url', value };
}

function reportEnvironmentMatches(report, contract) {
    const environment = report?.environment;
    const name = environmentName(environment);
    const expected = expectedEnvironmentEvidence(contract, name);
    if (!expected) return false;
    return environment
        && typeof environment === 'object'
        && environment.property === expected.property
        && environment.value === expected.value;
}

function hasInvalidIngestionEvidence(reports, contract, row) {
    return reports.some(report => {
        if (reportEnvironmentMatches(report, contract)) return false;
        const declaredEnvironment = environmentName(report?.environment);
        if (declaredEnvironment
            && contract?.environments?.[declaredEnvironment]
            && declaredEnvironment !== row.environment) {
            return false;
        }
        return (report?.results || []).some(result => {
            const platform = result.platform || 'sensors';
            return result.id === row.id && platform === row.platform;
        });
    });
}

function resultMap(reportValue, defaultPlatform = '', { contract = null, requireEnvironmentEvidence = false } = {}) {
    const map = new Map();
    for (const report of asReports(reportValue)) {
        const reportEnvironment = environmentName(report.environment);
        const environmentMismatch = requireEnvironmentEvidence
            && Object.keys(contract?.environments || {}).length > 0
            && !reportEnvironmentMatches(report, contract);
        for (const result of report?.results || []) {
            const platform = result.platform || defaultPlatform;
            const environment = environmentName(result.environment) || reportEnvironment;
            const environmentConflict = Boolean(reportEnvironment && environment !== reportEnvironment);
            let normalizedResult = (environmentMismatch || environmentConflict) ? { ...result, status: 'QUERY_FAILED', issues: [issueDetails({ message: '报告环境、事件环境或环境过滤与契约不一致', nextStep: '使用正确环境重新查询' })] } : result;
            if (!environmentMismatch && !environmentConflict && result.method === 'agent-review' && (!Array.isArray(result.evidence) || !result.evidence.length)) {
                normalizedResult = { ...result, status: 'NEEDS_REVIEW', issues: [issueDetails({ message: '人工补查报告缺少可定位的证据', nextStep: '补充位置、检查过程及结论依据' })] };
            }
            const key = `${result.id}::${platform}::${environment}`;
            const prior = map.get(key);
            if (prior && prior.result.status !== normalizedResult.status) {
                normalizedResult = { ...normalizedResult, status: FAILURE_STATUSES.has(prior.result.status) ? prior.result.status : FAILURE_STATUSES.has(normalizedResult.status) ? normalizedResult.status : 'NEEDS_REVIEW', issues: [
                    ...(prior.result.issues || []), ...(normalizedResult.issues || []),
                    issueDetails({ message: `多轮证据冲突：${prior.result.status} / ${result.status}，不能以后一份覆盖前一份`, nextStep: '查询故障请用原会话 --resume；业务修复重验请单独交付新轮结果并保留旧轮历史' }),
                ] };
            }
            map.set(key, { result: normalizedResult, report });
            if (!platform) map.set(`${result.id}::::${environment}`, { result: normalizedResult, report });
        }
    }
    return map;
}

function stageEvidence(map, row, { fallbackPlatform = '', allowGlobal = false } = {}) {
    const environments = allowGlobal && row.environment ? [row.environment, ''] : [row.environment];
    const platforms = fallbackPlatform && fallbackPlatform !== row.platform
        ? [row.platform, fallbackPlatform, '']
        : [row.platform, ''];
    for (const environment of environments) {
        for (const platform of platforms) {
            const evidence = map.get(`${row.id}::${platform}::${environment}`);
            if (evidence) return evidence;
        }
    }
    return null;
}

function finalStatus(row) {
    if (row.targetStatus === 'unknown' || row.environmentStatus === 'unknown') return 'BLOCKED';
    if (row.environment === 'production' && row.smokeSafe !== true) return 'BLOCKED';
    const statuses = row.requiredEvidence.map(stage => row[stage]);
    const failure = statuses.find(status => FAILURE_STATUSES.has(status));
    if (failure) return failure;
    if (statuses.length > 0 && statuses.every(status => status === 'PASS')) return 'PASS';
    return 'INCOMPLETE';
}

function ownGateStatus(results) {
    if (results.length === 0) return 'NOT_REQUIRED';
    const failure = results.find(result => FAILURE_STATUSES.has(result.status));
    if (failure) return 'FAILED';
    if (results.some(result => result.status === 'BLOCKED')) return 'BLOCKED';
    if (results.every(result => result.status === 'PASS')) return 'PASS';
    return 'INCOMPLETE';
}

function buildGates(results) {
    const gates = {};
    let previousRequired = '';
    let previousPassed = true;
    for (const environment of ENVIRONMENT_ORDER) {
        const environmentResults = results.filter(result => result.environment === environment);
        const evidenceStatus = ownGateStatus(environmentResults);
        let status = evidenceStatus;
        let blockedBy = '';
        if (evidenceStatus !== 'NOT_REQUIRED' && !previousPassed) {
            status = 'BLOCKED';
            blockedBy = previousRequired;
        }
        gates[environment] = {
            status,
            evidenceStatus,
            blockedBy,
            readiness: status === 'PASS' ? READY_STATES[environment] : 'NOT_READY',
        };
        if (evidenceStatus !== 'NOT_REQUIRED') {
            previousRequired = environment;
            previousPassed = status === 'PASS';
        }
    }
    return gates;
}

function buildReport({ contract, scan = null, source = null, browser = null, runtime = null, ingestion = null, mode = 'legacy', development = null, review = null }) {
    const sourceReports = asReports(source);
    const browserReports = asReports(browser);
    const runtimeReports = asReports(runtime);
    const ingestionReports = asReports(ingestion);
    const sourceMap = resultMap(sourceReports);
    const browserMap = resultMap(browserReports);
    const runtimeMap = resultMap(runtimeReports);
    const ingestionMap = resultMap(ingestionReports, 'sensors', {
        contract,
        requireEnvironmentEvidence: true,
    });
    const rows = contractRows(contract, mode);
    const resolutions = validateReviews(review, rows);
    const reportsByStage = { source: sourceReports, browser: browserReports, runtime: runtimeReports, ingestion: ingestionReports };
    const results = rows.map(row => {
        const result = {
            ...row,
            issues: [],
            evidenceDetails: {},
            reviewHistory: [],
            requirement: row.targetStatus === 'unknown' || row.environmentStatus === 'unknown'
                || (row.environment === 'production' && row.smokeSafe !== true)
                ? 'BLOCKED'
                : 'PASS',
        };
        const selectedEvidence = {};
        for (const stage of EVIDENCE_STAGES) {
            if (!row.requiredEvidence.includes(stage)) {
                result[stage] = 'NOT_REQUIRED';
                continue;
            }
            const map = { source: sourceMap, browser: browserMap, runtime: runtimeMap, ingestion: ingestionMap }[stage];
            selectedEvidence[stage] = stageEvidence(map, row, {
                fallbackPlatform: stage === 'ingestion' && row.platform === 'sensors' ? 'sensors' : '',
                allowGlobal: stage === 'source',
            });
            const resolution = resolutions.find(item => item.id === row.id && item.platform === row.platform && item.environment === row.environment && item.stage === stage);
            const reviewed = selectReviewedEvidence({ resolution, reports: reportsByStage[stage], row, stage, contract,
                select: report => stageEvidence(resultMap([report], stage === 'ingestion' ? 'sensors' : '', {
                    contract, requireEnvironmentEvidence: stage === 'ingestion',
                }), row, { allowGlobal: stage === 'source' }),
            });
            if (reviewed) {
                selectedEvidence[stage] = reviewed;
                result.reviewHistory.push({ stage, ...resolution, previousResults: reviewed.history });
            }
            result[stage] = selectedEvidence[stage]?.result.status || 'NOT_RUN';
            const selected = selectedEvidence[stage]?.result;
            if (stage === 'source' && mode === 'full-lifecycle' && selected?.scope === 'method') {
                result[stage] = 'NEEDS_REVIEW';
                result.issues.push(issueDetails({ message: '源码报告仅检查方法，尚未验证业务调用点', nextStep: '运行 integration 范围检查，或提供覆盖调用点的 Agent 补查证据' }));
            }
            if (stage === 'browser' && selected?.status === 'NOT_AVAILABLE' && selected.pageStatus === 'PASS') result[stage] = 'PASS';
            if (stage === 'ingestion'
                && result[stage] === 'NOT_RUN'
                && hasInvalidIngestionEvidence(ingestionReports, contract, row)) {
                result[stage] = 'QUERY_FAILED';
            }
        }
        for (const stage of row.requiredEvidence) {
            const item = selectedEvidence[stage]?.result;
            if (item?.reason) result.issues.push(issueDetails({ message: `${item.reason.message}；条件由本轮操作改变：${item.reason.changedByRun ? '是' : '否'}`, nextStep: item.reason.recovery }));
            if (item) {
                result.evidenceDetails[stage] = item;
                if (item.event && item.event !== row.event) {
                    result[stage] = 'CONTRACT_MISMATCH';
                    result.issues.push(issueDetails({ message: `${statusLabel(stage)}报告的事件名与本次契约不一致`, nextStep: '提供本次目标事件的证据' }));
                }
            }
            const reasons = item?.issues?.length ? item.issues : result[stage] !== 'PASS'
                ? [{ message: `${statusLabel(stage)}：${statusLabel(result[stage])}`, nextStep: `补齐${statusLabel(stage)}证据后重新验收` }] : [];
            result.issues.push(...reasons.map(issue => ({ stage, ...issueDetails(typeof issue === 'string' ? { message: issue } : issue) })));
        }
        result.accountConditions = selectedEvidence.browser?.report.accountConditions || [];
        if (mode === 'full-lifecycle' && result.browser === 'PASS' && result.ingestion !== 'NOT_RUN') {
            const browserEvidence = selectedEvidence.browser?.report;
            const ingested = result.evidenceDetails.ingestion;
            const trigger = browserEvidence?.triggerWindow;
            const queryWindow = ingested?.queryWindow;
            const reviewedWindow = reviewWindowMatches(selectedEvidence.ingestion?.resolution, trigger, queryWindow);
            if (!trigger?.startedAt || !trigger?.finishedAt || !queryWindow?.startedAt || !queryWindow?.finishedAt
                || Date.parse(trigger.startedAt) !== Date.parse(queryWindow.startedAt)
                || Date.parse(trigger.finishedAt) !== Date.parse(queryWindow.finishedAt)) {
                if (reviewedWindow) {
                    result.status = finalStatus(result);
                    return result;
                }
                if (!FAILURE_STATUSES.has(result.ingestion) && result.ingestion !== 'BLOCKED') result.ingestion = 'NEEDS_REVIEW';
                result.issues.push(issueDetails({ message: '浏览器触发窗口与入库查询窗口缺失或不一致，不能关联本轮验收', nextStep: '修复后用新窗口重跑浏览器及平台验收，并保留相同时间证据' }));
            }
        }
        result.status = finalStatus(result);
        return result;
    });
    const gates = orderedEnvironments(contract).length > 0 ? buildGates(results) : {};
    let status = results.length ? 'PASS' : 'BLOCKED';
    if (results.some(result => FAILURE_STATUSES.has(result.status))) status = 'FAILED';
    else if (results.some(result => result.status === 'BLOCKED') || Object.values(gates).some(gate => gate.status === 'BLOCKED')) status = 'BLOCKED';
    else if (results.some(result => result.status !== 'PASS') || Object.values(gates).some(gate => !['PASS', 'NOT_REQUIRED'].includes(gate.status))) status = 'INCOMPLETE';
    const developmentIssues = [];
    if (!results.length) developmentIssues.push(issueDetails({ message: '契约中没有可验收的必需事件，不能给出通过结论', nextStep: '明确本次必需目标与验收范围' }));
    if (mode === 'full-lifecycle') {
        if (!Object.keys(contract.environments || {}).length) {
            developmentIssues.push(issueDetails({ message: '完整闭环缺少明确验收环境', nextStep: '在契约中声明本次测试地址与环境过滤' }));
        }
        for (const stage of ['businessImpact', 'documentation']) {
            const evidence = development?.[stage];
            if (evidence?.status !== 'PASS' || !evidence?.evidence?.length || (stage === 'businessImpact' && evidence.risk !== 'low')) {
                developmentIssues.push(issueDetails({ message: stage === 'businessImpact' ? '业务影响检查未完成或仍有未解除的影响' : '文档同步缺少完成证据', location: evidence?.path, nextStep: '完成该阶段并补充可定位的证据' }));
            }
        }
        if (developmentIssues.length && status === 'PASS') status = 'INCOMPLETE';
    }
    return {
        schemaVersion: 2,
        mode,
        developmentIssues,
        development,
        recoveryHistory: ingestionReports.flatMap(report => report.recoveryHistory || []),
        generatedAt: new Date().toISOString(),
        status,
        architecture: scan ? {
            classification: scan.classification || 'unknown',
            platforms: Object.fromEntries(Object.entries(scan.platforms || {}).map(([name, value]) => [name, value.status || 'unknown'])),
            risks: scan.risks || [],
        } : null,
        summary: {
            total: results.length,
            passed: results.filter(result => result.status === 'PASS').length,
            failed: results.filter(result => FAILURE_STATUSES.has(result.status)).length,
            incomplete: results.filter(result => result.status === 'INCOMPLETE').length,
            blocked: results.filter(result => result.status === 'BLOCKED').length,
        },
        gates,
        results,
        evidence: {
            scan: Boolean(scan),
            source: sourceReports.length,
            browser: browserReports.length,
            runtime: runtimeReports.length,
            ingestion: ingestionReports.length,
        },
    };
}

function formatMarkdown(report) {
    const lines = [
        report.mode === 'full-lifecycle' ? '# 埋点闭环验收报告' : '# 埋点阶段证据报告', '',
        `- 生成时间：${report.generatedAt}`,
        `- 总体状态：${report.status}`,
        `- 验收场景通过：${report.summary.passed}/${report.summary.total}`,
        `- 证据：架构扫描=${report.evidence.scan ? '有' : '无'}，源码=${report.evidence.source}，浏览器=${report.evidence.browser}，运行时=${report.evidence.runtime}，入库=${report.evidence.ingestion}`, '',
    ];
    if (Object.keys(report.gates).length > 0) {
        lines.push('## 环境验收状态', '', '| 环境 | 证据状态 | 门禁状态 | 就绪状态 | 阻塞来源 |', '|---|---|---|---|---|');
        for (const environment of ENVIRONMENT_ORDER) {
            const gate = report.gates[environment];
            if (gate.evidenceStatus === 'NOT_REQUIRED') continue;
            lines.push(`| ${statusLabel(environment)} | ${gate.evidenceStatus} | ${gate.status} | ${gate.readiness} | ${gate.blockedBy ? statusLabel(gate.blockedBy) : '-'} |`);
        }
        lines.push('');
    }
    if (report.development) {
        lines.push('', '## 开发证据', '',
            `- 业务影响：${statusLabel(report.development.businessImpact?.status)}；风险：${({low:'低',medium:'待补查',high:'高'})[report.development.businessImpact?.risk] || '尚未确定'}`,
            `- 文档：${report.development.documentation?.path || '见项目现有文档'}；${statusLabel(report.development.documentation?.status)}`);
    }
    if (report.architecture) {
        lines.push('## 埋点体系', '', `- 总体分类：${report.architecture.classification}`);
        for (const [platform, platformStatus] of Object.entries(report.architecture.platforms)) {
            if (platformStatus !== 'absent') lines.push(`- ${platform}：${platformStatus}`);
        }
        if (report.architecture.risks.length > 0) lines.push(`- 扫描风险：${report.architecture.risks.length} 项`);
        lines.push('');
    }
    const showRuntime = report.results.some(result => result.requiredEvidence.includes('runtime'));
    lines.push('## 事件验收', '',
        `| 业务事件 | 平台 | 环境 | 需求 | 源码 | 浏览器 |${showRuntime ? ' SDK/请求 |' : ''} 平台入库 | 最终结果 |`,
        `|---|---|---|---|---|---|${showRuntime ? '---|' : ''}---|---|`);
    for (const result of report.results) {
        lines.push(`| ${result.businessEvent} | ${result.platform} | ${result.environment ? statusLabel(result.environment) : '-'} | ${result.requirement} | ${result.source} | ${result.evidenceDetails?.browser?.reason?.code === 'PRECONDITION_UNMET' ? '前置条件不满足' : result.browser} |${showRuntime ? ` ${result.runtime} |` : ''} ${result.ingestion} | ${result.status} |`);
    }
    if (report.results.some(result => result.evidenceDetails?.browser?.status === 'NOT_AVAILABLE')) {
        lines.push('- 部分场景未直接捕获 SDK/请求，页面结果与入库证据分别核验；是否阻塞以契约必需阶段为准。');
    }
    const reviewed = report.results.filter(result => result.reviewHistory?.length);
    if (reviewed.length) {
        lines.push('', '## 补查复核与历史', '');
        for (const result of reviewed) for (const review of result.reviewHistory) {
            lines.push(`- ${result.id}/${result.platform}/${result.environment}：${statusLabel(review.stage)}采用报告索引 ${review.reportIndex}；原因：${review.reason}；依据：${review.evidence.join('；')}。`);
            for (const prior of review.previousResults) lines.push(`  - 原报告索引 ${prior.reportIndex}：${statusLabel(prior.status)}；${prior.issues.map(issue => typeof issue === 'string' ? issue : issue.message).join('；') || '原始检查记录保留'}。`);
            if (review.windowReview) lines.push(`  - 窗口复核：${review.windowReview.reason}；同次操作依据：${review.windowReview.association}；证据：${review.windowReview.evidence.join('；')}。`);
        }
    }
    if (report.recoveryHistory?.length) lines.push(`- 查询恢复历史：${report.recoveryHistory.length} 次先前运行（${report.recoveryHistory.map(run => statusLabel(run.status)).join('、')}），经原会话显式恢复后取得本轮结果。`);
    const conditions = [...new Set(report.results.flatMap(result => result.accountConditions || []))];
    lines.push('', `- 已覆盖账号条件：${conditions.length ? conditions.join('；') : '未记录，不能推断覆盖全部分组或账号'}`);
    for (const issue of report.developmentIssues || []) lines.push(`- ${formatIssue(issue)}`);
    const incomplete = report.results.filter(result => result.status !== 'PASS');
    if (incomplete.length > 0) {
        lines.push('', '## 待处理', '');
        for (const result of incomplete) {
            const label = `${result.id}/${result.platform}/${result.environment || 'legacy'}`;
            for (const issue of result.issues || []) lines.push(`- ${label}：${formatIssue(issue)}`);
            if (result.status === 'BLOCKED') lines.push(`- ${label}：环境要求、目标定义或 production smokeSafe 尚未满足。`);
            else if (result.status === 'INCOMPLETE') lines.push(`- ${label}：必需证据尚未收齐。`);
            else lines.push(`- ${label}：${result.status}，查看对应阶段的差异报告。`);
        }
    }
    lines.push('');
    return humanizeReport(lines.join('\n'));
}

async function run(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(HELP);
        return 0;
    }
    const report = buildReport({
        contract: await readJson(options.spec),
        mode: options.mode,
        development: await readJson(options.development),
        review: await readJson(options.review),
        scan: await readJson(options.scan),
        source: await readJsonList(options.source),
        browser: await readJsonList(options.browser),
        runtime: await readJsonList(options.runtime),
        ingestion: await readJsonList(options.ingestion),
    });
    const output = options.format === 'json' ? `${JSON.stringify(withChineseLabels(report), null, 2)}\n` : formatMarkdown(report);
    if (options.out) {
        await fs.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
        await fs.writeFile(options.out, output, 'utf8');
    }
    else process.stdout.write(output);
    return report.status === 'PASS' ? 0 : 1;
}

const isMain = isEntrypoint(import.meta.url);
if (isMain) {
    run().then(code => { process.exitCode = code; }).catch(error => {
        process.stderr.write(`错误：${translateDiagnostic(error.message)}\n`);
        process.exitCode = error.isUsageError ? 2 : 3;
    });
}

export {
    buildGates,
    buildReport,
    contractRows,
    expectedEnvironmentEvidence,
    finalStatus,
    formatMarkdown,
    parseArgs,
    reportEnvironmentMatches,
    resultMap,
    run,
};
