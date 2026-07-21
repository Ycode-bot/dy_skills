import assert from 'node:assert/strict';
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
        distinctId: "user'quoted",
        sinceMinutes: 30,
        match: { btn_name: 'dialog_click' },
    }, {
        now: new Date('2026-07-21T03:00:00Z'),
        limit: 50,
    });
    assert.match(sql, /event = 'event''quoted'/);
    assert.match(sql, /distinct_id = 'user''quoted'/);
    assert.match(sql, /`btn_name` = 'dialog_click'/);
    assert.match(sql, /time >= '/);
    assert.match(sql, /LIMIT 50$/);
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
