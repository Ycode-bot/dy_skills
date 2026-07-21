import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const IGNORED_DIRECTORIES = new Set([
    '.git', '.next', '.nuxt', '.output', '.turbo', 'coverage', 'dist', 'build',
    'node_modules', 'public', 'vendor',
]);
const TEXT_EXTENSIONS = new Set([
    '.cjs', '.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.svelte',
    '.ts', '.tsx', '.vue', '.yaml', '.yml',
]);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_EVIDENCE = 12;

const PLATFORM_RULES = {
    sensors: {
        label: 'Sensors Analytics',
        dependency: /sensors|sa-sdk|@joyme\/sensors-data/i,
        marker: /SensorsData|sensors[_-]?data|KEWLSensors|sa\.track|server_url[^\n]*\/sa\?/i,
        direct: /(?:window\.)?KEWLSensors\.track|sensors(?:Data)?\.track/i,
    },
    ga4: {
        label: 'GA4',
        dependency: /google-analytics|gtag|react-ga|vue-gtag/i,
        marker: /google-analytics\.com|gtag\s*\(|measurement[_-]?id|\bG-[A-Z0-9]+/i,
        direct: /gtag\s*\(\s*['"]event['"]/i,
    },
    gtm: {
        label: 'Google Tag Manager',
        dependency: /google-tag-manager|gtm/i,
        marker: /googletagmanager|dataLayer\s*\.\s*push|\bGTM-[A-Z0-9]+/i,
        direct: /dataLayer\s*\.\s*push/i,
    },
    google_ads: {
        label: 'Google Ads',
        dependency: /google-ads|gtag/i,
        marker: /\bAW-[A-Z0-9]+|google_conversion|send_to[^\n]*AW-/i,
        direct: /gtag\s*\(\s*['"]event['"][^\n]*send_to[^\n]*AW-/i,
    },
    segment: {
        label: 'Segment',
        dependency: /@segment|analytics-next/i,
        marker: /analytics\.(?:track|identify|page)\s*\(/i,
        direct: /analytics\.track\s*\(/i,
    },
    mixpanel: {
        label: 'Mixpanel',
        dependency: /mixpanel/i,
        marker: /mixpanel\.(?:init|track|identify)\s*\(/i,
        direct: /mixpanel\.track\s*\(/i,
    },
    amplitude: {
        label: 'Amplitude',
        dependency: /@amplitude|amplitude-js/i,
        marker: /amplitude\.(?:init|track|identify)\s*\(/i,
        direct: /amplitude\.track\s*\(/i,
    },
    posthog: {
        label: 'PostHog',
        dependency: /posthog/i,
        marker: /posthog\.(?:init|capture|identify)\s*\(/i,
        direct: /posthog\.capture\s*\(/i,
    },
};

const HELP = `Tracking architecture scanner

Usage:
  node scripts/scan-tracking-project.mjs [--root <project>] [--format markdown|json] [--out <path>]

Options:
  --root <path>       Project root; defaults to the current directory
  --format <format>   markdown or json; defaults to markdown
  --out <path>        Write the report instead of stdout
  --help              Show this help
`;

function usage(message) {
    const error = new Error(message);
    error.isUsageError = true;
    throw error;
}

function parseArgs(argv) {
    const options = { root: process.cwd(), format: 'markdown', out: '', help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help') options.help = true;
        else if (arg === '--root') options.root = argv[++index];
        else if (arg === '--format') options.format = argv[++index];
        else if (arg === '--out') options.out = argv[++index];
        else usage(`unknown argument: ${arg}`);
    }
    if (!options.help && !options.root) usage('--root requires a value');
    if (!['markdown', 'json'].includes(options.format)) usage('--format must be markdown or json');
    return options;
}

async function collectFiles(root) {
    const files = [];
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
                if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolute);
                continue;
            }
            if (!entry.isFile()) continue;
            const extension = path.extname(entry.name).toLowerCase();
            if (!TEXT_EXTENSIONS.has(extension) && entry.name !== 'package.json') continue;
            try {
                const stat = await fs.stat(absolute);
                if (stat.size <= MAX_FILE_BYTES) files.push(absolute);
            }
            catch {
                // A concurrently removed file is not evidence.
            }
        }
    }
    await visit(root);
    return files;
}

function relative(root, file) {
    return path.relative(root, file).split(path.sep).join('/');
}

function sample(values) {
    return [...new Set(values)].sort().slice(0, MAX_EVIDENCE);
}

function looksLikeInfrastructure(file) {
    return /(?:^|\/)(?:analytics|telemetry|tracking?|sensors?|gtag|plugins?|providers?)(?:\/|\.|-)|(?:^|\/)lib\/track/i.test(file);
}

function looksLikeSourceCode(file) {
    return ['.cjs', '.js', '.jsx', '.mjs', '.svelte', '.ts', '.tsx', '.vue'].includes(path.extname(file).toLowerCase());
}

function looksLikeProductionSource(file) {
    return looksLikeSourceCode(file)
        && !/(?:^|\/)(?:__tests__|fixtures?|mocks?|tests?)(?:\/|$)|\.(?:spec|test)\.[^.]+$/i.test(file);
}

function looksLikeInitialization(text) {
    return /\binit\s*\(|initialize|createAnalytics|use\s*\(|server_url|measurement[_-]?id|GTM-[A-Z0-9]+/i.test(text);
}

function looksLikeTransport(text, platform) {
    if (platform === 'gtm') return /function\s+\w*(?:track|push)|(?:export\s+)?const\s+\w*(?:track|push)[^=]*=/i.test(text);
    return /function\s+\w*track|(?:export\s+)?const\s+\w*track[^=]*=|\btrack\s*:\s*\(/i.test(text);
}

function findBusinessWrappers(text) {
    const names = [];
    const expression = /(?:export\s+)?(?:async\s+)?function\s+(track[A-Z][A-Za-z0-9_]*)|(?:export\s+)?const\s+(track[A-Z][A-Za-z0-9_]*)\s*=/g;
    for (const match of text.matchAll(expression)) names.push(match[1] || match[2]);
    return names;
}

async function readProject(root) {
    const absoluteRoot = path.resolve(root);
    const filePaths = await collectFiles(absoluteRoot);
    const files = [];
    for (const filePath of filePaths) {
        try {
            files.push({ path: relative(absoluteRoot, filePath), text: await fs.readFile(filePath, 'utf8') });
        }
        catch {
            // Unreadable files are omitted and never treated as negative proof.
        }
    }
    return { root: absoluteRoot, files };
}

function packageDependencies(files) {
    const dependencies = new Map();
    for (const file of files.filter(item => item.path.endsWith('package.json'))) {
        try {
            const manifest = JSON.parse(file.text);
            for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
                for (const name of Object.keys(manifest[section] || {})) dependencies.set(name, file.path);
            }
        }
        catch {
            // Invalid manifests will surface through the project's own checks.
        }
    }
    return dependencies;
}

function inspectPlatform(platform, rule, files, dependencies) {
    const dependencyEvidence = [...dependencies.entries()]
        .filter(([name]) => rule.dependency.test(name))
        .map(([name, manifest]) => `${manifest}: ${name}`);
    const markerFiles = files.filter(file => looksLikeProductionSource(file.path) && rule.marker.test(file.text));
    const initialization = markerFiles.filter(file => looksLikeInitialization(file.text)).map(file => file.path);
    const transports = markerFiles
        .filter(file => looksLikeInfrastructure(file.path) && looksLikeTransport(file.text, platform))
        .map(file => file.path);
    const wrappers = [];
    const wrapperNames = [];
    for (const file of files.filter(item => looksLikeProductionSource(item.path) && looksLikeInfrastructure(item.path))) {
        for (const name of findBusinessWrappers(file.text)) {
            wrappers.push(`${file.path}#${name}`);
            wrapperNames.push(name);
        }
    }
    const callSites = files
        .filter(file => looksLikeProductionSource(file.path) && !looksLikeInfrastructure(file.path))
        .filter(file => rule.marker.test(file.text) || wrapperNames.some(name => file.text.includes(name)))
        .map(file => file.path);
    const directCalls = markerFiles
        .filter(file => looksLikeProductionSource(file.path) && !looksLikeInfrastructure(file.path) && rule.direct.test(file.text))
        .map(file => file.path);
    const hasSignal = dependencyEvidence.length > 0 || markerFiles.length > 0;
    let status = 'absent';
    if (hasSignal) {
        status = initialization.length > 0 && transports.length > 0 && callSites.length > 0
            ? 'established'
            : 'partial';
    }
    return {
        label: rule.label,
        status,
        confidence: status === 'absent' ? 'medium' : dependencyEvidence.length > 0 && markerFiles.length > 0 ? 'high' : 'medium',
        dependencies: sample(dependencyEvidence),
        initialization: sample(initialization),
        transports: sample(transports),
        wrappers: sample(wrappers),
        callSites: sample(callSites),
        directCalls: sample(directCalls),
    };
}

function scanProject(project) {
    const dependencies = packageDependencies(project.files);
    const platforms = {};
    const risks = [];
    for (const [platform, rule] of Object.entries(PLATFORM_RULES)) {
        const result = inspectPlatform(platform, rule, project.files, dependencies);
        platforms[platform] = result;
        if (result.directCalls.length > 0) {
            risks.push({
                code: 'DIRECT_SDK_CALLS',
                platform,
                message: '业务文件中发现可能绕过统一封装的直接 SDK 调用，请人工确认。',
                evidence: result.directCalls,
            });
        }
    }
    const present = Object.values(platforms).filter(platform => platform.status !== 'absent');
    const classification = present.length === 0
        ? 'absent'
        : present.some(platform => platform.status === 'partial')
            ? 'partial'
            : 'established';
    const trackingFiles = project.files.filter(file => /track|analytics|sensor|telemetry|gtag|dataLayer/i.test(`${file.path}\n${file.text}`));
    const identity = sample(trackingFiles.filter(file => /identify|login\s*\(|logout\s*\(|reset\s*\(|distinct[_-]?id|anonymous[_-]?id/i.test(file.text)).map(file => file.path));
    const documentation = sample(project.files.filter(file => /\.md$/i.test(file.path) && /tracking|analytics|埋点|事件字典|数据字典/i.test(file.text)).map(file => file.path));
    const validation = sample(project.files.filter(file => /(?:test|spec|check|lint)/i.test(file.path) && /track|analytics|sensor|gtag|dataLayer/i.test(file.text)).map(file => file.path));

    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        root: project.root,
        classification,
        platforms,
        foundations: { identity, documentation, validation },
        risks,
        limitations: [
            '静态扫描只提供带路径的证据，不证明运行时初始化、路由或入库一定成功。',
            'absent 表示未发现可信信号；生成文件、远程 Tag Manager 配置和运行时注入可能不在扫描范围内。',
        ],
    };
}

function formatMarkdown(report) {
    const lines = [
        '# 项目埋点体系扫描报告', '',
        `- 项目：${report.root}`,
        `- 生成时间：${report.generatedAt}`,
        `- 总体分类：${report.classification}`, '',
        '| 平台 | 状态 | 置信度 | 初始化 | 传输/封装 | 业务调用点 |',
        '|---|---|---|---:|---:|---:|',
    ];
    for (const platform of Object.values(report.platforms)) {
        lines.push(`| ${platform.label} | ${platform.status} | ${platform.confidence} | ${platform.initialization.length} | ${platform.transports.length + platform.wrappers.length} | ${platform.callSites.length} |`);
    }
    const present = Object.entries(report.platforms).filter(([, platform]) => platform.status !== 'absent');
    for (const [key, platform] of present) {
        lines.push('', `## ${platform.label} · ${platform.status}`, '');
        for (const [label, evidence] of [
            ['依赖', platform.dependencies], ['初始化', platform.initialization], ['传输层', platform.transports],
            ['业务封装', platform.wrappers], ['调用点', platform.callSites],
        ]) {
            lines.push(`- ${label}：${evidence.length > 0 ? evidence.map(item => `\`${item}\``).join('、') : '未发现'}`);
        }
    }
    if (report.risks.length > 0) {
        lines.push('', '## 风险', '');
        for (const risk of report.risks) lines.push(`- ${risk.platform}/${risk.code}：${risk.message} ${risk.evidence.join('、')}`);
    }
    lines.push('', '## 基础能力', '',
        `- 身份处理证据：${report.foundations.identity.length || 0} 个文件`,
        `- 埋点文档证据：${report.foundations.documentation.length || 0} 个文件`,
        `- 自动校验证据：${report.foundations.validation.length || 0} 个文件`, '',
        '## 限制', '', ...report.limitations.map(item => `- ${item}`), '');
    return lines.join('\n');
}

async function run(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(HELP);
        return 0;
    }
    const report = scanProject(await readProject(options.root));
    const output = options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatMarkdown(report);
    if (options.out) {
        await fs.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
        await fs.writeFile(options.out, output, 'utf8');
    }
    else process.stdout.write(output);
    return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    run().then(code => { process.exitCode = code; }).catch(error => {
        process.stderr.write(`Error: ${error.message}\n`);
        process.exitCode = error.isUsageError ? 2 : 3;
    });
}

export { formatMarkdown, inspectPlatform, parseArgs, readProject, run, scanProject };
