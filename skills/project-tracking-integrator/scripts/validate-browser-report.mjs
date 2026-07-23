#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ENVIRONMENTS = new Set(['local', 'qa', 'production']);
const LOCATOR_ACTIONS = new Set(['click', 'hover', 'fill', 'select', 'press', 'scroll-into-view', 'expect-visible']);
const EXPECTATION_ACTIONS = new Set(['click', 'hover']);
const STEP_STATUSES = new Set(['PASS', 'FAILED', 'BLOCKED']);
const RESULT_STATUSES = new Set(['PASS', 'FAILED', 'BLOCKED', 'NOT_AVAILABLE', 'NOT_SENT', 'CONTRACT_MISMATCH']);
const EXPECTATION_TYPES = new Set(['visibleText', 'visibleElement', 'url', 'attribute', 'selected']);
const REPORT_FIELDS = new Set([
    'version',
    'journeyName',
    'environment',
    'environmentProperty',
    'environmentValue',
    'triggerWindow',
    'steps',
    'results',
]);
const TRIGGER_WINDOW_FIELDS = new Set(['startedAt', 'finishedAt']);
const STEP_FIELDS = new Set([
    'id',
    'action',
    'status',
    'locator',
    'matchCount',
    'resolvedAt',
    'executedAt',
    'resolvedElement',
    'expectation',
]);
const LOCATOR_FIELDS = new Set(['type', 'value', 'role', 'name', 'attribute', 'exact', 'scope']);
const RESOLVED_ELEMENT_FIELDS = new Set(['role', 'name', 'href', 'scope']);
const EXPECTATION_FIELDS = new Set(['type', 'status', 'value', 'locator', 'attribute']);
const RESULT_FIELDS = new Set(['id', 'platform', 'status', 'method']);
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

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

function parseIsoDate(value, label, issues) {
    if (!nonEmpty(value) || !ISO_DATE_TIME.test(value)) {
        issues.push(`${label} must be a non-empty ISO-8601 timestamp`);
        return null;
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
        issues.push(`${label} must be a valid ISO-8601 timestamp`);
        return null;
    }
    return parsed;
}

function validateResolvedElement(value, label, issues) {
    if (value === undefined) return;
    if (!isObject(value)) {
        issues.push(`${label} must be an object`);
        return;
    }
    rejectUnknownFields(value, RESOLVED_ELEMENT_FIELDS, label, issues);
    const allowed = ['role', 'name', 'href', 'scope'];
    if (!allowed.some(key => nonEmpty(value[key]))) {
        issues.push(`${label} must record at least one of role, name, href, or scope`);
    }
    for (const key of allowed) {
        if (value[key] !== undefined && !nonEmpty(value[key])) {
            issues.push(`${label}.${key} must be a non-empty string`);
        }
    }
}

function validateLocator(value, label, issues, ancestors = new Set()) {
    if (!isObject(value)) {
        issues.push(`${label} must be an object`);
        return;
    }
    if (ancestors.has(value)) {
        issues.push(`${label}.scope must not contain a cycle`);
        return;
    }
    rejectUnknownFields(value, LOCATOR_FIELDS, label, issues);
    if (value.scope !== undefined) {
        validateLocator(value.scope, `${label}.scope`, issues, new Set(ancestors).add(value));
    }
}

function validateExpectation(value, label, issues) {
    if (value === undefined) return;
    if (!isObject(value)) {
        issues.push(`${label} must be an object`);
        return;
    }
    rejectUnknownFields(value, EXPECTATION_FIELDS, label, issues);
    if (value.type !== undefined && !EXPECTATION_TYPES.has(value.type)) {
        issues.push(`${label}.type is unsupported`);
    }
    if (value.status !== undefined && !STEP_STATUSES.has(value.status)) {
        issues.push(`${label}.status must be PASS, FAILED, or BLOCKED`);
    }
    if (value.value !== undefined && !['string', 'boolean'].includes(typeof value.value)) {
        issues.push(`${label}.value must be a string or boolean`);
    }
    if (value.locator !== undefined) validateLocator(value.locator, `${label}.locator`, issues);
    if (value.attribute !== undefined && !nonEmpty(value.attribute)) {
        issues.push(`${label}.attribute must be a non-empty string`);
    }
}

function validateEnvironment(report, journey, contract, issues) {
    if (!ENVIRONMENTS.has(report.environment)) {
        issues.push('report.environment must be local, qa, or production');
    }
    if (report.environment !== journey.environment) {
        issues.push('report.environment must equal journey.environment');
    }
    let expectedEnvironmentValue = '';
    try {
        expectedEnvironmentValue = new URL(journey.startUrl).host;
    }
    catch {
        issues.push('journey.startUrl must be a valid URL for environment evidence');
    }
    const contractQuery = contract?.environments?.[journey.environment]?.query || {};
    const expectedEnvironmentProperty = contractQuery.property || 'lmweb_url';
    if (report.environmentProperty !== expectedEnvironmentProperty) {
        issues.push(`report.environmentProperty must equal ${expectedEnvironmentProperty}`);
    }
    const contractValue = contractQuery.value || '';
    const expectedValue = contractValue || expectedEnvironmentValue;
    if (expectedValue && report.environmentValue !== expectedValue) {
        issues.push(contractValue
            ? 'report.environmentValue must equal the selected contract environment value'
            : 'report.environmentValue must equal the host from journey.startUrl');
    }
}

function validateTriggerWindow(report, issues) {
    if (!isObject(report.triggerWindow)) {
        issues.push('report.triggerWindow must be an object');
        return { startedAt: null, finishedAt: null };
    }
    rejectUnknownFields(report.triggerWindow, TRIGGER_WINDOW_FIELDS, 'report.triggerWindow', issues);
    const startedAt = parseIsoDate(report.triggerWindow.startedAt, 'report.triggerWindow.startedAt', issues);
    const finishedAt = parseIsoDate(report.triggerWindow.finishedAt, 'report.triggerWindow.finishedAt', issues);
    if (startedAt && finishedAt && finishedAt.getTime() < startedAt.getTime()) {
        issues.push('report.triggerWindow.finishedAt must not be before startedAt');
    }
    return { startedAt, finishedAt };
}

function normalizedText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function validateResolvedElementBinding(resolvedElement, locator, journey, action, label, issues) {
    if (!isObject(resolvedElement) || !isObject(locator)) return;
    if (locator.type === 'role') {
        if (!nonEmpty(resolvedElement.role) || normalizedText(resolvedElement.role) !== normalizedText(locator.role)) {
            issues.push(`${label}.resolvedElement.role must match the authorized role locator`);
        }
        const actualName = normalizedText(resolvedElement.name);
        const expectedName = normalizedText(locator.name);
        const nameMatches = locator.exact ? actualName === expectedName : actualName.includes(expectedName);
        if (!nonEmpty(resolvedElement.name) || !nameMatches) {
            issues.push(`${label}.resolvedElement.name must match the authorized role locator`);
        }
    }
    if (locator.type === 'href') {
        if (!nonEmpty(resolvedElement.href)) {
            issues.push(`${label}.resolvedElement.href is required for an href locator`);
            return;
        }
        try {
            const expectedHref = new URL(locator.value, journey.startUrl).href;
            const actualHref = new URL(resolvedElement.href, journey.startUrl).href;
            if (actualHref !== expectedHref) {
                issues.push(`${label}.resolvedElement.href must match the authorized href locator`);
            }
        }
        catch {
            issues.push(`${label}.resolvedElement.href must be a valid URL or relative URL`);
        }
    }
    if (action === 'click' && locator.type === 'role'
        && normalizedText(locator.role) === 'link'
        && !nonEmpty(resolvedElement.href)) {
        issues.push(`${label}.resolvedElement.href is required when clicking a role=link locator`);
    }
    if (action === 'click' && nonEmpty(resolvedElement.href)) {
        try {
            const resolvedHref = new URL(resolvedElement.href, journey.startUrl);
            if (!['http:', 'https:'].includes(resolvedHref.protocol)) {
                issues.push(`${label}.resolvedElement.href must use http or https before click`);
            }
            else if (resolvedHref.origin !== new URL(journey.startUrl).origin) {
                issues.push(`${label}.resolvedElement.href origin must equal journey.startUrl origin before click`);
            }
        }
        catch {
            issues.push(`${label}.resolvedElement.href must be a valid URL or relative URL before click`);
        }
    }
}

function isInsideWindow(value, triggerWindow) {
    return value && triggerWindow.startedAt && triggerWindow.finishedAt
        && value.getTime() >= triggerWindow.startedAt.getTime()
        && value.getTime() <= triggerWindow.finishedAt.getTime();
}

function validateSteps(report, journey, triggerWindow, issues) {
    if (!Array.isArray(journey.steps) || journey.steps.length === 0) {
        issues.push('journey.steps must contain at least one version 3 step');
        return;
    }
    if (!Array.isArray(report.steps)) {
        issues.push('report.steps must be an array');
        return;
    }
    if (report.steps.length !== journey.steps.length) {
        issues.push(`report.steps must contain exactly ${journey.steps.length} journey steps`);
    }

    const journeyIds = new Set();
    const reportIds = new Set();
    let previousExecutedAt = null;
    let previousResolvedAt = null;
    const length = Math.max(journey.steps.length, report.steps.length);
    for (let index = 0; index < length; index += 1) {
        const expected = journey.steps[index];
        const actual = report.steps[index];
        const label = `report.steps[${index}]`;

        if (isObject(expected)) {
            if (!nonEmpty(expected.id)) issues.push(`journey.steps[${index}].id is required for version 3`);
            else if (journeyIds.has(expected.id)) issues.push(`journey step id must be unique: ${expected.id}`);
            else journeyIds.add(expected.id);
        }
        if (!isObject(actual)) {
            issues.push(`${label} is missing or invalid`);
            continue;
        }
        rejectUnknownFields(actual, STEP_FIELDS, label, issues);
        if (!nonEmpty(actual.id)) issues.push(`${label}.id is required`);
        else if (reportIds.has(actual.id)) issues.push(`report step id must be unique: ${actual.id}`);
        else reportIds.add(actual.id);

        if (!isObject(expected)) {
            issues.push(`journey.steps[${index}] is invalid`);
            continue;
        }
        if (actual.id !== expected.id) issues.push(`${label}.id must equal journey step id ${expected.id}`);
        if (actual.action !== expected.action) issues.push(`${label}.action must equal journey action ${expected.action}`);
        if (!STEP_STATUSES.has(actual.status)) issues.push(`${label}.status must be PASS, FAILED, or BLOCKED`);
        else if (actual.status !== 'PASS') issues.push(`${label}.status must be PASS before ingestion verification`);

        let resolvedAt = null;
        if (LOCATOR_ACTIONS.has(expected.action)) {
            if (!isObject(actual.locator)) issues.push(`${label}.locator must record the resolved locator`);
            else if (!isDeepStrictEqual(actual.locator, expected.locator)) {
                issues.push(`${label}.locator must equal the locator authorized by the journey`);
            }
            if (isObject(actual.locator)) validateLocator(actual.locator, `${label}.locator`, issues);
            if (!Number.isInteger(actual.matchCount) || actual.matchCount < 0) {
                issues.push(`${label}.matchCount must be a non-negative integer for locator actions`);
            }
            else if (actual.status === 'PASS' && actual.matchCount !== 1) {
                issues.push(`${label}.matchCount must equal 1 when a locator action passes`);
            }
            resolvedAt = parseIsoDate(actual.resolvedAt, `${label}.resolvedAt for locator step ${expected.id}`, issues);
            if (!isObject(actual.resolvedElement)) {
                issues.push(`${label}.resolvedElement is required for locator actions`);
            }
            validateResolvedElementBinding(actual.resolvedElement, expected.locator, journey, expected.action, label, issues);
        }

        validateResolvedElement(actual.resolvedElement, `${label}.resolvedElement`, issues);
        validateExpectation(actual.expectation, `${label}.expectation`, issues);
        if ((EXPECTATION_ACTIONS.has(expected.action) || expected.expect !== undefined)
            && actual.expectation?.status !== 'PASS') {
            issues.push(`${label}.expectation.status must be PASS for ${expected.action}`);
        }
        if (expected.expect !== undefined) {
            for (const field of ['type', 'value', 'locator', 'attribute']) {
                if (!isDeepStrictEqual(actual.expectation?.[field], expected.expect[field])) {
                    issues.push(`${label}.expectation.${field} must equal the journey expectation ${field}`);
                }
            }
        }

        const executedAt = parseIsoDate(actual.executedAt, `${label}.executedAt`, issues);
        const coversEvents = Array.isArray(expected.covers) && expected.covers.length > 0;
        if (coversEvents && executedAt && !isInsideWindow(executedAt, triggerWindow)) {
            issues.push(`${label}.executedAt must fall within report.triggerWindow`);
        }
        if (coversEvents && resolvedAt && !isInsideWindow(resolvedAt, triggerWindow)) {
            issues.push(`${label}.resolvedAt must fall within report.triggerWindow`);
        }
        if (executedAt && resolvedAt && resolvedAt.getTime() > executedAt.getTime()) {
            issues.push(`${label}.resolvedAt must not be after executedAt`);
        }
        if (resolvedAt && previousExecutedAt && resolvedAt.getTime() < previousExecutedAt.getTime()) {
            issues.push(`${label}.resolvedAt must be fresh after the previous step executedAt`);
        }
        if (executedAt && previousExecutedAt && executedAt.getTime() < previousExecutedAt.getTime()) {
            issues.push(`${label}.executedAt must preserve journey step order`);
        }
        if (resolvedAt && previousResolvedAt && resolvedAt.getTime() < previousResolvedAt.getTime()) {
            issues.push(`${label}.resolvedAt must preserve journey step order`);
        }
        if (executedAt) previousExecutedAt = executedAt;
        if (resolvedAt) previousResolvedAt = resolvedAt;
    }
}

function validateResults(report, journey, issues) {
    if (!Array.isArray(report.results)) {
        issues.push('report.results must be an array');
        return;
    }
    if (report.results.length === 0) issues.push('report.results must contain at least one result');
    const resultIds = new Set();
    report.results.forEach((result, index) => {
        if (!isObject(result) || !nonEmpty(result.id)) {
            issues.push(`report.results[${index}].id is required`);
            return;
        }
        rejectUnknownFields(result, RESULT_FIELDS, `report.results[${index}]`, issues);
        if (resultIds.has(result.id)) issues.push(`report result id must be unique: ${result.id}`);
        resultIds.add(result.id);
        if (!RESULT_STATUSES.has(result.status)) {
            issues.push(`report.results[${index}].status is unsupported`);
        }
        if (result.platform !== undefined && !nonEmpty(result.platform)) {
            issues.push(`report.results[${index}].platform must be a non-empty string`);
        }
        if (result.method !== undefined && !nonEmpty(result.method)) {
            issues.push(`report.results[${index}].method must be a non-empty string`);
        }
    });
    const coveredIds = [];
    const journeySteps = Array.isArray(journey.steps) ? journey.steps : [];
    for (const [stepIndex, step] of journeySteps.entries()) {
        if (step?.covers === undefined) continue;
        if (!Array.isArray(step.covers)) {
            issues.push(`journey.steps[${stepIndex}].covers must be an array of event ids`);
            continue;
        }
        coveredIds.push(...step.covers);
    }
    for (const id of coveredIds) {
        if (!nonEmpty(id)) {
            issues.push('journey step covers entries must be non-empty event ids');
        }
        else if (!resultIds.has(id)) {
            issues.push(`report.results is missing journey-covered event id: ${id}`);
        }
        else {
            const result = report.results.find(item => item?.id === id);
            if (!['PASS', 'NOT_AVAILABLE'].includes(result?.status)) {
                issues.push(`report.results status must be PASS or NOT_AVAILABLE for journey-covered event id: ${id}`);
            }
        }
    }
}

export function validateBrowserReport(report, journey, contract = null) {
    const issues = [];
    if (!isObject(report)) return { status: 'INVALID', issues: ['report must be an object'] };
    if (!isObject(journey)) return { status: 'INVALID', issues: ['journey must be an object'] };
    rejectUnknownFields(report, REPORT_FIELDS, 'report', issues);

    if (journey.version !== 3) issues.push('journey.version must equal 3 for strong browser report validation');
    if (report.version !== 3) issues.push('report.version must equal 3');
    if (!nonEmpty(report.journeyName)) issues.push('report.journeyName is required');
    else if (report.journeyName !== journey.name) issues.push('report.journeyName must equal journey.name');

    validateEnvironment(report, journey, contract, issues);
    const triggerWindow = validateTriggerWindow(report, issues);
    validateSteps(report, journey, triggerWindow, issues);
    validateResults(report, journey, issues);

    return {
        status: issues.length === 0 ? 'PASS' : 'INVALID',
        journeyName: report.journeyName || null,
        environment: report.environment || null,
        stepCount: Array.isArray(report.steps) ? report.steps.length : 0,
        resultCount: Array.isArray(report.results) ? report.results.length : 0,
        issues,
    };
}

function parseArgs(argv) {
    const options = { bundle: '', journey: '', report: '', spec: '', out: '' };
    const names = new Set(['--bundle', '--journey', '--report', '--spec', '--out']);
    for (let index = 0; index < argv.length; index += 1) {
        const name = argv[index];
        if (!names.has(name)) throw new Error(`unknown option: ${name}`);
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
        options[name.slice(2)] = value;
        index += 1;
    }
    return options;
}

function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    }
    catch (error) {
        process.stderr.write(`Error: ${error.message}\n`);
        process.exitCode = 2;
        return;
    }
    const explicitMode = options.journey || options.report || options.spec;
    if (Boolean(options.bundle) === Boolean(explicitMode) || (!options.bundle && (!options.journey || !options.report))) {
        process.stderr.write('Usage: validate-browser-report.mjs (--bundle <verification-bundle.json> | --journey <journey.json> --report <browser-report.json> [--spec <contract.json>]) [--out <validation.json>]\n');
        process.exitCode = 2;
        return;
    }
    try {
        const bundle = options.bundle
            ? JSON.parse(fs.readFileSync(path.resolve(options.bundle), 'utf8'))
            : null;
        const journey = bundle?.journey
            || JSON.parse(fs.readFileSync(path.resolve(options.journey), 'utf8'));
        const report = bundle?.browserReport
            || JSON.parse(fs.readFileSync(path.resolve(options.report), 'utf8'));
        const contract = bundle?.contract || (options.spec
            ? JSON.parse(fs.readFileSync(path.resolve(options.spec), 'utf8'))
            : null);
        const validation = validateBrowserReport(report, journey, contract);
        const output = `${JSON.stringify(validation, null, 2)}\n`;
        if (options.out) fs.writeFileSync(path.resolve(options.out), output);
        else process.stdout.write(output);
        if (validation.status !== 'PASS') process.exitCode = 1;
    }
    catch (error) {
        process.stderr.write(`Error: ${error.message}\n`);
        process.exitCode = 3;
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
