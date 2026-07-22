#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const DEFAULT_QUERY_PATH = '/api/sql/query';
const DEFAULT_OPENAPI_QUERY_PATH = '/api/v3/analytics/v1/model/sql/query';
const DEFAULT_LIMIT = 100;
const DEFAULT_SINCE_MINUTES = 30;
const DEFAULT_CREDENTIALS_FILE = path.join(os.homedir(), '.config', 'imastudio', 'sensors-credentials.json');
const SENSITIVE_FIELD_PATTERN = /(token|secret|password|authorization|cookie|email|phone|mobile|account|userinfo)/i;
const ENVIRONMENT_NAMES = new Set(['local', 'qa', 'production']);

const HELP_TEXT = `Sensors Analytics event verifier

Compare a normalized tracking contract with captured events or query Sensors Analytics.
Secrets are read only from environment variables or a private Profile JSON and are never accepted as CLI arguments.

Usage:
  node scripts/verify-sensors-events.mjs --spec <contract.json> --actual <events.json|ndjson>
  node scripts/verify-sensors-events.mjs --spec <contract.json> --query [options]

Required:
  --spec <path>                  Normalized tracking contract JSON
  --actual <path>               Captured JSON/NDJSON events for offline verification
  --query                       Query Sensors Analytics instead of reading --actual

Query options:
  --credentials <path>          Profile JSON; env SENSORS_QUERY_CREDENTIALS_FILE
  --profile <name>              Profile name; defaults to file's default_profile
  --base-url <url>              Query service base URL; env SENSORS_QUERY_BASE_URL
  --project <name>              Sensors project; env SENSORS_QUERY_PROJECT
  --query-path <path>           Override profile path; default: /api/sql/query
  --auth-mode <mode>            token-query, openapi, bearer, or header
  --api-key-header <name>       Header mode only; default: X-API-Key
  --since-minutes <n>           Query window; default: contract value or 30
  --distinct-id <id>            Narrow all contracts to one test identity
  --environment <name>          local, qa, or production
  --environment-value <value>   URL host substring without protocol/path; e.g. localhost:3000
  --environment-host <host>     Compatibility alias for --environment-value
  --environment-property <key>  Property used for environment; contract or lmweb_url
  --limit <n>                   Per-contract row limit; default 100, maximum 1000
  --timeout-ms <n>              Request timeout; default 30000
  --dry-run                     Print redacted endpoint and SQL without querying

Output options:
  --format <markdown|json>       Default: markdown
  --out <path>                  Write report to a file instead of stdout
  --help                        Show this help

Credential environment variables:
  profile file: SENSORS_QUERY_CREDENTIALS_FILE (fallback: ~/.config/imastudio/sensors-credentials.json)
  token-query: SENSORS_QUERY_API_SECRET (fallback SENSORS_QUERY_TOKEN or SENSORS_API_KEY)
  bearer/header: SENSORS_QUERY_API_KEY (fallback SENSORS_API_KEY)

Compatibility environment variables:
  SENSORS_API_BASE_URL and SENSORS_PROJECT are accepted as fallbacks.

Credential profile shape:
  {"default_profile":"prod","profiles":{"prod":{"hosts":["https://host"],"project":"name","api_key":"..."}}}
  A 35-character #K- API Key automatically selects openapi mode.
`;

function fail(message) {
    const error = new Error(message);
    error.isUsageError = true;
    throw error;
}

function parseArgs(argv) {
    const options = {
        spec: '',
        actual: '',
        query: false,
        credentials: '',
        profile: '',
        baseUrl: '',
        project: '',
        queryPath: '',
        authMode: '',
        apiKeyHeader: '',
        sinceMinutes: undefined,
        distinctId: '',
        environment: '',
        environmentValue: '',
        environmentHost: '',
        environmentProperty: '',
        limit: DEFAULT_LIMIT,
        timeoutMs: 30000,
        format: 'markdown',
        out: '',
        dryRun: false,
        help: false,
    };

    const valueOptions = new Set([
        '--spec',
        '--actual',
        '--credentials',
        '--profile',
        '--base-url',
        '--project',
        '--query-path',
        '--auth-mode',
        '--api-key-header',
        '--since-minutes',
        '--distinct-id',
        '--environment',
        '--environment-value',
        '--environment-host',
        '--environment-property',
        '--limit',
        '--timeout-ms',
        '--format',
        '--out',
    ]);

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help') {
            options.help = true;
            continue;
        }
        if (arg === '--query') {
            options.query = true;
            continue;
        }
        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }
        if (!valueOptions.has(arg)) {
            fail(`unknown option: ${arg}`);
        }
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
            fail(`missing value for ${arg}`);
        }
        index += 1;
        const keyMap = {
            '--spec': 'spec',
            '--actual': 'actual',
            '--credentials': 'credentials',
            '--profile': 'profile',
            '--base-url': 'baseUrl',
            '--project': 'project',
            '--query-path': 'queryPath',
            '--auth-mode': 'authMode',
            '--api-key-header': 'apiKeyHeader',
            '--distinct-id': 'distinctId',
            '--environment': 'environment',
            '--environment-value': 'environmentValue',
            '--environment-host': 'environmentHost',
            '--environment-property': 'environmentProperty',
            '--format': 'format',
            '--out': 'out',
        };
        if (arg === '--since-minutes') {
            options.sinceMinutes = Number.parseInt(value, 10);
        }
        else if (arg === '--limit') {
            options.limit = Number.parseInt(value, 10);
        }
        else if (arg === '--timeout-ms') {
            options.timeoutMs = Number.parseInt(value, 10);
        }
        else {
            options[keyMap[arg]] = value;
        }
    }

    return options;
}

function validateOptions(options) {
    if (options.help) {
        return;
    }
    if (!options.spec) {
        fail('--spec is required');
    }
    if (Boolean(options.actual) === Boolean(options.query)) {
        fail('choose exactly one source: --actual or --query');
    }
    if (options.authMode && !['token-query', 'openapi', 'bearer', 'header'].includes(options.authMode)) {
        fail('--auth-mode must be token-query, openapi, bearer, or header');
    }
    if (!['markdown', 'json'].includes(options.format)) {
        fail('--format must be markdown or json');
    }
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) {
        fail('--limit must be an integer between 1 and 1000');
    }
    if (options.sinceMinutes !== undefined && (!Number.isInteger(options.sinceMinutes) || options.sinceMinutes < 1)) {
        fail('--since-minutes must be a positive integer');
    }
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) {
        fail('--timeout-ms must be an integer of at least 1000');
    }
    if (options.environment && !ENVIRONMENT_NAMES.has(options.environment)) {
        fail('--environment must be local, qa, or production');
    }
    if (options.environmentHost && options.environmentValue && options.environmentHost !== options.environmentValue) {
        fail('--environment-host and --environment-value must not conflict');
    }
    if (options.environment || options.environmentHost || options.environmentValue || options.environmentProperty) {
        if (!options.query) {
            fail('environment options are only supported with --query');
        }
    }
}

function validateEnvironmentValue(value) {
    if (!value) return;
    if (value.length > 253 || !/^(?:localhost|[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::\d{1,5})?$/.test(value)) {
        fail('--environment-value must be a host or host:port without protocol, path, query, or wildcard');
    }
    const port = value.match(/\]:(\d+)$/)?.[1] || value.match(/^[^:]+:(\d+)$/)?.[1];
    if (port && (Number(port) < 1 || Number(port) > 65535)) {
        fail('--environment-value port must be between 1 and 65535');
    }
}

function resolveEnvironmentOptions(rawContract, options) {
    const profiles = rawContract.environments || {};
    const profileNames = Object.keys(profiles);
    if (options.query && profileNames.length > 1 && !options.environment) {
        fail('--environment is required when the contract defines multiple environments');
    }
    const profile = options.environment ? profiles[options.environment] : null;
    if (options.environment && profileNames.length > 0 && !profile) {
        fail(`contract does not define environment: ${options.environment}`);
    }
    const query = profile?.query || {};
    let profileValue = query.value || '';
    if (!profileValue && query.valueFrom === 'browser-host' && profile?.startUrl) {
        try {
            profileValue = new URL(profile.startUrl).host;
        }
        catch {
            fail(`contract environment ${options.environment}.startUrl must be a valid URL`);
        }
    }
    const environmentValue = options.environmentValue || options.environmentHost || profileValue;
    const environmentProperty = options.environmentProperty || query.property || 'lmweb_url';
    if (options.environment && !environmentValue) {
        fail(`environment ${options.environment} requires --environment-value or a contract query value`);
    }
    validateEnvironmentValue(environmentValue);
    if (environmentValue) quoteSqlIdentifier(environmentProperty);
    return {
        ...options,
        environmentValue,
        environmentProperty,
        environmentIdentityRequired: Boolean(profile?.identityRequired),
    };
}

async function readJsonFile(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    try {
        return JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`invalid JSON in ${filePath}: ${error.message}`);
    }
}

function normalizeCredentialDocument(raw, requestedProfile = '') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        fail('credentials root must be a JSON object');
    }
    if (!raw.profiles || typeof raw.profiles !== 'object' || Array.isArray(raw.profiles)) {
        fail('credentials.profiles must be an object');
    }
    const profileName = requestedProfile || raw.default_profile;
    if (typeof profileName !== 'string' || !profileName) {
        fail('choose --profile or set credentials.default_profile');
    }
    const profile = raw.profiles[profileName];
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        fail(`credentials profile not found: ${profileName}`);
    }
    const hosts = Array.isArray(profile.hosts) ? profile.hosts : [profile.hosts].filter(Boolean);
    if (hosts.length === 0 || hosts.some(host => typeof host !== 'string' || !host.trim())) {
        fail(`credentials profile ${profileName}.hosts must contain at least one URL`);
    }
    const normalizedHosts = hosts.map(host => {
        let parsed;
        try {
            parsed = new URL(host);
        }
        catch {
            fail(`credentials profile ${profileName} contains an invalid host URL`);
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            fail(`credentials profile ${profileName} hosts must use http or https`);
        }
        return parsed.toString().replace(/\/$/, '');
    });
    if (typeof profile.project !== 'string' || !profile.project.trim()) {
        fail(`credentials profile ${profileName}.project is required`);
    }
    if (profile.api_key !== undefined && typeof profile.api_key !== 'string') {
        fail(`credentials profile ${profileName}.api_key must be a string`);
    }
    const authMode = profile.auth_mode || (/^#k-/i.test(profile.api_key || '') ? 'openapi' : 'token-query');
    if (!['token-query', 'openapi', 'bearer', 'header'].includes(authMode)) {
        fail(`credentials profile ${profileName}.auth_mode must be token-query, openapi, bearer, or header`);
    }

    return {
        name: profileName,
        hosts: normalizedHosts,
        project: profile.project.trim(),
        apiKey: profile.api_key || '',
        authMode,
        apiKeyHeader: profile.api_key_header || 'X-API-Key',
        queryPath: profile.query_path || '',
    };
}

function looksLikePlaceholder(value) {
    const text = String(value || '').trim();
    return !text
        || /(^|[_<\s-])(your|example|replace|changeme|placeholder)([_>\s-]|$)/i.test(text)
        || /^x+$/i.test(text)
        || /\.example\.(com|org|net)(?:[:/]|$)/i.test(text);
}

async function loadCredentialProfile(filePath, profileName, dryRun = false) {
    const resolved = path.resolve(filePath);
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
        fail(`credentials path is not a file: ${filePath}`);
    }
    if (!dryRun && process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
        fail(`credentials file permissions are too broad; run: chmod 600 ${resolved}`);
    }
    const profile = normalizeCredentialDocument(await readJsonFile(resolved), profileName);
    if (!dryRun && (
        looksLikePlaceholder(profile.project)
        || looksLikePlaceholder(profile.apiKey)
        || profile.hosts.some(looksLikePlaceholder)
    )) {
        fail(`credentials profile ${profile.name} still contains example placeholders; copy the example and replace hosts, project, and api_key`);
    }
    return profile;
}

async function resolveCredentialsFile(options, env = process.env, defaultPath = DEFAULT_CREDENTIALS_FILE) {
    if (options.credentials) {
        return path.resolve(options.credentials);
    }
    if (env.SENSORS_QUERY_CREDENTIALS_FILE) {
        return path.resolve(env.SENSORS_QUERY_CREDENTIALS_FILE);
    }
    try {
        const stat = await fs.stat(defaultPath);
        return stat.isFile() ? path.resolve(defaultPath) : '';
    }
    catch {
        return '';
    }
}

function parseEventRows(raw) {
    if (Array.isArray(raw)) {
        return raw;
    }
    if (raw && Array.isArray(raw.events)) {
        return raw.events;
    }
    if (raw && typeof raw === 'object') {
        return [raw];
    }
    if (typeof raw !== 'string') {
        throw new Error('event input must be a JSON object, array, or NDJSON text');
    }

    const trimmed = raw.trim();
    if (!trimmed) {
        return [];
    }
    try {
        return parseEventRows(JSON.parse(trimmed));
    }
    catch {
        return trimmed.split(/\r?\n/).filter(Boolean).map((line, index) => {
            try {
                return JSON.parse(line);
            }
            catch (error) {
                throw new Error(`invalid NDJSON at line ${index + 1}: ${error.message}`);
            }
        });
    }
}

async function readActualEvents(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    return parseEventRows(raw);
}

function normalizeContract(raw, selectedEnvironment = '') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        fail('contract root must be a JSON object');
    }
    if (!Array.isArray(raw.events) || raw.events.length === 0) {
        fail('contract.events must contain at least one event');
    }

    const defaults = raw.defaults || {};
    const sensorEvents = raw.events.flatMap((event, index) => {
        if (!event || typeof event !== 'object' || Array.isArray(event)) {
            fail(`contract.events[${index}] must be an object`);
        }
        if (!event.targets) {
            return [{ source: event, index }];
        }
        const target = event.targets.sensors;
        const status = target?.status || 'unknown';
        if (!target || status !== 'required') {
            return [];
        }
        const environmentRequirement = selectedEnvironment
            ? event.validation?.environments?.[selectedEnvironment]
            : null;
        if (environmentRequirement?.status === 'unknown') {
            fail(`event ${event.id || index + 1} environment ${selectedEnvironment} is unknown`);
        }
        if (['optional', 'disabled'].includes(environmentRequirement?.status)) {
            return [];
        }
        return [{
            index,
            source: {
                ...target,
                id: event.id,
                trigger: event.trigger,
                minCount: target.minCount ?? event.deduplication?.minCount,
                maxCount: target.maxCount ?? event.deduplication?.maxCount,
                sinceMinutes: target.sinceMinutes,
                testIdentityRequired: event.validation?.testIdentityRequired === true,
                environmentRequirement,
            },
        }];
    });
    if (sensorEvents.length === 0) {
        fail('contract does not contain a required Sensors target');
    }

    const events = sensorEvents.map(({ source: event, index }) => {
        if (!event || typeof event !== 'object' || Array.isArray(event)) {
            fail(`contract.events[${index}] must be an object`);
        }
        if (typeof event.event !== 'string' || !event.event.trim()) {
            fail(`contract.events[${index}].event is required`);
        }
        const properties = event.properties || {};
        const match = event.match || {};
        if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
            fail(`contract.events[${index}].properties must be an object`);
        }
        if (!match || typeof match !== 'object' || Array.isArray(match)) {
            fail(`contract.events[${index}].match must be an object`);
        }
        for (const [name, rule] of Object.entries(properties)) {
            if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
                fail(`property rule ${name} must be an object`);
            }
            if (rule.type && !['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(rule.type)) {
                fail(`unsupported type for property ${name}: ${rule.type}`);
            }
            if (rule.oneOf && !Array.isArray(rule.oneOf)) {
                fail(`property ${name}.oneOf must be an array`);
            }
            if (rule.pattern) {
                try {
                    new RegExp(rule.pattern);
                }
                catch (error) {
                    fail(`invalid pattern for property ${name}: ${error.message}`);
                }
            }
        }

        const minCount = event.minCount ?? defaults.minCount ?? 1;
        const maxCount = event.maxCount ?? defaults.maxCount ?? 1;
        if (!Number.isInteger(minCount) || minCount < 0) {
            fail(`event ${event.event}.minCount must be a non-negative integer`);
        }
        if (!Number.isInteger(maxCount) || maxCount < minCount) {
            fail(`event ${event.event}.maxCount must be an integer >= minCount`);
        }

        return {
            id: event.id || `${event.event}-${index + 1}`,
            event: event.event,
            trigger: event.trigger || '',
            distinctId: event.distinctId || '',
            testIdentityRequired: event.testIdentityRequired === true,
            environmentRequirement: event.environmentRequirement || null,
            minCount,
            maxCount,
            sinceMinutes: event.sinceMinutes ?? defaults.sinceMinutes ?? DEFAULT_SINCE_MINUTES,
            match,
            properties,
        };
    });

    return { version: raw.version || 1, environments: raw.environments || {}, events };
}

function enforceIdentityRequirements(contract, options) {
    if (!options.query) return;
    for (const expected of contract.events) {
        const required = options.environmentIdentityRequired || expected.testIdentityRequired;
        if (required && !(options.distinctId || expected.distinctId)) {
            fail(`event ${expected.id} requires --distinct-id for ${options.environment || 'live'} verification`);
        }
    }
}

function getEventName(row) {
    return row?.event ?? row?.event_name ?? row?.name;
}

function getDistinctId(row) {
    return row?.distinct_id ?? row?.distinctId ?? row?.properties?.distinct_id;
}

function getProperty(row, name) {
    if (row?.properties && Object.prototype.hasOwnProperty.call(row.properties, name)) {
        return row.properties[name];
    }
    return row?.[name];
}

function valueType(value) {
    if (Array.isArray(value)) {
        return 'array';
    }
    if (value === null) {
        return 'null';
    }
    if (Number.isInteger(value)) {
        return 'integer';
    }
    return typeof value;
}

function matchesType(value, expectedType) {
    if (!expectedType) {
        return true;
    }
    if (expectedType === 'integer') {
        return Number.isInteger(value);
    }
    if (expectedType === 'number') {
        return typeof value === 'number' && Number.isFinite(value);
    }
    if (expectedType === 'array') {
        return Array.isArray(value);
    }
    if (expectedType === 'object') {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }
    return typeof value === expectedType;
}

function redactValue(name, value) {
    if (SENSITIVE_FIELD_PATTERN.test(name)) {
        return '[REDACTED]';
    }
    if (name === 'distinct_id' || name === 'distinctId') {
        const text = String(value ?? '');
        return text.length <= 4 ? '[REDACTED]' : `${text.slice(0, 2)}…${text.slice(-2)}`;
    }
    if (typeof value === 'string' && value.length > 160) {
        return `${value.slice(0, 157)}…`;
    }
    return value;
}

function inspectEvent(row, expected) {
    const issues = [];
    for (const [name, rule] of Object.entries(expected.properties)) {
        const value = getProperty(row, name);
        const exists = value !== undefined && value !== null;
        if (rule.required !== false && !exists) {
            issues.push({ property: name, code: 'MISSING', message: '缺少必填属性' });
            continue;
        }
        if (!exists) {
            continue;
        }
        if (!matchesType(value, rule.type)) {
            issues.push({
                property: name,
                code: 'TYPE_MISMATCH',
                message: `类型应为 ${rule.type}，实际为 ${valueType(value)}`,
                actual: redactValue(name, value),
            });
        }
        if (Object.prototype.hasOwnProperty.call(rule, 'equals') && !isDeepStrictEqual(value, rule.equals)) {
            issues.push({
                property: name,
                code: 'VALUE_MISMATCH',
                message: '属性值与文档要求不一致',
                expected: redactValue(name, rule.equals),
                actual: redactValue(name, value),
            });
        }
        if (rule.oneOf && !rule.oneOf.some(candidate => isDeepStrictEqual(candidate, value))) {
            issues.push({
                property: name,
                code: 'ENUM_MISMATCH',
                message: '属性值不在允许枚举中',
                expected: rule.oneOf.map(candidate => redactValue(name, candidate)),
                actual: redactValue(name, value),
            });
        }
        if (rule.pattern && typeof value === 'string' && !new RegExp(rule.pattern).test(value)) {
            issues.push({
                property: name,
                code: 'PATTERN_MISMATCH',
                message: `属性值不匹配正则 ${rule.pattern}`,
                actual: redactValue(name, value),
            });
        }
    }
    return issues;
}

function compareContract(contract, rows, options = {}) {
    const results = contract.events.map(expected => {
        const distinctId = options.distinctId || expected.distinctId;
        const candidates = rows.filter(row => {
            if (getEventName(row) !== expected.event) {
                return false;
            }
            if (distinctId && String(getDistinctId(row)) !== String(distinctId)) {
                return false;
            }
            return Object.entries(expected.match).every(([name, value]) => isDeepStrictEqual(getProperty(row, name), value));
        });
        const inspected = candidates.map(row => inspectEvent(row, expected));
        const passingCount = inspected.filter(issues => issues.length === 0).length;
        let status = 'PASS';
        const issues = [];

        if (candidates.length === 0) {
            status = 'NOT_FOUND';
            issues.push({ code: 'NOT_FOUND', message: '未找到符合事件名和测试身份的入库事件' });
        }
        else if (candidates.length > expected.maxCount) {
            status = 'DUPLICATED';
            issues.push({
                code: 'COUNT_EXCEEDED',
                message: `期望最多 ${expected.maxCount} 条，实际 ${candidates.length} 条`,
            });
        }
        else if (candidates.length < expected.minCount) {
            status = 'COUNT_MISMATCH';
            issues.push({
                code: 'COUNT_BELOW_MINIMUM',
                message: `期望至少 ${expected.minCount} 条，实际 ${candidates.length} 条`,
            });
        }
        else if (passingCount === 0) {
            status = 'CONTRACT_MISMATCH';
            issues.push(...(inspected[0] || []));
        }

        return {
            id: expected.id,
            event: expected.event,
            trigger: expected.trigger,
            status,
            candidateCount: candidates.length,
            passingCount,
            expectedCount: { min: expected.minCount, max: expected.maxCount },
            issues,
        };
    });

    return {
        generatedAt: new Date().toISOString(),
        summary: {
            total: results.length,
            passed: results.filter(result => result.status === 'PASS').length,
            failed: results.filter(result => result.status !== 'PASS').length,
        },
        results,
    };
}

function escapeSqlLiteral(value) {
    return String(value).replaceAll("'", "''");
}

function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatLocalDateTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
    return `${formatLocalDate(date)} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function quoteSqlIdentifier(name) {
    if (!/^\$?[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        fail(`unsupported Sensors property name in match: ${name}`);
    }
    return `\`${name.replaceAll('`', '``')}\``;
}

function formatSqlValue(value) {
    if (typeof value === 'string') {
        return `'${escapeSqlLiteral(value)}'`;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE';
    }
    fail('match values must be strings, finite numbers, or booleans');
}

function buildSensorsSql(expected, options = {}) {
    const sinceMinutes = options.sinceMinutes ?? expected.sinceMinutes ?? DEFAULT_SINCE_MINUTES;
    const now = options.now || new Date();
    const from = new Date(now.getTime() - sinceMinutes * 60 * 1000);
    const distinctId = options.distinctId || expected.distinctId;
    const partitionCondition = options.authMode === 'openapi'
        ? `day BETWEEN ${Math.floor(from.getTime() / 86400000) - 1} AND ${Math.floor(now.getTime() / 86400000) + 1}`
        : `date BETWEEN '${formatLocalDate(from)}' AND '${formatLocalDate(now)}'`;
    const conditions = [
        partitionCondition,
        `time >= '${formatLocalDateTime(from)}'`,
        `event = '${escapeSqlLiteral(expected.event)}'`,
    ];
    if (distinctId) {
        conditions.push(`distinct_id = '${escapeSqlLiteral(distinctId)}'`);
    }
    for (const [name, value] of Object.entries(expected.match || {})) {
        conditions.push(`${quoteSqlIdentifier(name)} = ${formatSqlValue(value)}`);
    }
    const environmentValue = options.environmentValue || options.environmentHost;
    if (environmentValue) {
        conditions.push(`${quoteSqlIdentifier(options.environmentProperty || 'lmweb_url')} LIKE '%${escapeSqlLiteral(environmentValue)}%'`);
    }
    return `SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY time DESC LIMIT ${options.limit || DEFAULT_LIMIT}`;
}

function resolveQueryConfig(options, env = process.env) {
    const profile = options.credentialProfile || {};
    const environmentBaseUrl = env.SENSORS_QUERY_BASE_URL || env.SENSORS_API_BASE_URL || '';
    const baseUrls = options.baseUrl
        ? [options.baseUrl]
        : environmentBaseUrl
            ? [environmentBaseUrl]
            : profile.hosts || [];
    const project = options.project || env.SENSORS_QUERY_PROJECT || env.SENSORS_PROJECT || profile.project || '';
    const authMode = options.authMode || profile.authMode || 'token-query';
    const secret = authMode === 'token-query'
        ? env.SENSORS_QUERY_API_SECRET || env.SENSORS_QUERY_TOKEN || env.SENSORS_API_KEY || profile.apiKey || ''
        : env.SENSORS_QUERY_API_KEY || env.SENSORS_API_KEY || profile.apiKey || '';
    const queryPath = options.queryPath
        || profile.queryPath
        || (authMode === 'openapi' ? DEFAULT_OPENAPI_QUERY_PATH : DEFAULT_QUERY_PATH);
    const apiKeyHeader = options.apiKeyHeader || profile.apiKeyHeader || 'X-API-Key';

    if (baseUrls.length === 0) {
        fail('query mode requires --credentials, --base-url, or SENSORS_QUERY_BASE_URL');
    }
    if (!project) {
        fail('query mode requires --project or SENSORS_QUERY_PROJECT');
    }
    if (!options.dryRun && !secret) {
        const expectedName = authMode === 'token-query' ? 'SENSORS_QUERY_API_SECRET' : 'SENSORS_QUERY_API_KEY';
        fail(`query mode requires ${expectedName}; configure it in the shell without passing it on the command line`);
    }
    return { baseUrls, project, authMode, secret, queryPath, apiKeyHeader };
}

function makeEndpoint(config, baseUrl, redacted = false) {
    const base = new URL(baseUrl);
    const endpoint = new URL(config.queryPath, `${base.origin}/`);
    if (config.authMode === 'token-query') {
        endpoint.searchParams.set('token', redacted ? '[REDACTED]' : config.secret);
        endpoint.searchParams.set('project', config.project);
    }
    return endpoint;
}

function parseOpenApiRows(text) {
    const payloads = parseEventRows(text);
    const rows = [];
    for (const payload of payloads) {
        if (payload?.code && payload.code !== 'SUCCESS') {
            throw new Error('Sensors OpenAPI returned an error payload; check SQL, project, API Key permissions, and product version');
        }
        if (getEventName(payload)) {
            rows.push(payload);
            continue;
        }
        const data = payload?.data;
        if (Array.isArray(data?.events)) {
            rows.push(...data.events);
            continue;
        }
        if (Array.isArray(data?.columns) && Array.isArray(data?.data)) {
            const valueRows = Array.isArray(data.data[0]) ? data.data : [data.data];
            for (const values of valueRows) {
                rows.push(Object.fromEntries(data.columns.map((column, index) => [column, values[index]])));
            }
            continue;
        }
        if (Array.isArray(data)) {
            rows.push(...data.filter(item => item && typeof item === 'object'));
        }
    }
    return rows;
}

async function querySensorsEvent(expected, options, env = process.env) {
    const config = resolveQueryConfig(options, env);
    const sql = buildSensorsSql(expected, { ...options, authMode: config.authMode });
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    let body = new URLSearchParams({ q: sql, format: 'json' });
    if (config.authMode === 'openapi') {
        headers['content-type'] = 'application/json';
        headers.accept = 'application/json';
        headers['api-key'] = config.secret;
        headers['sensorsdata-project'] = config.project;
        headers['sensors-language'] = 'ZH-CN';
        body = JSON.stringify({ sql, limit: String(options.limit || DEFAULT_LIMIT) });
    }
    else if (config.authMode === 'bearer') {
        headers.authorization = `Bearer ${config.secret}`;
    }
    else if (config.authMode === 'header') {
        headers[config.apiKeyHeader] = config.secret;
    }
    const failures = [];
    for (const baseUrl of config.baseUrls) {
        const endpoint = makeEndpoint(config, baseUrl);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
        let response;
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body,
                signal: controller.signal,
            });
        }
        catch (error) {
            const reason = error.name === 'AbortError'
                ? `timeout after ${options.timeoutMs || 30000}ms`
                : error.message;
            failures.push(`${new URL(baseUrl).origin}: ${reason}`);
            continue;
        }
        finally {
            clearTimeout(timeout);
        }

        if (!response.ok) {
            const failure = `${new URL(baseUrl).origin}: HTTP ${response.status}`;
            if (![404, 405, 502, 503, 504].includes(response.status)) {
                throw new Error(`Sensors query returned ${failure}; check project, credential, permissions, and SQL`);
            }
            failures.push(failure);
            continue;
        }
        const text = await response.text();
        const rows = config.authMode === 'openapi' ? parseOpenApiRows(text) : parseEventRows(text);
        if (rows.length === 1 && !getEventName(rows[0]) && (rows[0]?.error || rows[0]?.error_message || rows[0]?.status === 'ERROR')) {
            throw new Error('Sensors query returned an API error payload; check SQL, project, credential, and permissions');
        }
        return rows;
    }
    throw new Error(`Sensors query failed for all configured hosts: ${failures.join('; ')}`);
}

async function queryAllEvents(contract, options, env = process.env) {
    const rows = [];
    const cache = new Map();
    for (const expected of contract.events) {
        const cacheKey = JSON.stringify({
            event: expected.event,
            distinctId: options.distinctId || expected.distinctId,
            sinceMinutes: options.sinceMinutes ?? expected.sinceMinutes,
            match: expected.match,
            environment: options.environment,
            environmentValue: options.environmentValue || options.environmentHost,
            environmentProperty: options.environmentProperty,
            limit: options.limit,
        });
        if (!cache.has(cacheKey)) {
            const result = await querySensorsEvent(expected, options, env);
            cache.set(cacheKey, result);
            rows.push(...result);
        }
    }
    return rows;
}

function formatMarkdown(report, sourceLabel) {
    const lines = [
        '# 神策埋点验收报告',
        '',
        `- 生成时间：${report.generatedAt}`,
        `- 数据来源：${sourceLabel}`,
        `- 结果：${report.summary.passed}/${report.summary.total} 通过`,
    ];
    if (report.environment) {
        lines.push(`- 验证环境：\`${report.environment.name}\``);
        lines.push(`- 环境过滤：\`${report.environment.property}\` 包含 \`${report.environment.value}\``);
    }
    lines.push(
        '',
        '| 契约 | 事件 | 状态 | 候选条数 | 通过条数 |',
        '|---|---|---:|---:|---:|',
    );
    for (const result of report.results) {
        lines.push(`| ${result.id} | ${result.event} | ${result.status} | ${result.candidateCount} | ${result.passingCount} |`);
    }
    for (const result of report.results.filter(item => item.issues.length > 0)) {
        lines.push('', `## ${result.id} · ${result.status}`, '');
        for (const issue of result.issues) {
            const property = issue.property ? `\`${issue.property}\`：` : '';
            const expected = issue.expected !== undefined ? `；期望=${JSON.stringify(issue.expected)}` : '';
            const actual = issue.actual !== undefined ? `；实际=${JSON.stringify(issue.actual)}` : '';
            lines.push(`- ${property}${issue.message}${expected}${actual}`);
        }
    }
    lines.push('');
    return lines.join('\n');
}

function formatDryRun(contract, options, env = process.env) {
    const config = resolveQueryConfig({ ...options, dryRun: true }, env);
    const lines = config.baseUrls.map(baseUrl => `Endpoint: ${makeEndpoint(config, baseUrl, true).toString()}`);
    lines.push(`Profile: ${options.credentialProfile?.name || 'environment/CLI'}`, `Auth mode: ${config.authMode}`);
    const environmentValue = options.environmentValue || options.environmentHost;
    if (environmentValue) {
        lines.push(`Environment: ${options.environment || 'custom'}; ${options.environmentProperty || 'lmweb_url'} contains ${environmentValue}`);
    }
    lines.push('');
    for (const expected of contract.events) {
        lines.push(`[${expected.id}]`, buildSensorsSql(expected, { ...options, authMode: config.authMode }), '');
    }
    return lines.join('\n');
}

async function run(argv = process.argv.slice(2), env = process.env) {
    let options = parseArgs(argv);
    validateOptions(options);
    if (options.help) {
        process.stdout.write(HELP_TEXT);
        return 0;
    }

    const rawContract = await readJsonFile(options.spec);
    options = resolveEnvironmentOptions(rawContract, options);

    if (options.query) {
        options = { ...options, credentials: await resolveCredentialsFile(options, env) };
    }

    if (options.credentials) {
        options = {
            ...options,
            credentialProfile: await loadCredentialProfile(options.credentials, options.profile, options.dryRun),
        };
    }

    const contract = normalizeContract(rawContract, options.environment);
    enforceIdentityRequirements(contract, options);
    if (options.query && options.dryRun) {
        const output = formatDryRun(contract, options, env);
        if (options.out) {
            await fs.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
            await fs.writeFile(options.out, output, 'utf8');
        }
        else {
            process.stdout.write(`${output}\n`);
        }
        return 0;
    }

    const rows = options.actual
        ? await readActualEvents(options.actual)
        : await queryAllEvents(contract, options, env);
    const report = compareContract(contract, rows, { distinctId: options.distinctId });
    const environmentValue = options.environmentValue || options.environmentHost;
    if (options.query && environmentValue) {
        report.environment = {
            name: options.environment || 'custom',
            property: options.environmentProperty || 'lmweb_url',
            value: environmentValue,
        };
    }
    const output = options.format === 'json'
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatMarkdown(report, options.actual ? `离线事件文件 ${options.actual}` : '神策查询 API');

    if (options.out) {
        await fs.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
        await fs.writeFile(options.out, output, 'utf8');
    }
    else {
        process.stdout.write(output);
    }
    return report.summary.failed === 0 ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    run().then(code => {
        process.exitCode = code;
    }).catch(error => {
        process.stderr.write(`Error: ${error.message}\n`);
        process.exitCode = error.isUsageError ? 2 : 3;
    });
}

export {
    buildSensorsSql,
    compareContract,
    enforceIdentityRequirements,
    formatDryRun,
    formatMarkdown,
    loadCredentialProfile,
    normalizeContract,
    normalizeCredentialDocument,
    parseOpenApiRows,
    parseEventRows,
    querySensorsEvent,
    redactValue,
    resolveCredentialsFile,
    resolveEnvironmentOptions,
    resolveQueryConfig,
    run,
    validateEnvironmentValue,
};
