import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FAILURE_STATUSES = new Set([
    'MISSING_IMPLEMENTATION', 'UNREACHABLE', 'NOT_SENT', 'NOT_FOUND', 'COUNT_MISMATCH',
    'DUPLICATED', 'CONTRACT_MISMATCH', 'QUERY_FAILED', 'FAILED',
]);

const HELP = `Tracking acceptance report generator

Usage:
  node scripts/generate-tracking-report.mjs --spec <contract.json> [options]

Options:
  --scan <report.json>        Project scan JSON
  --source <report.json>      Source verification JSON
  --runtime <report.json>     Browser/SDK verification JSON
  --ingestion <report.json>   Platform ingestion verification JSON
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
    const options = { spec: '', scan: '', source: '', runtime: '', ingestion: '', format: 'markdown', out: '', help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help') options.help = true;
        else if (['--spec', '--scan', '--source', '--runtime', '--ingestion', '--format', '--out'].includes(arg)) {
            options[arg.slice(2)] = argv[++index];
        }
        else usage(`unknown argument: ${arg}`);
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

function contractRows(contract) {
    if (!contract || !Array.isArray(contract.events) || contract.events.length === 0) usage('contract.events must contain at least one event');
    const rows = [];
    for (const [index, event] of contract.events.entries()) {
        if (!event.targets) {
            rows.push({
                id: event.id || `event-${index + 1}`,
                businessEvent: event.businessEvent || event.id || event.event,
                trigger: event.trigger || '',
                platform: 'sensors',
                event: event.event,
                targetStatus: 'required',
                requiresIngestion: true,
            });
            continue;
        }
        for (const [platform, target] of Object.entries(event.targets)) {
            const status = target.status || 'unknown';
            if (!['required', 'unknown'].includes(status)) continue;
            rows.push({
                id: event.id || `event-${index + 1}`,
                businessEvent: event.businessEvent || event.id || target.event || '未命名事件',
                trigger: event.trigger || '',
                platform,
                event: target.event || '',
                targetStatus: status,
                requiresIngestion: platform === 'sensors' || Boolean(target.validation?.ingestionEvidence && target.validation.ingestionEvidence !== 'none'),
            });
        }
    }
    return rows;
}

function resultMap(report, defaultPlatform = '') {
    const map = new Map();
    for (const result of report?.results || []) {
        const platform = result.platform || defaultPlatform;
        map.set(`${result.id}::${platform}`, result);
        if (!platform) map.set(`${result.id}::`, result);
    }
    return map;
}

function stageStatus(map, row, fallbackPlatform = '') {
    return map.get(`${row.id}::${row.platform}`)?.status
        || map.get(`${row.id}::${fallbackPlatform}`)?.status
        || map.get(`${row.id}::`)?.status
        || 'NOT_RUN';
}

function finalStatus(row) {
    if (row.targetStatus === 'unknown') return 'BLOCKED';
    const requiredStages = [row.source, row.runtime];
    if (row.requiresIngestion) requiredStages.push(row.ingestion);
    const failure = requiredStages.find(status => FAILURE_STATUSES.has(status));
    if (failure) return failure;
    if (requiredStages.every(status => status === 'PASS')) return 'PASS';
    return 'INCOMPLETE';
}

function buildReport({ contract, scan = null, source = null, runtime = null, ingestion = null }) {
    const sourceMap = resultMap(source);
    const runtimeMap = resultMap(runtime);
    const ingestionMap = resultMap(ingestion, 'sensors');
    const results = contractRows(contract).map(row => {
        const result = {
            ...row,
            requirement: row.targetStatus === 'unknown' ? 'BLOCKED' : 'PASS',
            source: stageStatus(sourceMap, row),
            runtime: stageStatus(runtimeMap, row),
            ingestion: row.requiresIngestion ? stageStatus(ingestionMap, row, row.platform === 'sensors' ? 'sensors' : '') : 'NOT_REQUIRED',
        };
        result.status = finalStatus(result);
        return result;
    });
    let status = 'PASS';
    if (results.some(result => FAILURE_STATUSES.has(result.status))) status = 'FAILED';
    else if (results.some(result => result.status === 'BLOCKED')) status = 'BLOCKED';
    else if (results.some(result => result.status !== 'PASS')) status = 'INCOMPLETE';
    return {
        schemaVersion: 1,
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
        results,
        evidence: {
            scan: Boolean(scan), source: Boolean(source), runtime: Boolean(runtime), ingestion: Boolean(ingestion),
        },
    };
}

function formatMarkdown(report) {
    const lines = [
        '# 埋点端到端验收报告', '',
        `- 生成时间：${report.generatedAt}`,
        `- 总体状态：${report.status}`,
        `- 通过：${report.summary.passed}/${report.summary.total}`,
        `- 证据：架构扫描=${report.evidence.scan ? '有' : '无'}，源码=${report.evidence.source ? '有' : '无'}，运行时=${report.evidence.runtime ? '有' : '无'}，入库=${report.evidence.ingestion ? '有' : '无'}`, '',
    ];
    if (report.architecture) {
        lines.push('## 埋点体系', '', `- 总体分类：${report.architecture.classification}`);
        for (const [platform, status] of Object.entries(report.architecture.platforms)) {
            if (status !== 'absent') lines.push(`- ${platform}：${status}`);
        }
        if (report.architecture.risks.length > 0) lines.push(`- 扫描风险：${report.architecture.risks.length} 项`);
        lines.push('');
    }
    lines.push('## 事件验收', '',
        '| 业务事件 | 平台 | 事件 | 需求 | 源码 | 浏览器/SDK | 平台入库 | 最终结果 |',
        '|---|---|---|---|---|---|---|---|');
    for (const result of report.results) {
        lines.push(`| ${result.businessEvent} | ${result.platform} | ${result.event || '-'} | ${result.requirement} | ${result.source} | ${result.runtime} | ${result.ingestion} | ${result.status} |`);
    }
    const incomplete = report.results.filter(result => result.status !== 'PASS');
    if (incomplete.length > 0) {
        lines.push('', '## 待处理', '');
        for (const result of incomplete) {
            if (result.status === 'BLOCKED') lines.push(`- ${result.id}/${result.platform}：目标平台或事件定义仍为 unknown，需要数据或产品负责人确认。`);
            else if (result.status === 'INCOMPLETE') lines.push(`- ${result.id}/${result.platform}：证据尚未收齐，不能判定交付完成。`);
            else lines.push(`- ${result.id}/${result.platform}：${result.status}，查看对应阶段的差异报告。`);
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
        source: await readJson(options.source),
        runtime: await readJson(options.runtime),
        ingestion: await readJson(options.ingestion),
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

export { buildReport, contractRows, finalStatus, formatMarkdown, parseArgs, resultMap, run };
