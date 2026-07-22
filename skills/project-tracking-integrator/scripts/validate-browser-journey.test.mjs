import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateBrowserJourney } from './validate-browser-journey.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.resolve(directory, '../references/browser-journey.example.json');
const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));

test('browser journey example is valid', () => {
    assert.deepEqual(validateBrowserJourney(example), {
        status: 'PASS',
        name: 'qa-discount-popup-claim',
        stepCount: 3,
        issues: [],
    });
});

test('browser journey cannot navigate outside the verification environment', () => {
    const journey = structuredClone(example);
    journey.steps[0].url = 'https://www.imastudio.com/example';
    const report = validateBrowserJourney(journey);
    assert.equal(report.status, 'INVALID');
    assert.match(report.issues.join('\n'), /hostname must equal environmentHost/);
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
