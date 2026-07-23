import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateBrowserJourney } from './validate-browser-journey.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.resolve(directory, '../references/browser-journey.example.json');
const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));

function productionJourney() {
    const journey = structuredClone(example);
    journey.name = 'production-safe-smoke';
    journey.environment = 'production';
    journey.startUrl = 'https://www.imastudio.com/example';
    journey.steps[0].url = 'https://www.imastudio.com/example';
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
        stepCount: 3,
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
