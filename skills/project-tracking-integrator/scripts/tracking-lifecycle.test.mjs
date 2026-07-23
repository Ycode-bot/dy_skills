import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReport } from './generate-tracking-report.mjs';
import { scanProject } from './scan-tracking-project.mjs';
import { verifySource } from './verify-tracking-source.mjs';

const contract = {
    version: 2,
    events: [{
        id: 'signup-click',
        businessEvent: '注册按钮点击',
        trigger: '用户点击注册按钮',
        targets: {
            sensors: {
                status: 'required',
                event: 'signup_click',
                wrapper: 'trackSignupClick',
                match: { button_name: 'signup' },
                properties: {
                    button_name: { required: true, type: 'string', equals: 'signup' },
                },
            },
        },
    }],
};

test('scanProject classifies a reachable Sensors architecture as established', () => {
    const report = scanProject({
        root: '/fixture',
        files: [
            { path: 'package.json', text: JSON.stringify({ dependencies: { 'sensors-data-sdk': '1.0.0' } }) },
            { path: 'plugins/sensors.ts', text: 'KEWLSensors.init({ server_url: "/sa?project=test" })' },
            { path: 'lib/track/index.ts', text: 'export function track(name, data) { KEWLSensors.track(name, data) }' },
            { path: 'lib/track/signup.ts', text: 'export function trackSignupClick() { track("signup_click", { button_name: "signup" }) }' },
            { path: 'pages/signup.vue', text: 'function submit() { trackSignupClick() }' },
        ],
    });

    assert.equal(report.classification, 'established');
    assert.equal(report.platforms.sensors.status, 'established');
    assert.deepEqual(report.platforms.sensors.callSites, ['pages/signup.vue']);
});

test('scanProject does not mistake an installed SDK for an established system', () => {
    const report = scanProject({
        root: '/fixture',
        files: [
            { path: 'package.json', text: JSON.stringify({ dependencies: { 'sensors-data-sdk': '1.0.0' } }) },
        ],
    });
    assert.equal(report.classification, 'partial');
    assert.equal(report.platforms.sensors.status, 'partial');
});

test('verifySource requires the declared wrapper to have a call site', () => {
    const passing = verifySource(contract, [
        { path: 'lib/track/signup.ts', text: 'export function trackSignupClick() { track("signup_click", { button_name: "signup" }) }' },
        { path: 'pages/signup.vue', text: 'trackSignupClick()' },
    ], '/fixture');
    assert.equal(passing.results[0].status, 'PASS');

    const unreachable = verifySource(contract, [
        { path: 'lib/track/signup.ts', text: 'export function trackSignupClick() { track("signup_click", { button_name: "signup" }) }' },
    ], '/fixture');
    assert.equal(unreachable.results[0].status, 'UNREACHABLE');
});

test('verifySource reports missing required enum evidence', () => {
    const enumContract = structuredClone(contract);
    enumContract.events[0].targets.sensors.properties.scene = {
        required: true,
        type: 'string',
        oneOf: ['home', 'editor'],
    };
    const report = verifySource(enumContract, [
        { path: 'lib/track/signup.ts', text: 'export function trackSignupClick() { track("signup_click", { button_name: "signup", scene: "home" }) }' },
        { path: 'pages/signup.vue', text: 'trackSignupClick()' },
    ], '/fixture');
    assert.equal(report.results[0].status, 'CONTRACT_MISMATCH');
    assert.match(report.results[0].issues[0].message, /editor/);
});

test('buildReport only passes after source, runtime, and ingestion evidence pass', () => {
    const source = { results: [{ id: 'signup-click', platform: 'sensors', status: 'PASS' }] };
    const runtime = { results: [{ id: 'signup-click', platform: 'sensors', status: 'PASS' }] };
    const ingestion = { results: [{ id: 'signup-click', status: 'PASS' }] };
    const complete = buildReport({ contract, source, runtime, ingestion });
    assert.equal(complete.status, 'PASS');
    assert.equal(complete.results[0].status, 'PASS');

    const incomplete = buildReport({ contract, source, ingestion });
    assert.equal(incomplete.status, 'INCOMPLETE');
    assert.equal(incomplete.results[0].runtime, 'NOT_RUN');
});

test('buildReport keeps query failure distinct from not found', () => {
    const report = buildReport({
        contract,
        source: { results: [{ id: 'signup-click', platform: 'sensors', status: 'PASS' }] },
        runtime: { results: [{ id: 'signup-click', platform: 'sensors', status: 'PASS' }] },
        ingestion: { results: [{ id: 'signup-click', status: 'QUERY_FAILED' }] },
    });
    assert.equal(report.status, 'FAILED');
    assert.equal(report.results[0].status, 'QUERY_FAILED');
});

test('buildReport blocks unknown targets and does not require GA ingestion by default', () => {
    const gaContract = {
        version: 2,
        events: [{
            id: 'purchase',
            trigger: '支付成功',
            targets: {
                ga4: { status: 'required', event: 'purchase', wrapper: 'trackPurchase' },
                google_ads: { status: 'unknown' },
            },
        }],
    };
    const report = buildReport({
        contract: gaContract,
        source: { results: [{ id: 'purchase', platform: 'ga4', status: 'PASS' }] },
        runtime: { results: [{ id: 'purchase', platform: 'ga4', status: 'PASS' }] },
    });
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.results.find(result => result.platform === 'ga4').ingestion, 'NOT_REQUIRED');
    assert.equal(report.results.find(result => result.platform === 'ga4').status, 'PASS');
    assert.equal(report.results.find(result => result.platform === 'google_ads').status, 'BLOCKED');
});

test('buildReport keeps local, QA, and production results independent of input order', () => {
    const environmentContract = {
        version: 2,
        environments: {
            local: { startUrl: 'http://localhost:3000', query: { property: 'lmweb_url', operator: 'contains', valueFrom: 'browser-host' } },
            qa: { startUrl: 'https://qa.imastudio.com', query: { property: 'lmweb_url', operator: 'contains', value: 'qa.imastudio.com' } },
            production: { startUrl: 'https://www.imastudio.com', query: { property: 'lmweb_url', operator: 'contains', value: 'www.imastudio.com' } },
        },
        events: [{
            id: 'signup-click',
            trigger: '用户点击注册按钮',
            targets: { sensors: { status: 'required', event: 'signup_click' } },
            validation: {
                environments: {
                    local: { status: 'required', evidence: ['source', 'browser', 'ingestion'] },
                    qa: { status: 'required', evidence: ['browser', 'ingestion'] },
                    production: { status: 'required', evidence: ['browser', 'ingestion'], smokeSafe: true },
                },
            },
        }],
    };
    const source = { results: [{ id: 'signup-click', platform: 'sensors', status: 'PASS' }] };
    const browser = [
        { environment: 'local', results: [{ id: 'signup-click', platform: 'sensors', status: 'PASS' }] },
        { environment: 'qa', results: [{ id: 'signup-click', platform: 'sensors', status: 'PASS' }] },
        { environment: 'production', results: [{ id: 'signup-click', platform: 'sensors', status: 'PASS' }] },
    ];
    const ingestion = [
        { environment: { name: 'local', property: 'lmweb_url', value: 'localhost:3000' }, results: [{ id: 'signup-click', status: 'PASS' }] },
        { environment: { name: 'qa', property: 'lmweb_url', value: 'qa.imastudio.com' }, results: [{ id: 'signup-click', status: 'NOT_FOUND' }] },
        { environment: { name: 'production', property: 'lmweb_url', value: 'www.imastudio.com' }, results: [{ id: 'signup-click', status: 'PASS' }] },
    ];

    const forward = buildReport({ contract: environmentContract, source, browser, ingestion });
    const reverse = buildReport({ contract: environmentContract, source, browser: [...browser].reverse(), ingestion: [...ingestion].reverse() });
    const compact = report => report.results.map(result => [result.environment, result.status]);

    assert.deepEqual(compact(forward), compact(reverse));
    assert.deepEqual(compact(forward), [
        ['local', 'PASS'],
        ['qa', 'NOT_FOUND'],
        ['production', 'PASS'],
    ]);
    assert.equal(forward.gates.local.status, 'PASS');
    assert.equal(forward.gates.local.readiness, 'LOCAL_READY');
    assert.equal(forward.gates.qa.status, 'FAILED');
    assert.equal(forward.gates.production.status, 'BLOCKED');
    assert.equal(forward.gates.production.blockedBy, 'qa');
});

test('buildReport rejects ingestion evidence whose filter does not match the named environment', () => {
    const environmentContract = {
        version: 2,
        environments: {
            qa: {
                startUrl: 'https://qa.imastudio.com',
                query: { property: 'lmweb_url', operator: 'contains', value: 'qa.imastudio.com' },
            },
        },
        events: [{
            id: 'signup-click',
            trigger: '用户点击注册按钮',
            targets: { sensors: { status: 'required', event: 'signup_click' } },
            validation: {
                environments: {
                    qa: { status: 'required', evidence: ['ingestion'] },
                },
            },
        }],
    };
    const ingestion = {
        environment: { name: 'qa', property: 'lmweb_url', value: 'www.imastudio.com' },
        results: [{ id: 'signup-click', status: 'PASS' }],
    };

    const report = buildReport({ contract: environmentContract, ingestion });

    assert.equal(report.status, 'FAILED');
    assert.equal(report.results[0].ingestion, 'QUERY_FAILED');
    assert.equal(report.results[0].status, 'QUERY_FAILED');
});

test('buildReport rejects ingestion evidence that omits environment filter metadata', () => {
    const environmentContract = {
        version: 2,
        environments: {
            qa: {
                startUrl: 'https://qa.imastudio.com',
                query: { property: 'lmweb_url', operator: 'contains', value: 'qa.imastudio.com' },
            },
        },
        events: [{
            id: 'signup-click',
            targets: { sensors: { status: 'required', event: 'signup_click' } },
            validation: { environments: { qa: { status: 'required', evidence: ['ingestion'] } } },
        }],
    };
    const ingestion = { results: [{ id: 'signup-click', status: 'PASS' }] };

    const report = buildReport({ contract: environmentContract, ingestion });

    assert.equal(report.status, 'FAILED');
    assert.equal(report.results[0].ingestion, 'QUERY_FAILED');
});

test('production verification is blocked unless the event is smoke safe', () => {
    const unsafeContract = {
        version: 2,
        environments: {
            production: { startUrl: 'https://www.imastudio.com', query: { property: 'lmweb_url', operator: 'contains', value: 'www.imastudio.com' } },
        },
        events: [{
            id: 'purchase',
            trigger: '支付成功',
            targets: { sensors: { status: 'required', event: 'purchase' } },
            validation: {
                environments: {
                    production: { status: 'required', evidence: ['browser', 'ingestion'], smokeSafe: false },
                },
            },
        }],
    };
    const evidence = { environment: 'production', results: [{ id: 'purchase', platform: 'sensors', status: 'PASS' }] };
    const report = buildReport({ contract: unsafeContract, browser: evidence, ingestion: evidence });
    assert.equal(report.results[0].status, 'BLOCKED');
    assert.equal(report.gates.production.status, 'BLOCKED');
});
