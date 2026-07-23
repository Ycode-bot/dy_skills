import assert from 'node:assert/strict';
import test from 'node:test';

import { validateBrowserReport } from './validate-browser-report.mjs';

function validJourney() {
    return {
        version: 3,
        name: 'qa-material-interactions',
        startUrl: 'https://qa.imastudio.com/materials',
        environment: 'qa',
        steps: [
            {
                id: 'open-materials',
                action: 'goto',
                url: 'https://qa.imastudio.com/materials',
            },
            {
                id: 'click-banner',
                action: 'click',
                locator: { type: 'role', role: 'button', name: 'Banner' },
                expect: { type: 'visibleElement', value: 'banner-detail' },
                covers: ['banner-show'],
            },
            {
                id: 'hover-latest',
                action: 'hover',
                locator: { type: 'testId', value: 'latest-material' },
                expect: { type: 'visibleText', value: 'Latest' },
                covers: ['latest-click'],
            },
        ],
        verification: {
            contract: './tracking-contract.json',
            ingestionWaitSeconds: 60,
            maxQueryAttempts: 1,
        },
    };
}

function validReport() {
    return {
        version: 3,
        journeyName: 'qa-material-interactions',
        environment: 'qa',
        environmentProperty: 'lmweb_url',
        environmentValue: 'qa.imastudio.com',
        triggerWindow: {
            startedAt: '2026-07-23T04:45:17.656Z',
            finishedAt: '2026-07-23T04:45:36.349Z',
        },
        steps: [
            {
                id: 'open-materials',
                action: 'goto',
                status: 'PASS',
                locator: null,
                matchCount: null,
                executedAt: '2026-07-23T04:45:18.000Z',
            },
            {
                id: 'click-banner',
                action: 'click',
                status: 'PASS',
                locator: { type: 'role', role: 'button', name: 'Banner' },
                matchCount: 1,
                resolvedAt: '2026-07-23T04:45:20.000Z',
                executedAt: '2026-07-23T04:45:21.000Z',
                resolvedElement: { role: 'button', name: 'Banner', scope: 'material-grid' },
                expectation: { type: 'visibleElement', status: 'PASS', value: 'banner-detail' },
            },
            {
                id: 'hover-latest',
                action: 'hover',
                status: 'PASS',
                locator: { type: 'testId', value: 'latest-material' },
                matchCount: 1,
                resolvedAt: '2026-07-23T04:45:24.000Z',
                executedAt: '2026-07-23T04:45:25.000Z',
                resolvedElement: { role: 'article', name: 'Latest material' },
                expectation: { type: 'visibleText', status: 'PASS', value: 'Latest' },
            },
        ],
        results: [
            { id: 'banner-show', platform: 'sensors', status: 'PASS', method: 'in-app-browser' },
            { id: 'latest-click', platform: 'sensors', status: 'PASS', method: 'in-app-browser' },
        ],
    };
}

test('rejects a passing locator action that resolves to ambiguous elements', () => {
    const report = validReport();
    report.steps[1].matchCount = 2;

    const validation = validateBrowserReport(report, validJourney());

    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /matchCount must equal 1/);
});

test('rejects click evidence without a passing expectation', () => {
    const report = validReport();
    delete report.steps[1].expectation;

    const validation = validateBrowserReport(report, validJourney());

    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /expectation.status must be PASS for click/);
});

test('rejects a report with a missing journey step', () => {
    const report = validReport();
    report.steps.splice(1, 1);

    const validation = validateBrowserReport(report, validJourney());

    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /must contain exactly 3 journey steps/);
    assert.match(validation.issues.join('\n'), /id must equal journey step id click-banner/);
});

test('rejects report environment evidence that conflicts with the journey', () => {
    const report = validReport();
    report.environment = 'production';
    report.environmentValue = 'www.imastudio.com';

    const validation = validateBrowserReport(report, validJourney());

    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /report.environment must equal journey.environment/);
    assert.match(validation.issues.join('\n'), /report.environmentValue must equal the host from journey.startUrl/);
});

test('rejects a locator step without fresh resolution evidence', () => {
    const report = validReport();
    delete report.steps[1].resolvedAt;

    const validation = validateBrowserReport(report, validJourney());

    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /resolvedAt for locator step click-banner/);
});

test('rejects a locator or expectation that differs from the authorized journey', () => {
    const report = validReport();
    report.steps[1].locator.name = 'Another banner';
    report.steps[2].expectation.value = 'Another label';

    const validation = validateBrowserReport(report, validJourney());

    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /locator must equal the locator authorized by the journey/);
    assert.match(validation.issues.join('\n'), /expectation.value must equal the journey expectation value/);
});

test('rejects failed browser steps and failed covered event evidence', () => {
    const report = validReport();
    report.steps[1].status = 'FAILED';
    report.results[0].status = 'FAILED';

    const validation = validateBrowserReport(report, validJourney());

    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /status must be PASS before ingestion verification/);
    assert.match(validation.issues.join('\n'), /status must be PASS or NOT_AVAILABLE for journey-covered event id: banner-show/);
});

test('allows unavailable optional SDK evidence and continues to platform verification', () => {
    const report = validReport();
    report.results[0].status = 'NOT_AVAILABLE';

    assert.equal(validateBrowserReport(report, validJourney()).status, 'PASS');
});

test('rejects an inverted trigger window', () => {
    const report = validReport();
    report.triggerWindow.finishedAt = '2026-07-23T04:45:00.000Z';

    const validation = validateBrowserReport(report, validJourney());

    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /finishedAt must not be before startedAt/);
});

test('binds covered step evidence to the fixed trigger window and execution order', () => {
    const report = validReport();
    report.steps[1].resolvedAt = '2026-07-23T04:46:20.000Z';
    report.steps[1].executedAt = '2026-07-23T04:45:10.000Z';
    report.steps[2].executedAt = '2026-07-23T04:45:09.000Z';

    const validation = validateBrowserReport(report, validJourney());
    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /resolvedAt must fall within report\.triggerWindow/);
    assert.match(validation.issues.join('\n'), /executedAt must fall within report\.triggerWindow/);
    assert.match(validation.issues.join('\n'), /executedAt must preserve journey step order/);
});

test('requires an execution timestamp for every browser step', () => {
    const report = validReport();
    delete report.steps[1].executedAt;

    const validation = validateBrowserReport(report, validJourney());
    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /executedAt must be a non-empty ISO-8601 timestamp/);
});

test('requires each locator to be freshly resolved after the previous step completes', () => {
    const report = validReport();
    report.steps[1].executedAt = '2026-07-23T04:45:23.000Z';
    report.steps[2].resolvedAt = '2026-07-23T04:45:22.000Z';
    report.steps[2].executedAt = '2026-07-23T04:45:25.000Z';

    const validation = validateBrowserReport(report, validJourney());
    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /resolvedAt must be fresh after the previous step executedAt/);
});

test('rejects resolved element evidence that contradicts role and href locators', () => {
    const report = validReport();
    report.steps[1].resolvedElement.name = 'Delete account';
    const journey = validJourney();
    journey.steps[2].locator = { type: 'href', value: '/materials/latest' };
    report.steps[2].locator = { type: 'href', value: '/materials/latest' };
    report.steps[2].resolvedElement = {
        role: 'link',
        name: 'Latest material',
        href: 'https://qa.imastudio.com/materials/other',
    };

    const validation = validateBrowserReport(report, journey);
    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /resolvedElement\.name must match the authorized role locator/);
    assert.match(validation.issues.join('\n'), /resolvedElement\.href must match the authorized href locator/);
});

test('blocks cross-origin hrefs resolved through non-href click locators', () => {
    const journey = validJourney();
    journey.steps[1].locator = { type: 'role', role: 'link', name: 'Help', exact: true };
    journey.steps[1].expect = { type: 'visibleText', value: 'Help center' };
    const report = validReport();
    report.steps[1].locator = structuredClone(journey.steps[1].locator);
    report.steps[1].resolvedElement = {
        role: 'link',
        name: 'Help',
        href: 'https://evil.example/phish',
    };
    report.steps[1].expectation = { type: 'visibleText', status: 'PASS', value: 'Help center' };

    const validation = validateBrowserReport(report, journey);
    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /href origin must equal journey\.startUrl origin before click/);
});

test('requires href evidence when clicking a role=link locator', () => {
    const journey = validJourney();
    journey.steps[1].locator = { type: 'role', role: 'link', name: 'Help', exact: true };
    const report = validReport();
    report.steps[1].locator = structuredClone(journey.steps[1].locator);
    report.steps[1].resolvedElement = { role: 'link', name: 'Help' };

    const validation = validateBrowserReport(report, journey);
    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /href is required when clicking a role=link locator/);
});

test('binds expectation locators and attributes to the authorized journey', () => {
    const journey = validJourney();
    journey.steps[1].expect = {
        type: 'visibleElement',
        locator: { type: 'testId', value: 'banner-detail' },
    };
    const report = validReport();
    report.steps[1].expectation = {
        type: 'visibleElement',
        status: 'PASS',
        locator: { type: 'testId', value: 'another-element' },
    };

    const validation = validateBrowserReport(report, journey);
    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /expectation\.locator must equal the journey expectation locator/);
});

test('rejects schema-forbidden fields before retaining a debug bundle', () => {
    const report = validReport();
    report.rawCookie = 'secret';
    report.steps[1].resolvedElement.rawHtml = '<button>secret</button>';
    report.results[0].rawEvent = { distinct_id: 'secret' };

    const validation = validateBrowserReport(report, validJourney());
    assert.equal(validation.status, 'INVALID');
    assert.equal(validation.issues.filter(issue => /is unsupported/.test(issue)).length, 3);
});

test('rejects a report that omits an event covered by a journey step', () => {
    const report = validReport();
    report.results = report.results.filter(result => result.id !== 'latest-click');

    const validation = validateBrowserReport(report, validJourney());

    assert.equal(validation.status, 'INVALID');
    assert.match(validation.issues.join('\n'), /missing journey-covered event id: latest-click/);
});

test('accepts a complete deterministic version 3 browser report', () => {
    const validation = validateBrowserReport(validReport(), validJourney());

    assert.deepEqual(validation, {
        status: 'PASS',
        journeyName: 'qa-material-interactions',
        environment: 'qa',
        stepCount: 3,
        resultCount: 2,
        issues: [],
    });
});

test('uses an explicit contract environment selector when it is not lmweb_url', () => {
    const report = validReport();
    report.environmentProperty = 'app_env';
    report.environmentValue = 'qa';
    const contract = {
        environments: {
            qa: { query: { property: 'app_env', operator: 'equals', value: 'qa' } },
        },
    };

    assert.equal(validateBrowserReport(report, validJourney(), contract).status, 'PASS');
});
