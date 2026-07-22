import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    buildSensorsSql,
    compareContract,
    formatDryRun,
    normalizeContract,
    normalizeCredentialDocument,
    parseEventRows,
    parseOpenApiRows,
    querySensorsEvent,
    resolveCredentialsFile,
    resolveEnvironmentOptions,
    run,
    validateEnvironmentValue,
} from './verify-sensors-events.mjs';

const contract = normalizeContract({
    version: 1,
    events: [
        {
            id: 'claim-click',
            event: 'ima_function_click',
            match: { btn_name: 'discount_popup_claim_click' },
            minCount: 1,
            maxCount: 1,
            properties: {
                f_page: { type: 'string', equals: 'community' },
                btn_position: { type: 'string', oneOf: ['ai-creation', 'canvas-editor'] },
                btn_name: { type: 'string', equals: 'discount_popup_claim_click' },
                retry_count: { required: false, type: 'integer' },
            },
        },
    ],
});

test('parseEventRows accepts JSON and NDJSON', () => {
    assert.equal(parseEventRows('[{"event":"a"}]').length, 1);
    assert.equal(parseEventRows('{"event":"a"}\n{"event":"b"}').length, 2);
});

test('credential profiles resolve default profile, hosts, project, and api key', () => {
    const profile = normalizeCredentialDocument({
        default_profile: 'prod',
        profiles: {
            prod: {
                hosts: ['https://sensor-one.internal', 'https://sensor-two.internal'],
                project: 'AiProduct',
                api_key: 'test-secret-value',
            },
        },
    });
    assert.equal(profile.name, 'prod');
    assert.equal(profile.hosts.length, 2);
    assert.equal(profile.project, 'AiProduct');
    assert.equal(profile.apiKey, 'test-secret-value');
    assert.equal(profile.authMode, 'token-query');
});

test('a #K- API Key automatically selects Sensors OpenAPI mode', () => {
    const profile = normalizeCredentialDocument({
        default_profile: 'prod',
        profiles: {
            prod: {
                hosts: ['http://sensor.internal:8107'],
                project: 'AiProduct',
                api_key: '#K-12345678901234567890123456789012',
            },
        },
    });
    assert.equal(profile.authMode, 'openapi');
    assert.equal(profile.queryPath, '');
});

test('resolveCredentialsFile prefers explicit, environment, then existing default profile', async () => {
    assert.equal(
        await resolveCredentialsFile({ credentials: './explicit.json' }, { SENSORS_QUERY_CREDENTIALS_FILE: './environment.json' }, '/missing/default.json'),
        path.resolve('./explicit.json'),
    );
    assert.equal(
        await resolveCredentialsFile({ credentials: '' }, { SENSORS_QUERY_CREDENTIALS_FILE: './environment.json' }, '/missing/default.json'),
        path.resolve('./environment.json'),
    );

    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'sensors-credentials-test-'));
    try {
        const defaultFile = path.join(temporary, 'credentials.json');
        await fs.writeFile(defaultFile, '{}', 'utf8');
        assert.equal(await resolveCredentialsFile({ credentials: '' }, {}, defaultFile), path.resolve(defaultFile));
    }
    finally {
        await fs.rm(temporary, { recursive: true, force: true });
    }
});

test('normalizeContract accepts a version 2 required Sensors target', () => {
    const normalized = normalizeContract({
        version: 2,
        defaults: { minCount: 1, maxCount: 1, sinceMinutes: 20 },
        events: [{
            id: 'cta-click',
            trigger: '用户点击 CTA',
            deduplication: { minCount: 1, maxCount: 2 },
            targets: {
                sensors: {
                    status: 'required',
                    event: 'ima_function_click',
                    match: { btn_name: 'cta_click' },
                    properties: { btn_name: { type: 'string', equals: 'cta_click' } },
                },
                ga4: { status: 'disabled' },
            },
        }],
    });

    assert.equal(normalized.version, 2);
    assert.equal(normalized.events.length, 1);
    assert.equal(normalized.events[0].event, 'ima_function_click');
    assert.equal(normalized.events[0].maxCount, 2);
    assert.deepEqual(normalized.events[0].match, { btn_name: 'cta_click' });
});

test('environment profile derives a protocol-free local host with port', () => {
    const options = resolveEnvironmentOptions({
        environments: {
            local: {
                startUrl: 'http://localhost:3000/example',
                query: { property: 'lmweb_url', operator: 'contains', valueFrom: 'browser-host' },
            },
        },
    }, {
        query: true,
        environment: 'local',
        environmentValue: '',
        environmentHost: '',
        environmentProperty: '',
    });
    assert.equal(options.environmentValue, 'localhost:3000');
    assert.equal(options.environmentProperty, 'lmweb_url');
});

test('environment value rejects protocol and accepts host with port', () => {
    assert.doesNotThrow(() => validateEnvironmentValue('localhost:3000'));
    assert.doesNotThrow(() => validateEnvironmentValue('127.0.0.1:3000'));
    assert.throws(() => validateEnvironmentValue('http://localhost:3000'), /without protocol/);
});

test('parseOpenApiRows maps streamed columns and values into event rows', () => {
    const rows = parseOpenApiRows(JSON.stringify({
        code: 'SUCCESS',
        request_id: 'test-request',
        data: {
            data: ['ima_function_click', 'community', 'claim_click'],
            columns: ['event', 'f_page', 'btn_name'],
        },
    }));
    assert.deepEqual(rows, [{
        event: 'ima_function_click',
        f_page: 'community',
        btn_name: 'claim_click',
    }]);
});

test('compareContract passes matching flat query rows', () => {
    const report = compareContract(contract, [{
        event: 'ima_function_click',
        f_page: 'community',
        btn_position: 'ai-creation',
        btn_name: 'discount_popup_claim_click',
        retry_count: 0,
    }]);
    assert.equal(report.summary.passed, 1);
    assert.equal(report.results[0].status, 'PASS');
});

test('compareContract reports contract mismatch without leaking sensitive values', () => {
    const sensitiveContract = normalizeContract({
        events: [{
            event: 'login',
            properties: {
                email: { type: 'string', equals: 'expected@example.com' },
            },
        }],
    });
    const report = compareContract(sensitiveContract, [{ event: 'login', email: 'actual@example.com' }]);
    assert.equal(report.results[0].status, 'CONTRACT_MISMATCH');
    assert.equal(report.results[0].issues[0].expected, '[REDACTED]');
    assert.equal(report.results[0].issues[0].actual, '[REDACTED]');
});

test('compareContract reports duplicates', () => {
    const row = {
        event: 'ima_function_click',
        properties: {
            f_page: 'community',
            btn_position: 'canvas-editor',
            btn_name: 'discount_popup_claim_click',
        },
    };
    const report = compareContract(contract, [row, row]);
    assert.equal(report.results[0].status, 'DUPLICATED');
});

test('match separates business actions that share one Sensors event name', () => {
    const sharedEventContract = normalizeContract({
        events: [
            {
                id: 'show',
                event: 'ima_function_click',
                match: { btn_name: 'dialog_show' },
                properties: { btn_name: { equals: 'dialog_show' } },
            },
            {
                id: 'click',
                event: 'ima_function_click',
                match: { btn_name: 'dialog_click' },
                properties: { btn_name: { equals: 'dialog_click' } },
            },
        ],
    });
    const report = compareContract(sharedEventContract, [
        { event: 'ima_function_click', btn_name: 'dialog_show' },
        { event: 'ima_function_click', btn_name: 'dialog_click' },
    ]);
    assert.equal(report.summary.passed, 2);
});

test('buildSensorsSql escapes literals and keeps a bounded query', () => {
    const sql = buildSensorsSql({
        event: "event'quoted",
        sinceMinutes: 30,
        match: { btn_name: 'dialog_click' },
    }, {
        now: new Date('2026-07-21T03:00:00Z'),
        limit: 50,
    });
    assert.match(sql, /event = 'event''quoted'/);
    assert.match(sql, /`btn_name` = 'dialog_click'/);
    assert.match(sql, /time >= '/);
    assert.match(sql, /LIMIT 50$/);
});

test('buildSensorsSql isolates QA and production by URL hostname', () => {
    const qaSql = buildSensorsSql(contract.events[0], {
        environmentHost: 'qa.imastudio.com',
        environmentProperty: 'lmweb_url',
    });
    const productionSql = buildSensorsSql(contract.events[0], {
        environmentHost: 'www.imastudio.com',
        environmentProperty: 'lmweb_url',
    });

    assert.match(qaSql, /`lmweb_url` LIKE '%qa\.imastudio\.com%'/);
    assert.doesNotMatch(qaSql, /www\.imastudio\.com/);
    assert.match(productionSql, /`lmweb_url` LIKE '%www\.imastudio\.com%'/);
    assert.doesNotMatch(productionSql, /qa\.imastudio\.com/);
});

test('buildSensorsSql isolates localhost by host and port without protocol', () => {
    const sql = buildSensorsSql(contract.events[0], {
        environmentValue: 'localhost:3000',
        environmentProperty: 'lmweb_url',
    });
    assert.match(sql, /`lmweb_url` LIKE '%localhost:3000%'/);
    assert.doesNotMatch(sql, /https?:\/\//);
});

test('environment host is rejected outside live query mode', async () => {
    await assert.rejects(
        () => run([
            '--spec', '/missing/contract.json',
            '--actual', '/missing/events.json',
            '--environment-host', 'qa.imastudio.com',
        ]),
        /only supported with --query/,
    );
});

test('dry-run redacts the query credential', () => {
    const output = formatDryRun(contract, {
        baseUrl: 'https://sensor.example.com',
        project: 'AiProduct',
        queryPath: '/api/sql/query',
        authMode: 'token-query',
        dryRun: true,
        limit: 10,
    }, {
        SENSORS_QUERY_API_SECRET: 'must-not-appear',
    });
    assert.doesNotMatch(output, /must-not-appear/);
    assert.match(output, /REDACTED/);
});

test('dry-run prints the environment isolation condition', () => {
    const output = formatDryRun(contract, {
        baseUrl: 'https://sensor.example.com',
        project: 'AiProduct',
        queryPath: '/api/sql/query',
        authMode: 'token-query',
        dryRun: true,
        limit: 10,
        environmentHost: 'qa.imastudio.com',
        environmentProperty: 'lmweb_url',
    }, {
        SENSORS_QUERY_API_SECRET: 'must-not-appear',
    });
    assert.match(output, /Environment: custom; lmweb_url contains qa\.imastudio\.com/);
    assert.match(output, /`lmweb_url` LIKE '%qa\.imastudio\.com%'/);
});

test('local environment dry-run uses only contract query selectors', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'sensors-local-environment-test-'));
    try {
        const spec = path.join(temporary, 'contract.json');
        const out = path.join(temporary, 'dry-run.txt');
        await fs.writeFile(spec, JSON.stringify({
            version: 2,
            environments: {
                local: {
                    startUrl: 'http://localhost:3000/example',
                    query: { property: 'lmweb_url', operator: 'contains', valueFrom: 'browser-host' },
                },
                qa: {
                    startUrl: 'https://qa.imastudio.com',
                    query: { property: 'lmweb_url', operator: 'contains', value: 'qa.imastudio.com' },
                },
            },
            events: [{
                id: 'claim-click',
                trigger: 'click',
                targets: { sensors: { status: 'required', event: 'ima_function_click' } },
                validation: {
                    environments: {
                        local: { status: 'required', evidence: ['source', 'browser', 'ingestion'] },
                    },
                },
            }],
        }), 'utf8');
        const code = await run([
            '--spec', spec,
            '--query',
            '--environment', 'local',
            '--environment-value', 'localhost:3000',
            '--dry-run',
            '--out', out,
        ], {
            SENSORS_QUERY_BASE_URL: 'https://sensor.example.com',
            SENSORS_QUERY_PROJECT: 'AiProduct',
            SENSORS_QUERY_API_SECRET: 'secret-not-printed',
        });
        assert.equal(code, 0);
        const output = await fs.readFile(out, 'utf8');
        assert.match(output, /Environment: local; lmweb_url contains localhost:3000/);
        assert.match(output, /`lmweb_url` LIKE '%localhost:3000%'/);
        assert.doesNotMatch(output, /distinct_id\s*=/);
        assert.doesNotMatch(output, /secret-not-printed/);
        assert.doesNotMatch(output, /http:\/\/localhost:3000/);
    }
    finally {
        await fs.rm(temporary, { recursive: true, force: true });
    }
});

test('live query compares API rows with only the declared contract fields', async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'sensors-contract-query-test-'));
    const originalFetch = globalThis.fetch;
    try {
        const spec = path.join(temporary, 'contract.json');
        const credentials = path.join(temporary, 'credentials.json');
        const out = path.join(temporary, 'report.json');
        await fs.writeFile(spec, JSON.stringify({
            version: 2,
            environments: {
                local: {
                    startUrl: 'http://localhost:3001/zh/community',
                    query: { property: 'lmweb_url', operator: 'contains', valueFrom: 'browser-host' },
                },
            },
            events: [{
                id: 'material-click',
                trigger: 'click',
                deduplication: { minCount: 1, maxCount: 1 },
                targets: {
                    sensors: {
                        status: 'required',
                        event: 'ima_function_click',
                        match: { btn_name: 'material_click' },
                        properties: {
                            f_page: { type: 'string', equals: 'community' },
                            btn_name: { type: 'string', equals: 'material_click' },
                        },
                    },
                },
            }],
        }), 'utf8');
        await fs.writeFile(credentials, JSON.stringify({
            default_profile: 'local-test',
            profiles: {
                'local-test': {
                    hosts: ['http://sensor.internal:8107'],
                    project: 'AiProduct',
                    api_key: 'private-token-12345',
                },
            },
        }), { mode: 0o600 });
        await fs.chmod(credentials, 0o600);
        globalThis.fetch = async (_url, init) => {
            const sql = String(init.body);
            assert.match(sql, /localhost%3A3001|localhost:3001/);
            assert.doesNotMatch(sql, /distinct_id\s*%3D|distinct_id\s*=/);
            return new Response(JSON.stringify({
                event: 'ima_function_click',
                distinct_id: 'platform-generated-value',
                lmweb_url: 'http://localhost:3001/zh/community',
                f_page: 'community',
                btn_name: 'material_click',
            }), { status: 200 });
        };

        const code = await run([
            '--spec', spec,
            '--query',
            '--credentials', credentials,
            '--environment', 'local',
            '--environment-value', 'localhost:3001',
            '--format', 'json',
            '--out', out,
        ]);
        assert.equal(code, 0);
        const output = await fs.readFile(out, 'utf8');
        const report = JSON.parse(output);
        assert.equal(report.results[0].status, 'PASS');
        assert.doesNotMatch(output, /platform-generated-value/);
    }
    finally {
        globalThis.fetch = originalFetch;
        await fs.rm(temporary, { recursive: true, force: true });
    }
});

test('dedicated identity query options are not part of data verification', async () => {
    await assert.rejects(
        () => run([
            '--spec', '/missing/contract.json',
            '--actual', '/missing/events.json',
            '--distinct-id', 'test-value',
        ]),
        /unknown option: --distinct-id/,
    );
});

test('querySensorsEvent calls SQL API and parses NDJSON without exposing credential', async () => {
    let observedUrl = '';
    let observedBody = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        observedUrl = String(url);
        observedBody = String(init.body);
        return new Response('{"event":"ima_function_click","f_page":"community"}\n', {
            status: 200,
            headers: { 'content-type': 'text/plain' },
        });
    };
    try {
        const rows = await querySensorsEvent(contract.events[0], {
            baseUrl: 'https://sensor.example.com',
            project: 'AiProduct',
            queryPath: '/api/sql/query',
            authMode: 'token-query',
            apiKeyHeader: 'X-API-Key',
            limit: 10,
            timeoutMs: 3000,
        }, {
            SENSORS_QUERY_API_SECRET: 'super-secret-value',
        });
        assert.equal(rows.length, 1);
        assert.match(observedUrl, /^https:\/\/sensor\.example\.com\/api\/sql\/query\?/);
        assert.match(observedUrl, /token=super-secret-value/);
        assert.match(observedUrl, /project=AiProduct/);
        assert.match(observedBody, /format=json/);
        assert.match(observedBody, /SELECT/);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

test('querySensorsEvent uses OpenAPI headers, path, and JSON body for #K API keys', async () => {
    let observedUrl = '';
    let observedHeaders = {};
    let observedBody = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        observedUrl = String(url);
        observedHeaders = init.headers;
        observedBody = String(init.body);
        return new Response(JSON.stringify({
            code: 'SUCCESS',
            data: {
                data: ['ima_function_click', 'community', 'discount_popup_claim_click'],
                columns: ['event', 'f_page', 'btn_name'],
            },
        }), { status: 200 });
    };
    try {
        const rows = await querySensorsEvent(contract.events[0], {
            credentialProfile: {
                name: 'prod',
                hosts: ['http://sensor.internal:8107'],
                project: 'AiProduct',
                apiKey: '#K-12345678901234567890123456789012',
                authMode: 'openapi',
                apiKeyHeader: 'X-API-Key',
                queryPath: '',
            },
            limit: 10,
            timeoutMs: 3000,
        }, {});
        assert.equal(rows.length, 1);
        assert.equal(observedUrl, 'http://sensor.internal:8107/api/v3/analytics/v1/model/sql/query');
        assert.equal(observedHeaders['api-key'], '#K-12345678901234567890123456789012');
        assert.equal(observedHeaders['sensorsdata-project'], 'AiProduct');
        const body = JSON.parse(observedBody);
        assert.equal(body.limit, '10');
        assert.match(body.sql, /day BETWEEN/);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
