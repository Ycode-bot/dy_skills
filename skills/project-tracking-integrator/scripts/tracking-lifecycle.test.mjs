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
