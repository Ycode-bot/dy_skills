import fs from 'node:fs/promises';
import { analyzeTarget } from './source-analysis.mjs';
import { isEntrypoint, translateDiagnostic, withChineseLabels, humanizeReport, formatIssue, issueDetails } from './reporting.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.svelte', '.ts', '.tsx', '.vue']);
const IGNORED = new Set(['.git', '.next', '.nuxt', '.output', 'build', 'coverage', 'dist', 'node_modules', 'public', 'vendor']);
const MAX_BYTES = 1024 * 1024;

const HELP = `埋点源码检查

用法:
  node scripts/verify-tracking-source.mjs --spec <contract.json> [--root <project>] [--format markdown|json] [--out <path>]

--scope method 仅检查方法；integration（默认）同时检查实际调用。静态通过不代表运行时或入库通过。
`;

function usage(message) {
    const error = new Error(message);
    error.isUsageError = true;
    throw error;
}

function parseArgs(argv) {
    const options = { spec: '', root: process.cwd(), format: 'markdown', out: '', scope: 'integration', help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help') options.help = true;
        else if (arg === '--spec') options.spec = argv[++index];
        else if (arg === '--root') options.root = argv[++index];
        else if (arg === '--scope') options.scope = argv[++index];
        else if (arg === '--format') options.format = argv[++index];
        else if (arg === '--out') options.out = argv[++index];
        else usage(`未知参数: ${arg}`);
    }
    if (!options.help && !options.spec) usage('必须提供 --spec');
    if (!['method', 'integration'].includes(options.scope)) usage('--scope 仅支持 method 或 integration');
    if (!['markdown', 'json'].includes(options.format)) usage('--format 仅支持 markdown 或 json');
    return options;
}

async function collectSources(root) {
    const absoluteRoot = path.resolve(root);
    const sources = [];
    async function visit(directory) {
        let entries;
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink()) continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORED.has(entry.name)) await visit(absolute);
                continue;
            }
            if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
            const relativePath = path.relative(absoluteRoot, absolute).split(path.sep).join('/');
            if (/(?:^|\/)(?:__tests__|fixtures?|mocks?|tests?)(?:\/|$)|\.(?:spec|test)\.[^.]+$/i.test(relativePath)) continue;
            try {
                const stat = await fs.stat(absolute);
                if (stat.size > MAX_BYTES) continue;
                sources.push({
                    path: relativePath,
                    text: await fs.readFile(absolute, 'utf8'),
                });
            }
            catch {
                // Do not turn a transient read error into a false mismatch.
            }
        }
    }
    await visit(absoluteRoot);
    for (const generated of ['.nuxt/imports.d.ts', '.nuxt/imports.mjs']) {
        try { sources.push({ path: generated, text: await fs.readFile(path.join(absoluteRoot, generated), 'utf8') }); }
        catch { /* Generated imports are optional; unresolved calls need review. */ }
    }
    return sources;
}

function normalizeTargets(contract) {
    if (!contract || !Array.isArray(contract.events) || contract.events.length === 0) usage('contract.events must contain at least one event');
    const results = [];
    for (const [index, event] of contract.events.entries()) {
        if (event.targets) {
            for (const [platform, target] of Object.entries(event.targets)) {
                const status = target.status || (target.required === false ? 'optional' : 'required');
                if (status === 'disabled') continue;
                if (status === 'unknown') {
                    results.push({ id: event.id || `event-${index + 1}`, platform, targetStatus: status, event: target.event || '' });
                    continue;
                }
                if (!target.event) {
                    if (status === 'required') usage(`contract.events[${index}].targets.${platform}.event is required`);
                    continue;
                }
                results.push({
                    id: event.id || `event-${index + 1}`,
                    businessEvent: event.businessEvent || event.id || target.event,
                    trigger: event.trigger || '',
                    platform,
                    targetStatus: status,
                    event: target.event,
                    wrapper: target.wrapper || '',
                    match: target.match || {},
                    properties: target.properties || {},
                });
            }
        }
        else {
            if (!event.event) usage(`contract.events[${index}].event is required`);
            results.push({
                id: event.id || `event-${index + 1}`,
                businessEvent: event.id || event.event,
                trigger: event.trigger || '',
                platform: 'sensors',
                targetStatus: 'required',
                event: event.event,
                wrapper: event.wrapper || '',
                match: event.match || {},
                properties: event.properties || {},
            });
        }
    }
    return results;
}

function verifyTarget(expected, sources, root = '', options = {}) {
    if (expected.targetStatus === 'unknown') return { ...expected, status: 'BLOCKED', checks: [], issues: [issueDetails({ message: '目标平台的埋点需求尚未确定，未执行源码验收', location: `契约 ${expected.id}/${expected.platform}`, nextStep: '明确目标为必需、可选或停用后重新检查' })] };
    return analyzeTarget(expected, sources, root, options);
}

function verifySource(contract, sources, root = '', options = {}) {
    const results = normalizeTargets(contract).map(expected => verifyTarget(expected, sources, root, options));
    return {
        schemaVersion: 1,
        status: !results.length || results.some(result => result.status === 'BLOCKED') ? 'BLOCKED'
            : results.every(result => result.status === 'PASS') ? 'PASS' : 'FAILED',
        issues: results.length ? [] : [issueDetails({ message: '本次没有可检查的目标，源码验收未执行', nextStep: '明确本次事件和平台后重新检查' })],
        generatedAt: new Date().toISOString(),
        root,
        summary: {
            total: results.length,
            passed: results.filter(result => result.status === 'PASS').length,
            failed: results.filter(result => result.status !== 'PASS').length,
        },
        results,
        limitations: [
            '检查关联方法体、传输参数和实际调用；不证明运行时控制流与业务语义。',
            'PASS 只代表静态证据一致，仍需浏览器发送和数据平台入库证据。',
        ],
    };
}

function formatMarkdown(report) {
    const lines = [
        '# 埋点源码静态验收报告', '',
        `- 项目：${report.root}`,
        `- 结果：${report.summary.passed}/${report.summary.total} 通过`, '',
        '| 契约 | 平台 | 事件 | 状态 |', '|---|---|---|---|',
    ];
    for (const issue of report.issues || []) lines.push(`- ${formatIssue(issue)}`);
    for (const result of report.results) lines.push(`| ${result.id} | ${result.platform} | ${result.event} | ${result.status} |`);
    for (const result of report.results.filter(item => item.issues.length > 0)) {
        lines.push('', `## ${result.id}/${result.platform}`, '');
        for (const issue of result.issues) lines.push(`- ${formatIssue(issue)}`);
    }
    lines.push('', '## 限制', '', ...report.limitations.map(item => `- ${item}`), '');
    return humanizeReport(lines.join('\n'));
}

async function run(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(HELP);
        return 0;
    }
    const contract = JSON.parse(await fs.readFile(path.resolve(options.spec), 'utf8'));
    const root = path.resolve(options.root);
    const report = withChineseLabels(verifySource(contract, await collectSources(root), root, { scope: options.scope }));
    const output = options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatMarkdown(report);
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

export { collectSources, formatMarkdown, normalizeTargets, parseArgs, run, verifySource, verifyTarget };
