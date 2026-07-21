import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.svelte', '.ts', '.tsx', '.vue']);
const IGNORED = new Set(['.git', '.next', '.nuxt', '.output', 'build', 'coverage', 'dist', 'node_modules', 'public', 'vendor']);
const MAX_BYTES = 1024 * 1024;

const HELP = `Tracking source verifier

Usage:
  node scripts/verify-tracking-source.mjs --spec <contract.json> [--root <project>] [--format markdown|json] [--out <path>]

This is a deterministic static check. A PASS still requires runtime and ingestion evidence.
`;

function usage(message) {
    const error = new Error(message);
    error.isUsageError = true;
    throw error;
}

function parseArgs(argv) {
    const options = { spec: '', root: process.cwd(), format: 'markdown', out: '', help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help') options.help = true;
        else if (arg === '--spec') options.spec = argv[++index];
        else if (arg === '--root') options.root = argv[++index];
        else if (arg === '--format') options.format = argv[++index];
        else if (arg === '--out') options.out = argv[++index];
        else usage(`unknown argument: ${arg}`);
    }
    if (!options.help && !options.spec) usage('--spec is required');
    if (!['markdown', 'json'].includes(options.format)) usage('--format must be markdown or json');
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
    return sources;
}

function normalizeTargets(contract) {
    if (!contract || !Array.isArray(contract.events) || contract.events.length === 0) usage('contract.events must contain at least one event');
    const results = [];
    for (const [index, event] of contract.events.entries()) {
        if (event.targets) {
            for (const [platform, target] of Object.entries(event.targets)) {
                const status = target.status || (target.required === false ? 'optional' : 'required');
                if (!['required', 'optional'].includes(status)) continue;
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

function filesContaining(sources, value) {
    if (value === undefined || value === null || value === '') return [];
    const needle = String(value);
    return sources.filter(source => source.text.includes(needle)).map(source => source.path);
}

function wordOccurrenceCount(sources, word) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(`\\b${escaped}\\b`, 'g');
    return sources.reduce((total, source) => total + [...source.text.matchAll(expression)].length, 0);
}

function verifyTarget(expected, sources) {
    const checks = [];
    const eventFiles = filesContaining(sources, expected.event);
    checks.push({ kind: 'event', name: expected.event, found: eventFiles.length > 0, files: eventFiles.slice(0, 8) });

    for (const [name, value] of Object.entries(expected.match)) {
        const nameFiles = filesContaining(sources, name);
        const valueFiles = filesContaining(sources, value);
        checks.push({
            kind: 'match', name, found: nameFiles.length > 0 && valueFiles.length > 0,
            files: [...new Set([...nameFiles, ...valueFiles])].slice(0, 8),
        });
    }
    for (const [name, rule] of Object.entries(expected.properties)) {
        if (rule.required === false) continue;
        const nameFiles = filesContaining(sources, name);
        const expectedValues = Object.prototype.hasOwnProperty.call(rule, 'equals')
            ? [rule.equals]
            : Array.isArray(rule.oneOf) ? rule.oneOf : [];
        const missingValues = expectedValues.filter(value => filesContaining(sources, value).length === 0);
        const valueFiles = expectedValues.flatMap(value => filesContaining(sources, value));
        checks.push({
            kind: 'property',
            name,
            found: nameFiles.length > 0 && missingValues.length === 0,
            missingValues,
            files: [...new Set([...nameFiles, ...valueFiles])].slice(0, 8),
        });
    }

    let wrapperOccurrences = 0;
    if (expected.wrapper) {
        const files = filesContaining(sources, expected.wrapper);
        wrapperOccurrences = wordOccurrenceCount(sources, expected.wrapper);
        checks.push({ kind: 'wrapper', name: expected.wrapper, found: wrapperOccurrences > 0, occurrences: wrapperOccurrences, files: files.slice(0, 8) });
    }

    const missingEventOrWrapper = checks.some(check => ['event', 'wrapper'].includes(check.kind) && !check.found);
    const missingContractFields = checks.some(check => ['match', 'property'].includes(check.kind) && !check.found);
    let status = 'PASS';
    const issues = [];
    if (missingEventOrWrapper) {
        status = 'MISSING_IMPLEMENTATION';
        for (const check of checks.filter(item => ['event', 'wrapper'].includes(item.kind) && !item.found)) {
            issues.push({ code: 'MISSING_IMPLEMENTATION', message: `源码中未找到 ${check.kind}：${check.name}` });
        }
    }
    else if (expected.wrapper && wrapperOccurrences < 2) {
        status = 'UNREACHABLE';
        issues.push({ code: 'WRAPPER_NOT_CALLED', message: `只找到 ${expected.wrapper} 的定义或单次引用，未找到可信调用点` });
    }
    else if (missingContractFields) {
        status = 'CONTRACT_MISMATCH';
        for (const check of checks.filter(item => ['match', 'property'].includes(item.kind) && !item.found)) {
            const values = check.missingValues?.length ? `，缺少约定值 ${check.missingValues.join('、')}` : '';
            issues.push({ code: 'MISSING_CONTRACT_FIELD', message: `源码中未找到完整的 ${check.kind}：${check.name}${values}` });
        }
    }
    else if (!expected.wrapper) {
        status = 'NEEDS_REVIEW';
        issues.push({ code: 'WRAPPER_UNDECLARED', message: '契约未声明业务 wrapper，静态检查无法证明调用路径可达' });
    }

    return { ...expected, status, checks, issues };
}

function verifySource(contract, sources, root = '') {
    const results = normalizeTargets(contract).map(expected => verifyTarget(expected, sources));
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        root,
        summary: {
            total: results.length,
            passed: results.filter(result => result.status === 'PASS').length,
            failed: results.filter(result => result.status !== 'PASS').length,
        },
        results,
        limitations: [
            '该检查基于源码字面量和 wrapper 引用，不执行控制流分析。',
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
    for (const result of report.results) lines.push(`| ${result.id} | ${result.platform} | ${result.event} | ${result.status} |`);
    for (const result of report.results.filter(item => item.issues.length > 0)) {
        lines.push('', `## ${result.id}/${result.platform}`, '');
        for (const issue of result.issues) lines.push(`- ${issue.message}`);
    }
    lines.push('', '## 限制', '', ...report.limitations.map(item => `- ${item}`), '');
    return lines.join('\n');
}

async function run(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(HELP);
        return 0;
    }
    const contract = JSON.parse(await fs.readFile(path.resolve(options.spec), 'utf8'));
    const root = path.resolve(options.root);
    const report = verifySource(contract, await collectSources(root), root);
    const output = options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatMarkdown(report);
    if (options.out) {
        await fs.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
        await fs.writeFile(options.out, output, 'utf8');
    }
    else process.stdout.write(output);
    return report.summary.failed === 0 ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    run().then(code => { process.exitCode = code; }).catch(error => {
        process.stderr.write(`Error: ${error.message}\n`);
        process.exitCode = error.isUsageError ? 2 : 3;
    });
}

export { collectSources, formatMarkdown, normalizeTargets, parseArgs, run, verifySource, verifyTarget };
