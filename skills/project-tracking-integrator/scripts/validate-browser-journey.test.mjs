import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateBrowserJourney } from './validate-browser-journey.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.resolve(directory, '../references/browser-journey.example.json');
const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));

function v3Journey() {
    return {
        version: 3,
        name: 'local-works-funny',
        environment: 'local',
        startUrl: 'http://localhost:3001',
        steps: [
            {
                id: 'open-works',
                action: 'hover',
                locator: { type: 'role', role: 'link', name: 'Works', exact: true },
                expect: { type: 'visibleText', value: 'funny' },
            },
            {
                id: 'show-funny',
                action: 'scroll-into-view',
                covers: ['works-funny-exposure'],
                locator: {
                    type: 'role',
                    role: 'link',
                    name: 'funny',
                    exact: true,
                    scope: { type: 'testId', value: 'works-secondary-menu' },
                },
            },
            {
                id: 'choose-funny',
                action: 'click',
                covers: ['works-funny-click'],
                locator: {
                    type: 'href',
                    value: '/works/funny',
                    scope: { type: 'testId', value: 'works-secondary-menu' },
                },
                expect: { type: 'selected', value: true },
            },
        ],
        verification: {
            contract: './tracking-contract.json',
            ingestionWaitSeconds: 30,
            retryWaitSeconds: 90,
            maxQueryAttempts: 2,
        },
    };
}

function productionJourney() {
    const journey = structuredClone(example);
    journey.name = 'production-safe-smoke';
    journey.environment = 'production';
    journey.startUrl = 'https://www.imastudio.com/example';
    journey.steps[0].url = 'https://www.imastudio.com/example';
    journey.steps.forEach(step => { delete step.covers; });
    journey.steps[1].covers = ['safe-smoke'];
    return journey;
}

function productionContract(smokeSafe) {
    return {
        version: 2,
        environments: {
            production: {
                startUrl: 'https://www.imastudio.com',
                query: { property: 'lmweb_url', operator: 'contains', value: 'www.imastudio.com' },
            },
        },
        events: [{
            id: 'safe-smoke',
            targets: { sensors: { status: 'required', event: 'safe_smoke' } },
            validation: {
                environments: {
                    production: {
                        status: 'required',
                        evidence: ['browser', 'ingestion'],
                        smokeSafe,
                    },
                },
            },
        }],
    };
}

test('browser journey example is valid', () => {
    assert.deepEqual(validateBrowserJourney(example), {
        status: 'PASS',
        name: 'qa-discount-popup-claim',
        environment: 'qa',
        environmentValue: 'qa.imastudio.com',
        stepCount: 4,
        verification: {
            contract: './tracking-contract.json',
            ingestionWaitSeconds: 240,
            retryWaitSeconds: 240,
            maxQueryAttempts: 2,
            consolePattern: 'sensors|track',
        },
        issues: [],
    });
});

test('browser journey cannot navigate outside the verification environment', () => {
    const journey = structuredClone(example);
    journey.steps[0].url = 'https://www.imastudio.com/example';
    const report = validateBrowserJourney(journey);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /origin must equal startUrl origin/);
});

test('browser journey derives a protocol-free local host with port', () => {
    const journey = structuredClone(example);
    journey.name = 'local-discount-popup-claim';
    journey.environment = 'local';
    journey.startUrl = 'http://localhost:3000/example';
    journey.steps[0].url = 'http://localhost:3000/example';
    const report = validateBrowserJourney(journey);
    assert.equal(report.status, 'PASS');
    assert.equal(report.environmentValue, 'localhost:3000');
});

test('browser journey rejects a production URL labeled as local', () => {
    const journey = structuredClone(example);
    journey.environment = 'local';
    const report = validateBrowserJourney(journey);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /local journey must use/);
});

test('browser journey requires unique locator intent and bounded platform queries', () => {
    const journey = structuredClone(example);
    delete journey.steps[1].locator.value;
    journey.verification.maxQueryAttempts = 3;
    const report = validateBrowserJourney(journey);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /locator.value is required/);
    assert.match(report.issues.join('\n'), /maxQueryAttempts must be 1 or 2/);
});

test('production journey is blocked before browser actions when the contract cannot be read', () => {
    const report = validateBrowserJourney(productionJourney());
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /readable tracking contract before browser actions/);
});

test('production journey is blocked before browser actions when smokeSafe is not true', () => {
    const report = validateBrowserJourney(productionJourney(), productionContract(false));
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /smokeSafe is not true/);
});

test('production journey passes preflight when the contract explicitly marks it smoke safe', () => {
    const report = validateBrowserJourney(productionJourney(), productionContract(true));
    assert.equal(report.status, 'PASS');
});

test('production journey requires smokeSafe for every explicitly covered event', () => {
    const journey = productionJourney();
    journey.steps[1].covers.push('optional-unsafe-event');
    const contract = productionContract(true);
    contract.events.push({
        id: 'optional-unsafe-event',
        targets: { sensors: { status: 'optional' } },
        validation: {
            environments: {
                production: { status: 'optional', evidence: ['browser'], smokeSafe: false },
            },
        },
    });

    const report = validateBrowserJourney(journey, contract);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /smokeSafe is not true for: optional-unsafe-event/);
});

test('production preflight blocks unsafe required non-Sensors targets before browser actions', () => {
    const journey = productionJourney();
    const contract = productionContract(true);
    contract.events.push({
        id: 'ga-unsafe-event',
        targets: {
            sensors: { status: 'disabled' },
            ga4: { status: 'required', event: 'ga_unsafe_event' },
        },
        validation: {
            environments: {
                production: { status: 'required', evidence: ['browser', 'ingestion'], smokeSafe: false },
            },
        },
    });

    const report = validateBrowserJourney(journey, contract);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /smokeSafe is not true for: ga-unsafe-event/);
});

test('version 3 accepts scoped exact locators and does not require sinceMinutes', () => {
    const report = validateBrowserJourney(v3Journey());
    assert.equal(report.status, 'PASS');
    assert.deepEqual(report.verification, {
        contract: './tracking-contract.json',
        ingestionWaitSeconds: 30,
        retryWaitSeconds: 90,
        maxQueryAttempts: 2,
    });
});

test('versions 1 and 2 remain supported and still require sinceMinutes', () => {
    const version1 = structuredClone(example);
    version1.version = 1;
    delete version1.environment;
    version1.environmentHost = 'qa.imastudio.com';
    version1.verification.sinceMinutes = 10;
    assert.equal(validateBrowserJourney(version1).status, 'PASS');

    const version2 = structuredClone(example);
    version2.version = 2;
    version2.verification.sinceMinutes = 10;
    assert.equal(validateBrowserJourney(version2).status, 'PASS');
    delete version2.verification.sinceMinutes;
    assert.match(validateBrowserJourney(version2).issues.join('\n'), /sinceMinutes/);
});

test('version 3 requires environment, unique step ids, and expectations for click and hover', () => {
    const journey = v3Journey();
    delete journey.environment;
    journey.steps[1].id = journey.steps[0].id;
    delete journey.steps[0].expect;
    delete journey.steps[2].expect;
    const report = validateBrowserJourney(journey);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /environment must be/);
    assert.match(report.issues.join('\n'), /id must be unique/);
    assert.equal(report.issues.filter(issue => /expect is required/.test(issue)).length, 2);
});

test('version 3 validates event coverage ids', () => {
    const journey = v3Journey();
    journey.steps[1].covers = ['works-funny-exposure', 'works-funny-exposure'];
    journey.steps[2].covers = [''];
    const report = validateBrowserJourney(journey);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /duplicate event ids/);
    assert.match(report.issues.join('\n'), /non-empty event ids/);
});

test('version 3 coverage must reference and include required contract events', () => {
    const journey = v3Journey();
    const contract = {
        events: [
            { id: 'works-funny-exposure', targets: { sensors: { status: 'required' } } },
            { id: 'works-funny-click', targets: { sensors: { status: 'required' } } },
        ],
    };
    assert.equal(validateBrowserJourney(journey, contract).status, 'PASS');

    journey.steps[1].covers = ['unknown-event'];
    const report = validateBrowserJourney(journey, contract);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /covers unknown contract event id: unknown-event/);
    assert.match(report.issues.join('\n'), /does not cover required contract event id: works-funny-exposure/);
});

test('version 3 rejects missing, invalid, and duplicate contract event ids', () => {
    const journey = v3Journey();
    const contract = {
        events: [
            { targets: { sensors: { status: 'required' } } },
            { id: 'Invalid_ID', targets: { sensors: { status: 'required' } } },
            { id: 'works-funny-click', targets: { sensors: { status: 'required' } } },
            { id: 'works-funny-click', targets: { sensors: { status: 'required' } } },
        ],
    };

    const report = validateBrowserJourney(journey, contract);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /events\[0\]\.id is required/);
    assert.match(report.issues.join('\n'), /events\[1\]\.id must use lowercase/);
    assert.match(report.issues.join('\n'), /contract event id must be unique: works-funny-click/);
});

test('non-array steps return INVALID instead of throwing during coverage validation', () => {
    const journey = v3Journey();
    journey.steps = {};
    const contract = {
        events: [{ id: 'works-funny-click', targets: { sensors: { status: 'required' } } }],
    };

    const report = validateBrowserJourney(journey, contract);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /steps must contain at least one step/);
});

test('version 3 coverage is scoped to required Sensors targets', () => {
    const journey = v3Journey();
    const contract = {
        events: [
            { id: 'works-funny-exposure', targets: { sensors: { status: 'required' } } },
            { id: 'works-funny-click', targets: { sensors: { status: 'required' } } },
            { id: 'ga-only-event', targets: { sensors: { status: 'disabled' }, ga4: { status: 'required' } } },
        ],
    };

    assert.equal(validateBrowserJourney(journey, contract).status, 'PASS');
});

test('version 3 blocks an unknown Sensors environment requirement before browser actions', () => {
    const journey = v3Journey();
    const contract = {
        events: [{
            id: 'works-funny-click',
            targets: { sensors: { status: 'required' } },
            validation: {
                environments: {
                    local: { status: 'unknown', evidence: [] },
                },
            },
        }],
    };

    const report = validateBrowserJourney(journey, contract);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /environment local is unknown/);
});

test('href locators and URL expectations cannot leave the authorized origin', () => {
    const journey = v3Journey();
    journey.steps[2].locator = { type: 'href', value: 'https://evil.example/phish' };
    journey.steps[2].expect = { type: 'url', value: 'https://evil.example/phish' };
    journey.steps.push({
        id: 'unsafe-url-expectation',
        action: 'expect-url',
        value: 'javascript:alert(1)',
    });

    const report = validateBrowserJourney(journey);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /locator\.value origin must equal startUrl origin/);
    assert.match(report.issues.join('\n'), /expect\.value origin must equal startUrl origin/);
    assert.match(report.issues.join('\n'), /must use http or https/);
});

test('positional CSS is rejected at the target and in recursive scopes', () => {
    const journey = v3Journey();
    journey.steps[0].locator = { type: 'css', value: '.works > :nth-child(2)' };
    journey.steps[2].locator.scope = { type: 'css', value: 'li:first-of-type' };
    const report = validateBrowserJourney(journey);
    assert.equal(report.status, 'INVALID');
    assert.equal(report.issues.filter(issue => /unstable positional CSS selector/.test(issue)).length, 2);
});

test('unknown fields are rejected at root, step, locator, expectation, and verification levels', () => {
    const journey = v3Journey();
    journey.unknownRoot = true;
    journey.steps[0].unknownStep = true;
    journey.steps[0].locator.unknownLocator = true;
    journey.steps[0].expect.unknownExpectation = true;
    journey.verification.unknownVerification = true;
    const report = validateBrowserJourney(journey);
    assert.equal(report.status, 'INVALID');
    assert.equal(report.issues.filter(issue => /is unsupported/.test(issue)).length, 5);
});

test('expectations validate all supported types and reject malformed values', () => {
    const journey = v3Journey();
    journey.steps.push(
        {
            id: 'attribute-expectation',
            action: 'scroll-into-view',
            locator: { type: 'testId', value: 'funny-link' },
            expect: { type: 'attribute', attribute: 'aria-current', value: 'page' },
        },
        {
            id: 'element-expectation',
            action: 'expect-visible',
            locator: { type: 'testId', value: 'funny-page' },
            expect: { type: 'visibleElement', locator: { type: 'testId', value: 'funny-page' } },
        },
        {
            id: 'url-expectation',
            action: 'expect-url',
            value: 'http://localhost:3001/works/funny',
            expect: { type: 'url', value: '/works/funny' },
        },
    );
    assert.equal(validateBrowserJourney(journey).status, 'PASS');

    journey.steps[0].expect = { type: 'selected', value: 'true' };
    journey.steps[2].expect = { type: 'attribute', value: true };
    const report = validateBrowserJourney(journey);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /boolean for selected/);
    assert.match(report.issues.join('\n'), /attribute is required/);
    assert.match(report.issues.join('\n'), /string for attribute/);
});

test('retry wait falls back to ingestion wait and must be at least 60 for two attempts', () => {
    const journey = v3Journey();
    delete journey.verification.retryWaitSeconds;
    journey.verification.ingestionWaitSeconds = 60;
    let report = validateBrowserJourney(journey);
    assert.equal(report.status, 'PASS');
    assert.equal(report.verification.retryWaitSeconds, 60);

    journey.verification.ingestionWaitSeconds = 59;
    report = validateBrowserJourney(journey);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /at least 60/);

    journey.verification.maxQueryAttempts = 1;
    journey.verification.ingestionWaitSeconds = 1800;
    report = validateBrowserJourney(journey);
    assert.equal(report.status, 'PASS');

    journey.verification.ingestionWaitSeconds = 1801;
    report = validateBrowserJourney(journey);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /0 to 1800/);
});
