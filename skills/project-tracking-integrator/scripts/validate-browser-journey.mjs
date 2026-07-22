#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTIONS = new Set(['goto', 'click', 'fill', 'select', 'press', 'expect-visible', 'expect-url']);
const LOCATOR_TYPES = new Set(['testId', 'dataAttribute', 'href', 'role', 'label', 'placeholder', 'text', 'css']);

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function requireHttpUrl(value, label, issues) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) {
            issues.push(`${label} must use http or https`);
            return null;
        }
        return url;
    } catch {
        issues.push(`${label} must be a valid URL`);
        return null;
    }
}

function validateLocator(locator, label, issues) {
    if (!isObject(locator)) {
        issues.push(`${label} must be an object`);
        return;
    }
    if (!LOCATOR_TYPES.has(locator.type)) {
        issues.push(`${label}.type is unsupported`);
        return;
    }
    if (locator.type === 'role') {
        if (!nonEmpty(locator.role) || !nonEmpty(locator.name)) {
            issues.push(`${label} role locator requires role and name`);
        }
        return;
    }
    if (!nonEmpty(locator.value)) {
        issues.push(`${label}.value is required`);
    }
    if (locator.type === 'dataAttribute' && !nonEmpty(locator.attribute)) {
        issues.push(`${label}.attribute is required for dataAttribute`);
    }
}

export function validateBrowserJourney(journey) {
    const issues = [];
    if (!isObject(journey)) {
        return { status: 'INVALID', issues: ['journey must be an object'] };
    }
    if (journey.version !== 1) issues.push('version must equal 1');
    if (!nonEmpty(journey.name)) issues.push('name is required');
    if (!nonEmpty(journey.environmentHost)) issues.push('environmentHost is required');

    const startUrl = requireHttpUrl(journey.startUrl, 'startUrl', issues);
    if (startUrl && nonEmpty(journey.environmentHost) && startUrl.hostname !== journey.environmentHost) {
        issues.push('startUrl hostname must equal environmentHost');
    }

    if (!Array.isArray(journey.steps) || journey.steps.length === 0) {
        issues.push('steps must contain at least one step');
    } else {
        journey.steps.forEach((step, index) => {
            const label = `steps[${index}]`;
            if (!isObject(step) || !ACTIONS.has(step.action)) {
                issues.push(`${label}.action is unsupported`);
                return;
            }
            if (step.action === 'goto') {
                const url = requireHttpUrl(step.url, `${label}.url`, issues);
                if (url && nonEmpty(journey.environmentHost) && url.hostname !== journey.environmentHost) {
                    issues.push(`${label}.url hostname must equal environmentHost`);
                }
            }
            if (['click', 'fill', 'select', 'press', 'expect-visible'].includes(step.action)) {
                validateLocator(step.locator, `${label}.locator`, issues);
            }
            if (['fill', 'select', 'press', 'expect-url'].includes(step.action) && !nonEmpty(step.value)) {
                issues.push(`${label}.value is required for ${step.action}`);
            }
        });
    }

    const verification = journey.verification;
    if (!isObject(verification)) {
        issues.push('verification is required');
    } else {
        if (!nonEmpty(verification.contract)) issues.push('verification.contract is required');
        if (!Number.isInteger(verification.sinceMinutes) || verification.sinceMinutes < 1 || verification.sinceMinutes > 1440) {
            issues.push('verification.sinceMinutes must be an integer from 1 to 1440');
        }
        if (!Number.isInteger(verification.ingestionWaitSeconds) || verification.ingestionWaitSeconds < 0 || verification.ingestionWaitSeconds > 60) {
            issues.push('verification.ingestionWaitSeconds must be an integer from 0 to 60');
        }
        if (!Number.isInteger(verification.maxQueryAttempts) || verification.maxQueryAttempts < 1 || verification.maxQueryAttempts > 2) {
            issues.push('verification.maxQueryAttempts must be 1 or 2');
        }
        if (verification.consolePattern !== undefined) {
            try {
                new RegExp(verification.consolePattern, 'i');
            } catch {
                issues.push('verification.consolePattern must be a valid regular expression');
            }
        }
    }

    return {
        status: issues.length === 0 ? 'PASS' : 'INVALID',
        name: journey.name ?? null,
        stepCount: Array.isArray(journey.steps) ? journey.steps.length : 0,
        issues,
    };
}

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--journey') args.journey = argv[index + 1];
        if (argv[index] === '--out') args.out = argv[index + 1];
    }
    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.journey) {
        console.error('Usage: validate-browser-journey.mjs --journey <journey.json> [--out <report.json>]');
        process.exitCode = 2;
        return;
    }
    const file = path.resolve(args.journey);
    const journey = JSON.parse(fs.readFileSync(file, 'utf8'));
    const report = validateBrowserJourney(journey);
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (args.out) fs.writeFileSync(path.resolve(args.out), output);
    else process.stdout.write(output);
    if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
