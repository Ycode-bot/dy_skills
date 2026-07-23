#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTIONS = new Set(['goto', 'click', 'fill', 'select', 'press', 'expect-visible', 'expect-url']);
const LOCATOR_TYPES = new Set(['testId', 'dataAttribute', 'href', 'role', 'label', 'placeholder', 'text', 'css']);
const ENVIRONMENTS = new Set(['local', 'qa', 'production']);

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

function isLocalHostname(hostname) {
    return hostname === 'localhost'
        || hostname === '::1'
        || hostname === '[::1]'
        || /^127(?:\.\d{1,3}){3}$/.test(hostname)
        || hostname.endsWith('.local');
}

function validateEnvironment(environment, startUrl, issues) {
    if (!ENVIRONMENTS.has(environment)) {
        issues.push('environment must be local, qa, or production');
        return;
    }
    if (!startUrl) return;
    if (environment === 'local' && !isLocalHostname(startUrl.hostname)) {
        issues.push('local journey must use localhost, loopback IP, or a .local hostname');
    }
    if (environment === 'qa' && startUrl.hostname !== 'qa.imastudio.com') {
        issues.push('qa journey must use qa.imastudio.com');
    }
    if (environment === 'production' && startUrl.hostname !== 'www.imastudio.com') {
        issues.push('production journey must use www.imastudio.com');
    }
}

function validateProductionSafety(journey, contract, startUrl, issues) {
    const isProduction = journey.environment === 'production'
        || journey.environmentHost === 'www.imastudio.com';
    if (!isProduction) return;
    if (!isObject(contract) || !Array.isArray(contract.events) || contract.events.length === 0) {
        issues.push('production journey requires a readable tracking contract before browser actions');
        return;
    }
    const productionProfile = contract.environments?.production;
    if (!productionProfile?.startUrl) {
        issues.push('production contract must define environments.production.startUrl');
    }
    else {
        const contractUrl = requireHttpUrl(productionProfile.startUrl, 'contract environments.production.startUrl', issues);
        if (contractUrl && startUrl && contractUrl.origin !== startUrl.origin) {
            issues.push('production journey origin must equal the production contract origin');
        }
    }

    const unsafeEvents = contract.events.filter(event => {
        const targets = event.targets || { sensors: { status: 'required' } };
        const hasRequiredTarget = Object.values(targets).some(target => target?.status === 'required');
        if (!hasRequiredTarget) return false;
        const requirement = event.validation?.environments?.production;
        if (['optional', 'disabled'].includes(requirement?.status)) return false;
        return requirement?.status !== 'required' || requirement.smokeSafe !== true;
    });
    if (unsafeEvents.length > 0) {
        const ids = unsafeEvents.map((event, index) => event.id || event.event || `event-${index + 1}`);
        issues.push(`production journey is blocked because smokeSafe is not true for: ${ids.join(', ')}`);
    }
}

export function validateBrowserJourney(journey, contract = null) {
    const issues = [];
    if (!isObject(journey)) {
        return { status: 'INVALID', issues: ['journey must be an object'] };
    }
    if (![1, 2].includes(journey.version)) issues.push('version must equal 1 or 2');
    if (!nonEmpty(journey.name)) issues.push('name is required');

    const startUrl = requireHttpUrl(journey.startUrl, 'startUrl', issues);
    if (journey.version === 1) {
        if (!nonEmpty(journey.environmentHost)) issues.push('environmentHost is required for version 1');
        if (startUrl && nonEmpty(journey.environmentHost) && startUrl.hostname !== journey.environmentHost) {
            issues.push('startUrl hostname must equal environmentHost');
        }
    }
    if (journey.version === 2) {
        validateEnvironment(journey.environment, startUrl, issues);
    }
    validateProductionSafety(journey, contract, startUrl, issues);

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
                if (url && startUrl && url.origin !== startUrl.origin) {
                    issues.push(`${label}.url origin must equal startUrl origin`);
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
        environment: journey.environment || null,
        environmentValue: startUrl?.host || null,
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
    let contract = null;
    const isProduction = journey.environment === 'production'
        || journey.environmentHost === 'www.imastudio.com';
    if (isProduction && nonEmpty(journey.verification?.contract)) {
        try {
            const contractFile = path.resolve(path.dirname(file), journey.verification.contract);
            contract = JSON.parse(fs.readFileSync(contractFile, 'utf8'));
        }
        catch {
            contract = null;
        }
    }
    const report = validateBrowserJourney(journey, contract);
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (args.out) fs.writeFileSync(path.resolve(args.out), output);
    else process.stdout.write(output);
    if (report.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
