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

const HELP = `Tracking acceptance report generator

Usage:
  node scripts/generate-tracking-report.mjs --spec <contract.json> [options]

Options:
  --scan <report.json>        Project scan JSON
  --source <report.json>      Source verification JSON; repeatable
  --browser <report.json>     Browser journey JSON; repeatable by environment
  --runtime <report.json>     SDK/payload verification JSON; repeatable by environment
  --ingestion <report.json>   Platform ingestion JSON; repeatable by environment
  --format <markdown|json>    Default: markdown
  --out <path>                Write report instead of stdout
  --help                      Show this help
`;

function usage(message) {
    const error = new Error(message);
    error.isUsageError = true;
    throw error;
}

function parseArgs(argv) {
    const options = {
        spec: '', scan: '', source: [], browser: [], runtime: [], ingestion: [], format: 'markdown', out: '', help: false,
    };
    const repeatable = new Set(['--source', '--browser', '--runtime', '--ingestion']);
    const single = new Set(['--spec', '--scan', '--format', '--out']);
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

function contractRows(contract) {
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
                    requiredEvidence: defaultEvidence(platform),
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
                    requiredEvidence: requirement.evidence?.length
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
            const normalizedResult = environmentMismatch ? { ...result, status: 'QUERY_FAILED' } : result;
            map.set(`${result.id}::${platform}::${environment}`, normalizedResult);
            if (!platform) map.set(`${result.id}::::${environment}`, normalizedResult);
        }
    }
    return map;
}

function stageStatus(map, row, { fallbackPlatform = '', allowGlobal = false } = {}) {
    const environments = allowGlobal && row.environment ? [row.environment, ''] : [row.environment];
    const platforms = fallbackPlatform && fallbackPlatform !== row.platform
        ? [row.platform, fallbackPlatform, '']
        : [row.platform, ''];
    for (const environment of environments) {
        for (const platform of platforms) {
            const status = map.get(`${row.id}::${platform}::${environment}`)?.status;
            if (status) return status;
        }
    }
    return 'NOT_RUN';
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

function buildReport({ contract, scan = null, source = null, browser = null, runtime = null, ingestion = null }) {
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
    const results = contractRows(contract).map(row => {
        const result = {
            ...row,
            requirement: row.targetStatus === 'unknown' || row.environmentStatus === 'unknown'
                || (row.environment === 'production' && row.smokeSafe !== true)
                ? 'BLOCKED'
                : 'PASS',
        };
        for (const stage of EVIDENCE_STAGES) {
            if (!row.requiredEvidence.includes(stage)) {
                result[stage] = 'NOT_REQUIRED';
                continue;
            }
            const map = { source: sourceMap, browser: browserMap, runtime: runtimeMap, ingestion: ingestionMap }[stage];
            result[stage] = stageStatus(map, row, {
                fallbackPlatform: stage === 'ingestion' && row.platform === 'sensors' ? 'sensors' : '',
                allowGlobal: stage === 'source',
            });
            if (stage === 'ingestion'
                && result[stage] === 'NOT_RUN'
                && hasInvalidIngestionEvidence(ingestionReports, contract, row)) {
                result[stage] = 'QUERY_FAILED';
            }
        }
        result.status = finalStatus(result);
        return result;
    });
    const gates = orderedEnvironments(contract).length > 0 ? buildGates(results) : {};
    let status = 'PASS';
    if (results.some(result => FAILURE_STATUSES.has(result.status))) status = 'FAILED';
    else if (results.some(result => result.status === 'BLOCKED') || Object.values(gates).some(gate => gate.status === 'BLOCKED')) status = 'BLOCKED';
    else if (results.some(result => result.status !== 'PASS') || Object.values(gates).some(gate => !['PASS', 'NOT_REQUIRED'].includes(gate.status))) status = 'INCOMPLETE';
    return {
        schemaVersion: 2,
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
        '# 埋点端到端验收报告', '',
        `- 生成时间：${report.generatedAt}`,
        `- 总体状态：${report.status}`,
        `- 通过：${report.summary.passed}/${report.summary.total}`,
        `- 证据：架构扫描=${report.evidence.scan ? '有' : '无'}，源码=${report.evidence.source}，浏览器=${report.evidence.browser}，运行时=${report.evidence.runtime}，入库=${report.evidence.ingestion}`, '',
    ];
    if (Object.keys(report.gates).length > 0) {
        lines.push('## 环境晋级门禁', '', '| 环境 | 证据状态 | 门禁状态 | 就绪状态 | 阻塞来源 |', '|---|---|---|---|---|');
        for (const environment of ENVIRONMENT_ORDER) {
            const gate = report.gates[environment];
            lines.push(`| ${environment} | ${gate.evidenceStatus} | ${gate.status} | ${gate.readiness} | ${gate.blockedBy || '-'} |`);
        }
        lines.push('');
    }
    if (report.architecture) {
        lines.push('## 埋点体系', '', `- 总体分类：${report.architecture.classification}`);
        for (const [platform, platformStatus] of Object.entries(report.architecture.platforms)) {
            if (platformStatus !== 'absent') lines.push(`- ${platform}：${platformStatus}`);
        }
        if (report.architecture.risks.length > 0) lines.push(`- 扫描风险：${report.architecture.risks.length} 项`);
        lines.push('');
    }
    lines.push('## 事件验收', '',
        '| 业务事件 | 平台 | 环境 | 需求 | 源码 | 浏览器 | SDK/请求 | 平台入库 | 最终结果 |',
        '|---|---|---|---|---|---|---|---|---|');
    for (const result of report.results) {
        lines.push(`| ${result.businessEvent} | ${result.platform} | ${result.environment || '-'} | ${result.requirement} | ${result.source} | ${result.browser} | ${result.runtime} | ${result.ingestion} | ${result.status} |`);
    }
    const incomplete = report.results.filter(result => result.status !== 'PASS');
    if (incomplete.length > 0) {
        lines.push('', '## 待处理', '');
        for (const result of incomplete) {
            const label = `${result.id}/${result.platform}/${result.environment || 'legacy'}`;
            if (result.status === 'BLOCKED') lines.push(`- ${label}：环境要求、目标定义或 production smokeSafe 尚未满足。`);
            else if (result.status === 'INCOMPLETE') lines.push(`- ${label}：必需证据尚未收齐。`);
            else lines.push(`- ${label}：${result.status}，查看对应阶段的差异报告。`);
        }
    }
    lines.push('');
    return lines.join('\n');
}

async function run(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(HELP);
        return 0;
    }
    const report = buildReport({
        contract: await readJson(options.spec),
        scan: await readJson(options.scan),
        source: await readJsonList(options.source),
        browser: await readJsonList(options.browser),
        runtime: await readJsonList(options.runtime),
        ingestion: await readJsonList(options.ingestion),
    });
    const output = options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatMarkdown(report);
    if (options.out) {
        await fs.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
        await fs.writeFile(options.out, output, 'utf8');
    }
    else process.stdout.write(output);
    return report.status === 'PASS' ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    run().then(code => { process.exitCode = code; }).catch(error => {
        process.stderr.write(`Error: ${error.message}\n`);
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
