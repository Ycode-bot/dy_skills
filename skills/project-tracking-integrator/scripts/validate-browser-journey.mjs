#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ACTIONS = new Set(['goto', 'click', 'fill', 'select', 'press', 'hover', 'scroll-into-view', 'expect-visible', 'expect-url']);
const LOCATOR_TYPES = new Set(['testId', 'dataAttribute', 'href', 'role', 'label', 'placeholder', 'text', 'css']);
const ENVIRONMENTS = new Set(['local', 'qa', 'production']);
const EXPECTATION_TYPES = new Set(['visibleText', 'visibleElement', 'url', 'attribute', 'selected']);
const ROOT_FIELDS = new Set(['version', 'name', 'startUrl', 'environment', 'environmentHost', 'steps', 'verification']);
const STEP_FIELDS = new Set(['id', 'action', 'url', 'locator', 'value', 'covers', 'expect']);
const LOCATOR_FIELDS = new Set(['type', 'value', 'role', 'name', 'attribute', 'exact', 'scope']);
const EXPECTATION_FIELDS = new Set(['type', 'value', 'locator', 'attribute']);
const VERIFICATION_FIELDS = new Set([
    'contract',
    'sinceMinutes',
    'ingestionWaitSeconds',
    'retryWaitSeconds',
    'maxQueryAttempts',
    'consolePattern',
]);
const POSITIONAL_CSS = /:(?:nth-(?:last-)?(?:child|of-type)\s*\(|(?:first|last|only)-(?:child|of-type)\b|(?:first|last)\b|eq\s*\()/i;
const CONTRACT_EVENT_ID = /^[a-z0-9][a-z0-9-]*$/;

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function rejectUnknownFields(value, allowed, label, issues) {
    if (!isObject(value)) return;
    for (const field of Object.keys(value)) {
        if (!allowed.has(field)) issues.push(`${label}.${field} is unsupported`);
    }
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

function validateSameOriginReference(value, startUrl, label, issues) {
    if (!nonEmpty(value) || !startUrl) return;
    let resolved;
    try {
        resolved = new URL(value, startUrl);
    }
    catch {
        issues.push(`${label} must be a valid URL or relative URL`);
        return;
    }
    if (!['http:', 'https:'].includes(resolved.protocol)) {
        issues.push(`${label} must use http or https`);
    }
    else if (resolved.origin !== startUrl.origin) {
        issues.push(`${label} origin must equal startUrl origin`);
    }
}

function validateLocator(locator, label, issues, startUrl = null, ancestors = new Set()) {
    if (!isObject(locator)) {
        issues.push(`${label} must be an object`);
        return;
    }
    if (ancestors.has(locator)) {
        issues.push(`${label}.scope must not contain a cycle`);
        return;
    }
    const nextAncestors = new Set(ancestors).add(locator);
    rejectUnknownFields(locator, LOCATOR_FIELDS, label, issues);
    if (!LOCATOR_TYPES.has(locator.type)) {
        issues.push(`${label}.type is unsupported`);
        return;
    }
    if (locator.type === 'role') {
        if (!nonEmpty(locator.role) || !nonEmpty(locator.name)) {
            issues.push(`${label} role locator requires role and name`);
        }
    }
    else if (!nonEmpty(locator.value)) {
        issues.push(`${label}.value is required`);
    }
    if (locator.type === 'dataAttribute' && !nonEmpty(locator.attribute)) {
        issues.push(`${label}.attribute is required for dataAttribute`);
    }
    if (locator.type === 'href' && nonEmpty(locator.value)) {
        validateSameOriginReference(locator.value, startUrl, `${label}.value`, issues);
    }
    if (locator.exact !== undefined && typeof locator.exact !== 'boolean') {
        issues.push(`${label}.exact must be a boolean`);
    }
    if (locator.type === 'css' && nonEmpty(locator.value) && POSITIONAL_CSS.test(locator.value)) {
        issues.push(`${label}.value uses an unstable positional CSS selector`);
    }
    if (locator.scope !== undefined) {
        validateLocator(locator.scope, `${label}.scope`, issues, startUrl, nextAncestors);
    }
}

function validateExpectation(expectation, label, issues, startUrl = null) {
    if (!isObject(expectation)) {
        issues.push(`${label} must be an object`);
        return;
    }
    rejectUnknownFields(expectation, EXPECTATION_FIELDS, label, issues);
    if (!EXPECTATION_TYPES.has(expectation.type)) {
        issues.push(`${label}.type is unsupported`);
        return;
    }
    if (expectation.locator !== undefined) {
        validateLocator(expectation.locator, `${label}.locator`, issues, startUrl);
    }
    if (['visibleText', 'url'].includes(expectation.type) && !nonEmpty(expectation.value)) {
        issues.push(`${label}.value is required for ${expectation.type}`);
    }
    if (expectation.type === 'visibleElement'
        && !nonEmpty(expectation.value)
        && !isObject(expectation.locator)) {
        issues.push(`${label} visibleElement requires value or locator`);
    }
    if (expectation.type === 'attribute') {
        if (!nonEmpty(expectation.attribute)) issues.push(`${label}.attribute is required for attribute`);
        if (typeof expectation.value !== 'string') issues.push(`${label}.value must be a string for attribute`);
    }
    if (expectation.type === 'selected' && typeof expectation.value !== 'boolean') {
        issues.push(`${label}.value must be a boolean for selected`);
    }
    if (expectation.type === 'url' && nonEmpty(expectation.value)) {
        validateSameOriginReference(expectation.value, startUrl, `${label}.value`, issues);
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
    const isProduction = isObject(journey) && (journey.environment === 'production'
        || journey.environmentHost === 'www.imastudio.com');
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

    const coveredIds = new Set(
        (Array.isArray(journey.steps) ? journey.steps : [])
            .flatMap(step => Array.isArray(step?.covers) ? step.covers : []),
    );
    const unsafeEvents = contract.events.filter(event => {
        const requirement = event.validation?.environments?.production;
        if (nonEmpty(event?.id) && coveredIds.has(event.id)) {
            return requirement?.smokeSafe !== true;
        }
        const targets = event.targets || { sensors: { status: 'required' } };
        const hasRequiredTarget = Object.values(targets).some(target => target?.status === 'required');
        if (!hasRequiredTarget) return false;
        if (['optional', 'disabled'].includes(requirement?.status)) return false;
        return requirement?.status !== 'required' || requirement.smokeSafe !== true;
    });
    if (unsafeEvents.length > 0) {
        const ids = unsafeEvents.map((event, index) => event.id || event.event || `event-${index + 1}`);
        issues.push(`production journey is blocked because smokeSafe is not true for: ${ids.join(', ')}`);
    }
}

function validateEventCoverage(journey, contract, issues) {
    if (journey.version !== 3 || !isObject(contract) || !Array.isArray(contract.events)) return;
    const contractIds = new Set();
    contract.events.forEach((event, index) => {
        const id = event?.id;
        if (!nonEmpty(id)) {
            issues.push(`contract.events[${index}].id is required for version 3 browser verification`);
        }
        else if (!CONTRACT_EVENT_ID.test(id)) {
            issues.push(`contract.events[${index}].id must use lowercase letters, numbers, and hyphens`);
        }
        else if (contractIds.has(id)) {
            issues.push(`contract event id must be unique: ${id}`);
        }
        else {
            contractIds.add(id);
        }
    });
    const coveredIds = new Set(
        (Array.isArray(journey.steps) ? journey.steps : [])
            .flatMap(step => Array.isArray(step?.covers) ? step.covers : []),
    );
    for (const coveredId of coveredIds) {
        if (!contractIds.has(coveredId)) {
            issues.push(`journey covers unknown contract event id: ${coveredId}`);
        }
    }
    const requiredIds = contract.events.filter(event => {
        const targets = event?.targets || { sensors: { status: 'required' } };
        if (targets.sensors?.status !== 'required') return false;
        const requirement = event?.validation?.environments?.[journey.environment];
        if (requirement?.status === 'unknown') {
            issues.push(`contract event ${event?.id || 'without id'} environment ${journey.environment} is unknown`);
            return false;
        }
        return !['optional', 'disabled'].includes(requirement?.status);
    }).map(event => event?.id).filter(nonEmpty);
    for (const requiredId of requiredIds) {
        if (!coveredIds.has(requiredId)) {
            issues.push(`journey does not cover required contract event id: ${requiredId}`);
        }
    }
}

export function validateBrowserJourney(journey, contract = null) {
    const issues = [];
    if (!isObject(journey)) {
        return { status: 'INVALID', issues: ['journey must be an object'] };
    }
    rejectUnknownFields(journey, ROOT_FIELDS, 'journey', issues);
    if (![1, 2, 3].includes(journey.version)) issues.push('version must equal 1, 2, or 3');
    if (!nonEmpty(journey.name)) issues.push('name is required');

    const startUrl = requireHttpUrl(journey.startUrl, 'startUrl', issues);
    if (journey.version === 1) {
        if (!nonEmpty(journey.environmentHost)) issues.push('environmentHost is required for version 1');
        if (startUrl && nonEmpty(journey.environmentHost) && startUrl.hostname !== journey.environmentHost) {
            issues.push('startUrl hostname must equal environmentHost');
        }
    }
    if ([2, 3].includes(journey.version)) {
        validateEnvironment(journey.environment, startUrl, issues);
    }
    validateProductionSafety(journey, contract, startUrl, issues);

    if (!Array.isArray(journey.steps) || journey.steps.length === 0) {
        issues.push('steps must contain at least one step');
    } else {
        const stepIds = new Set();
        journey.steps.forEach((step, index) => {
            const label = `steps[${index}]`;
            if (!isObject(step)) {
                issues.push(`${label} must be an object`);
                return;
            }
            rejectUnknownFields(step, STEP_FIELDS, label, issues);
            if (!ACTIONS.has(step.action)) {
                issues.push(`${label}.action is unsupported`);
                return;
            }
            if (journey.version === 3) {
                if (!nonEmpty(step.id)) issues.push(`${label}.id is required for version 3`);
                else if (stepIds.has(step.id)) issues.push(`${label}.id must be unique`);
                else stepIds.add(step.id);
                if (step.covers !== undefined) {
                    if (!Array.isArray(step.covers) || step.covers.length === 0) {
                        issues.push(`${label}.covers must contain at least one event id`);
                    }
                    else {
                        const invalidCoverage = step.covers.some(eventId => !nonEmpty(eventId));
                        if (invalidCoverage) issues.push(`${label}.covers must contain non-empty event ids`);
                        if (new Set(step.covers).size !== step.covers.length) {
                            issues.push(`${label}.covers must not contain duplicate event ids`);
                        }
                    }
                }
                if (['click', 'hover'].includes(step.action) && !isObject(step.expect)) {
                    issues.push(`${label}.expect is required for ${step.action} in version 3`);
                }
            }
            if (step.action === 'goto') {
                const url = requireHttpUrl(step.url, `${label}.url`, issues);
                if (url && startUrl && url.origin !== startUrl.origin) {
                    issues.push(`${label}.url origin must equal startUrl origin`);
                }
            }
            if (['click', 'fill', 'select', 'press', 'hover', 'scroll-into-view', 'expect-visible'].includes(step.action)) {
                validateLocator(step.locator, `${label}.locator`, issues, startUrl);
            }
            if (['fill', 'select', 'press', 'expect-url'].includes(step.action) && !nonEmpty(step.value)) {
                issues.push(`${label}.value is required for ${step.action}`);
            }
            if (step.action === 'expect-url' && nonEmpty(step.value)) {
                validateSameOriginReference(step.value, startUrl, `${label}.value`, issues);
            }
            if (step.expect !== undefined) {
                validateExpectation(step.expect, `${label}.expect`, issues, startUrl);
            }
        });
    }
    validateEventCoverage(journey, contract, issues);

    const verification = journey.verification;
    let parsedVerification = null;
    if (!isObject(verification)) {
        issues.push('verification is required');
    } else {
        rejectUnknownFields(verification, VERIFICATION_FIELDS, 'verification', issues);
        if (!nonEmpty(verification.contract)) issues.push('verification.contract is required');
        const sinceMinutesIsValid = Number.isInteger(verification.sinceMinutes)
            && verification.sinceMinutes >= 1
            && verification.sinceMinutes <= 1440;
        if ([1, 2].includes(journey.version) && !sinceMinutesIsValid) {
            issues.push('verification.sinceMinutes must be an integer from 1 to 1440');
        }
        if (journey.version === 3 && verification.sinceMinutes !== undefined && !sinceMinutesIsValid) {
            issues.push('verification.sinceMinutes must be an integer from 1 to 1440 when provided');
        }
        const ingestionWaitIsValid = Number.isInteger(verification.ingestionWaitSeconds)
            && verification.ingestionWaitSeconds >= 0
            && verification.ingestionWaitSeconds <= 1800;
        if (!ingestionWaitIsValid) {
            issues.push('verification.ingestionWaitSeconds must be an integer from 0 to 1800');
        }
        const retryWaitIsValid = verification.retryWaitSeconds === undefined
            || (Number.isInteger(verification.retryWaitSeconds)
                && verification.retryWaitSeconds >= 0
                && verification.retryWaitSeconds <= 1800);
        if (!retryWaitIsValid) {
            issues.push('verification.retryWaitSeconds must be an integer from 0 to 1800 when provided');
        }
        if (!Number.isInteger(verification.maxQueryAttempts) || verification.maxQueryAttempts < 1 || verification.maxQueryAttempts > 2) {
            issues.push('verification.maxQueryAttempts must be 1 or 2');
        }
        const retryWaitSeconds = verification.retryWaitSeconds ?? verification.ingestionWaitSeconds;
        if (verification.maxQueryAttempts === 2
            && Number.isInteger(retryWaitSeconds)
            && retryWaitSeconds < 60) {
            issues.push('verification.retryWaitSeconds must be at least 60 when maxQueryAttempts is 2');
        }
        if (verification.consolePattern !== undefined && !nonEmpty(verification.consolePattern)) {
            issues.push('verification.consolePattern must be a non-empty string');
        }
        else if (verification.consolePattern !== undefined) {
            try {
                new RegExp(verification.consolePattern, 'i');
            } catch {
                issues.push('verification.consolePattern must be a valid regular expression');
            }
        }
        parsedVerification = {
            contract: verification.contract ?? null,
            ...(verification.sinceMinutes !== undefined ? { sinceMinutes: verification.sinceMinutes } : {}),
            ingestionWaitSeconds: verification.ingestionWaitSeconds ?? null,
            retryWaitSeconds: retryWaitSeconds ?? null,
            maxQueryAttempts: verification.maxQueryAttempts ?? null,
            ...(verification.consolePattern !== undefined ? { consolePattern: verification.consolePattern } : {}),
        };
    }

    return {
        status: issues.length === 0 ? 'PASS' : 'INVALID',
        name: journey.name ?? null,
        environment: journey.environment || null,
        environmentValue: startUrl?.host || null,
        stepCount: Array.isArray(journey.steps) ? journey.steps.length : 0,
        verification: parsedVerification,
        issues,
    };
}

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--journey') args.journey = argv[index + 1];
        if (argv[index] === '--bundle') args.bundle = argv[index + 1];
        if (argv[index] === '--out') args.out = argv[index + 1];
    }
    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (Boolean(args.journey) === Boolean(args.bundle)) {
        console.error('Usage: validate-browser-journey.mjs (--journey <journey.json> | --bundle <verification-bundle.json>) [--out <report.json>]');
        process.exitCode = 2;
        return;
    }
    const file = path.resolve(args.bundle || args.journey);
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    const journey = args.bundle ? document.journey : document;
    let contract = null;
    if (args.bundle) contract = document.contract || null;
    const isProduction = journey.environment === 'production'
        || journey.environmentHost === 'www.imastudio.com';
    if (!args.bundle && isProduction && nonEmpty(journey.verification?.contract)) {
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
