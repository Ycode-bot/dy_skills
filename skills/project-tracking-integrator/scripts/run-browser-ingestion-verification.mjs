#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { validateBrowserJourney } from './validate-browser-journey.mjs';
import { validateBrowserReport } from './validate-browser-report.mjs';
import { run as runSensorsVerifier } from './verify-sensors-events.mjs';

const SESSION_PREFIX = 'project-tracking-browser-ingestion-';
const SESSION_MARKER = '.project-tracking-ingestion-session.json';
const MARKER_KIND = 'project-tracking-integrator/browser-ingestion-session';
const BUNDLE_NAME = 'verification-bundle.json';
const INPUT_DIRECTORY = '.inputs';
const FINAL_REPORT_NAME = 'final-report.md';
const DEBUG_BUNDLE_NAME = 'debug-bundle.json';
const RESULT_NAME = 'verification-result.json';
const DEFAULT_WAIT_SECONDS = 240;
const MAX_WAIT_SECONDS = 1800;

const HELP_TEXT = `Browser ingestion verification runner

Prepare one editable verification bundle:
  node scripts/run-browser-ingestion-verification.mjs --prepare

Run a prepared session or a standalone bundle:
  node scripts/run-browser-ingestion-verification.mjs --session <session-directory>
  node scripts/run-browser-ingestion-verification.mjs --bundle <verification-bundle.json>

Run explicit inputs:
  node scripts/run-browser-ingestion-verification.mjs \
    --journey <journey.json> \
    --spec <contract.json> \
    --browser-report <browser-report.json>

Options:
  --keep-artifacts            Preserve all marker-owned session files after completion
  --credentials <path>        Forward a private Sensors credentials profile file
  --profile <name>            Forward a Sensors credentials profile name
  --limit <n>                 Forward the per-query row limit
  --timeout-ms <n>            Forward the query timeout
  --help                      Show this help
`;

function usage(message) {
    const error = new Error(message);
    error.isUsageError = true;
    throw error;
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseArgs(argv) {
    const options = {
        prepare: false,
        help: false,
        keepArtifacts: false,
        session: '',
        bundle: '',
        journey: '',
        spec: '',
        browserReport: '',
        credentials: '',
        profile: '',
        limit: '',
        timeoutMs: '',
    };
    const flags = new Map([
        ['--prepare', 'prepare'],
        ['--help', 'help'],
        ['--keep-artifacts', 'keepArtifacts'],
    ]);
    const values = new Map([
        ['--session', 'session'],
        ['--bundle', 'bundle'],
        ['--journey', 'journey'],
        ['--spec', 'spec'],
        ['--browser-report', 'browserReport'],
        ['--credentials', 'credentials'],
        ['--profile', 'profile'],
        ['--limit', 'limit'],
        ['--timeout-ms', 'timeoutMs'],
    ]);
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (flags.has(arg)) {
            options[flags.get(arg)] = true;
            continue;
        }
        if (!values.has(arg)) usage(`unknown option: ${arg}`);
        const value = argv[++index];
        if (!value || value.startsWith('--')) usage(`missing value for ${arg}`);
        options[values.get(arg)] = value;
    }
    return options;
}

function normalizeVerification(verification) {
    if (!isObject(verification)) usage('journey.verification is required');
    const ingestionWaitSeconds = verification.ingestionWaitSeconds ?? DEFAULT_WAIT_SECONDS;
    const retryWaitSeconds = verification.retryWaitSeconds ?? ingestionWaitSeconds;
    const maxQueryAttempts = verification.maxQueryAttempts ?? 2;
    for (const [name, value] of Object.entries({ ingestionWaitSeconds, retryWaitSeconds })) {
        if (!Number.isInteger(value) || value < 0 || value > MAX_WAIT_SECONDS) {
            usage(`journey.verification.${name} must be an integer from 0 to ${MAX_WAIT_SECONDS}`);
        }
    }
    if (!Number.isInteger(maxQueryAttempts) || maxQueryAttempts < 1 || maxQueryAttempts > 2) {
        usage('journey.verification.maxQueryAttempts must be 1 or 2');
    }
    if (maxQueryAttempts === 2 && retryWaitSeconds < 60) {
        usage('journey.verification.retryWaitSeconds must be at least 60 when maxQueryAttempts is 2');
    }
    return { ingestionWaitSeconds, retryWaitSeconds, maxQueryAttempts };
}

function resultStatuses(report) {
    return Array.isArray(report?.results) ? report.results.map(result => result?.status) : [];
}

function shouldRetryReport(report) {
    const statuses = resultStatuses(report);
    return statuses.length > 0
        && statuses.some(status => status === 'NOT_FOUND')
        && statuses.every(status => status === 'PASS' || status === 'NOT_FOUND');
}

function reportPassed(report) {
    const statuses = resultStatuses(report);
    return statuses.length > 0 && statuses.every(status => status === 'PASS');
}

function isoNow(now) {
    const value = now();
    return (value instanceof Date ? value : new Date(value)).toISOString();
}

function summarizeAttempt(attempt, queriedAt, delaySeconds, report) {
    return {
        attempt,
        queriedAt,
        delaySeconds,
        results: (report?.results || []).map(result => ({
            id: result.id,
            event: result.event,
            status: result.status,
            queriedRowCount: result.queriedRowCount,
            candidateCount: result.candidateCount,
            passingCount: result.passingCount,
            queryWindow: result.queryWindow || null,
        })),
        report,
    };
}

async function runVerificationWorkflow({
    journey,
    specPath,
    browserReportPath,
    query,
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    now = () => new Date(),
}) {
    const policy = normalizeVerification(journey?.verification);
    const attempts = [];
    let delaySeconds = policy.ingestionWaitSeconds;
    for (let attempt = 1; attempt <= policy.maxQueryAttempts; attempt += 1) {
        await sleep(delaySeconds * 1000);
        const queriedAt = isoNow(now);
        let report;
        try {
            report = await query({ attempt, queriedAt, specPath, browserReportPath });
        }
        catch (error) {
            attempts.push({
                attempt,
                queriedAt,
                delaySeconds,
                results: [],
                report: null,
                error: error.message,
            });
            return {
                schemaVersion: 1,
                status: error.isUsageError ? 'BLOCKED' : 'FAILED',
                policy,
                attempts,
                finalAttempt: attempt,
                finalReport: null,
                error: error.message,
            };
        }
        attempts.push(summarizeAttempt(attempt, queriedAt, delaySeconds, report));
        if (reportPassed(report)) break;
        if (attempt >= policy.maxQueryAttempts || !shouldRetryReport(report)) break;
        delaySeconds = policy.retryWaitSeconds;
    }
    const finalAttempt = attempts.length;
    const finalReport = attempts.at(-1)?.report || null;
    return {
        schemaVersion: 1,
        status: reportPassed(finalReport) ? 'PASS' : 'FAILED',
        policy,
        attempts,
        finalAttempt,
        finalReport,
    };
}

function defaultBundle() {
    return {
        schemaVersion: 1,
        contract: {
            version: 2,
            environments: {},
            events: [],
        },
        journey: {
            version: 3,
            name: 'browser-ingestion-verification',
            startUrl: 'http://localhost:3000/',
            environment: 'local',
            steps: [{ id: 'open-start-url', action: 'goto', url: 'http://localhost:3000/' }],
            verification: {
                contract: './contract.json',
                ingestionWaitSeconds: DEFAULT_WAIT_SECONDS,
                retryWaitSeconds: DEFAULT_WAIT_SECONDS,
                maxQueryAttempts: 2,
            },
        },
        browserReport: {
            version: 3,
            journeyName: 'browser-ingestion-verification',
            environment: 'local',
            environmentProperty: 'lmweb_url',
            environmentValue: 'localhost:3000',
            triggerWindow: {
                startedAt: '',
                finishedAt: '',
            },
            steps: [{
                id: 'open-start-url',
                action: 'goto',
                status: 'BLOCKED',
                locator: null,
                matchCount: null,
                executedAt: '',
            }],
            results: [],
        },
    };
}

async function assertSafeSessionWritePath(sessionRoot, file) {
    const requestedRoot = path.resolve(sessionRoot);
    const rootStat = await fs.lstat(requestedRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        usage('session root must be a real directory before writing artifacts');
    }
    const canonicalRoot = await fs.realpath(requestedRoot);
    const target = path.resolve(file);
    if (!isPathInside(canonicalRoot, target)) {
        usage(`refusing to write outside the marker-owned session: ${path.basename(target)}`);
    }

    const parent = path.dirname(target);
    const relativeParent = path.relative(canonicalRoot, parent);
    let current = canonicalRoot;
    for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        const stat = await fs.lstat(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
            usage(`session artifact parent must not be a symlink: ${path.relative(canonicalRoot, current)}`);
        }
    }
    const canonicalParent = await fs.realpath(parent);
    if (canonicalParent !== canonicalRoot && !isPathInside(canonicalRoot, canonicalParent)) {
        usage(`session artifact parent escapes the marker-owned session: ${path.basename(target)}`);
    }
    try {
        const targetStat = await fs.lstat(target);
        if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
            usage(`session artifact target must be a regular file: ${path.basename(target)}`);
        }
    }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    return { canonicalRoot, parent, target };
}

async function writeFileAtomic(file, content, sessionRoot) {
    const safe = await assertSafeSessionWritePath(sessionRoot, file);
    const temporaryFile = path.join(
        safe.parent,
        `.${path.basename(safe.target)}.${randomUUID()}.tmp`,
    );
    let handle = null;
    try {
        handle = await fs.open(temporaryFile, 'wx', 0o600);
        await handle.writeFile(content, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await assertSafeSessionWritePath(safe.canonicalRoot, safe.target);
        const temporaryStat = await fs.lstat(temporaryFile);
        if (!temporaryStat.isFile() || temporaryStat.isSymbolicLink()) {
            usage('temporary session artifact must remain a regular file');
        }
        await fs.rename(temporaryFile, safe.target);
    }
    finally {
        if (handle) await handle.close().catch(() => {});
        await fs.rm(temporaryFile, { force: true }).catch(() => {});
    }
}

async function writeJson(file, value, sessionRoot) {
    await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, sessionRoot);
}

async function readJson(file, label = path.basename(file)) {
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
    }
    catch (error) {
        usage(`cannot read ${label}: ${error.message}`);
    }
}

function sessionPaths(sessionDirectory) {
    const root = path.resolve(sessionDirectory);
    return {
        session: root,
        marker: path.join(root, SESSION_MARKER),
        bundle: path.join(root, BUNDLE_NAME),
        inputDirectory: path.join(root, INPUT_DIRECTORY),
        contract: path.join(root, INPUT_DIRECTORY, 'contract.json'),
        journey: path.join(root, INPUT_DIRECTORY, 'journey.json'),
        browserReport: path.join(root, INPUT_DIRECTORY, 'browser-report.json'),
        result: path.join(root, RESULT_NAME),
        finalReport: path.join(root, FINAL_REPORT_NAME),
        debugBundle: path.join(root, DEBUG_BUNDLE_NAME),
    };
}

function isPathInside(parent, child) {
    const relative = path.relative(parent, child);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function resolveOwnedSession(sessionDirectory, temporaryRoot = os.tmpdir()) {
    try {
        const requestedSession = path.resolve(sessionDirectory);
        const sessionStat = await fs.lstat(requestedSession);
        if (!sessionStat.isDirectory() || sessionStat.isSymbolicLink()) return null;

        const [canonicalTemporaryRoot, canonicalSession] = await Promise.all([
            fs.realpath(path.resolve(temporaryRoot)),
            fs.realpath(requestedSession),
        ]);
        const temporaryRootStat = await fs.stat(canonicalTemporaryRoot);
        if (!temporaryRootStat.isDirectory()
            || !isPathInside(canonicalTemporaryRoot, canonicalSession)
            || !path.basename(canonicalSession).startsWith(SESSION_PREFIX)) return null;

        const paths = sessionPaths(canonicalSession);
        const markerStat = await fs.lstat(paths.marker);
        if (!markerStat.isFile() || markerStat.isSymbolicLink()) return null;
        const marker = await readJson(paths.marker, 'session marker');
        if (marker.kind !== MARKER_KIND || typeof marker.root !== 'string') return null;

        const requestedMarkerRoot = path.resolve(marker.root);
        const markerRootStat = await fs.lstat(requestedMarkerRoot);
        if (!markerRootStat.isDirectory() || markerRootStat.isSymbolicLink()) return null;
        const canonicalMarkerRoot = await fs.realpath(requestedMarkerRoot);
        return canonicalMarkerRoot === canonicalSession ? paths : null;
    }
    catch {
        return null;
    }
}

async function isOwnedSession(sessionDirectory, temporaryRoot = os.tmpdir()) {
    return Boolean(await resolveOwnedSession(sessionDirectory, temporaryRoot));
}

async function createOwnedSession({ temporaryRoot = os.tmpdir(), bundle = defaultBundle(), now = () => new Date() } = {}) {
    const canonicalTemporaryRoot = await fs.realpath(path.resolve(temporaryRoot));
    const temporaryRootStat = await fs.stat(canonicalTemporaryRoot);
    if (!temporaryRootStat.isDirectory()) usage('temporary root must be a directory');
    const createdRoot = await fs.mkdtemp(path.join(canonicalTemporaryRoot, SESSION_PREFIX));
    const root = await fs.realpath(createdRoot);
    const paths = sessionPaths(root);
    await fs.mkdir(paths.inputDirectory, { mode: 0o700 });
    await writeJson(paths.marker, { kind: MARKER_KIND, root, createdAt: isoNow(now) }, paths.session);
    await writeJson(paths.bundle, bundle, paths.session);
    await materializeBundle(paths, bundle);
    return paths;
}

function validateBundle(bundle) {
    if (!isObject(bundle)) usage('verification bundle must be an object');
    if (!isObject(bundle.contract)) usage('verification bundle contract is required');
    if (!isObject(bundle.journey)) usage('verification bundle journey is required');
    if (!isObject(bundle.browserReport)) usage('verification bundle browserReport is required');
    return bundle;
}

function validateExecutionInputs(bundle) {
    const journey = validateBrowserJourney(bundle.journey, bundle.contract);
    const targetSupport = validateRunnerTargetSupport(bundle.contract, bundle.journey);
    const browserReport = journey.status === 'PASS'
        ? validateBrowserReport(bundle.browserReport, bundle.journey, bundle.contract)
        : { status: 'SKIPPED', issues: ['browser report validation skipped because the journey is invalid'] };
    return {
        status: journey.status === 'PASS'
            && targetSupport.status === 'PASS'
            && browserReport.status === 'PASS'
            ? 'PASS'
            : 'INVALID',
        journey,
        targetSupport,
        browserReport,
    };
}

function validateRunnerTargetSupport(contract, journey) {
    const issues = [];
    if (!isObject(contract) || !Array.isArray(contract.events)) {
        return { status: 'INVALID', issues: ['contract.events must be an array'] };
    }
    const environment = journey?.environment;
    const coveredIds = new Set(
        (Array.isArray(journey?.steps) ? journey.steps : [])
            .flatMap(step => Array.isArray(step?.covers) ? step.covers : []),
    );
    contract.events.forEach((event, index) => {
        const requirement = event?.validation?.environments?.[environment];
        const id = event?.id || `events[${index}]`;
        if (coveredIds.has(event?.id)) {
            const sensorsStatus = event?.targets ? event.targets.sensors?.status : 'required';
            if (sensorsStatus !== 'required' || ['optional', 'disabled'].includes(requirement?.status)) {
                issues.push(`Sensors browser ingestion runner requires every covered event to be a required Sensors target: ${id}`);
            }
        }
        if (['optional', 'disabled'].includes(requirement?.status)) return;
        for (const [platform, target] of Object.entries(event?.targets || {})) {
            if (platform !== 'sensors' && target?.status === 'required') {
                issues.push(`Sensors browser ingestion runner cannot verify required ${platform} target: ${id}`);
            }
        }
    });
    return { status: issues.length === 0 ? 'PASS' : 'INVALID', issues };
}

async function materializeBundle(paths, rawBundle) {
    const bundle = validateBundle(rawBundle);
    await writeJson(paths.contract, bundle.contract, paths.session);
    await writeJson(paths.journey, bundle.journey, paths.session);
    await writeJson(paths.browserReport, bundle.browserReport, paths.session);
    return paths;
}

async function prepareSession(options = {}) {
    const paths = await createOwnedSession(options);
    return {
        session: paths.session,
        bundle: paths.bundle,
        contract: paths.contract,
        journey: paths.journey,
        browserReport: paths.browserReport,
    };
}

async function bundleFromExplicitFiles({ journey, spec, browserReport }) {
    if (!journey || !spec || !browserReport) {
        usage('explicit mode requires --journey, --spec, and --browser-report together');
    }
    return validateBundle({
        schemaVersion: 1,
        contract: await readJson(path.resolve(spec), 'contract'),
        journey: await readJson(path.resolve(journey), 'journey'),
        browserReport: await readJson(path.resolve(browserReport), 'browser report'),
    });
}

async function resolveSessionInputs(options) {
    if (options.session) {
        const paths = await resolveOwnedSession(options.session);
        if (!paths) usage('--session is not a marker-owned temporary session');
        let bundle;
        if (options.bundle) bundle = await readJson(path.resolve(options.bundle), 'verification bundle');
        else if (options.journey || options.spec || options.browserReport) bundle = await bundleFromExplicitFiles(options);
        else bundle = await readJson(paths.bundle, 'verification bundle');
        await writeJson(paths.bundle, validateBundle(bundle), paths.session);
        await materializeBundle(paths, bundle);
        return { paths, bundle };
    }
    let bundle;
    if (options.bundle) bundle = validateBundle(await readJson(path.resolve(options.bundle), 'verification bundle'));
    else bundle = await bundleFromExplicitFiles(options);
    const paths = await createOwnedSession({ bundle });
    return { paths, bundle };
}

function verifierArguments({ specPath, browserReportPath, outputPath, queryOptions = {} }) {
    const args = [
        '--spec', specPath,
        '--query',
        '--browser-report', browserReportPath,
        '--format', 'json',
        '--out', outputPath,
    ];
    for (const [option, value] of [
        ['--credentials', queryOptions.credentials],
        ['--profile', queryOptions.profile],
        ['--limit', queryOptions.limit],
        ['--timeout-ms', queryOptions.timeoutMs],
    ]) {
        if (value !== undefined && value !== null && value !== '') args.push(option, String(value));
    }
    return args;
}

function createSingleQuery({ paths, queryOptions = {}, verifierRun = runSensorsVerifier, env = process.env }) {
    return async ({ attempt, specPath, browserReportPath }) => {
        const temporaryOutputPath = path.join(
            paths.session,
            `.attempt-${attempt}-${randomUUID()}.json`,
        );
        const safeOutput = await assertSafeSessionWritePath(paths.session, temporaryOutputPath);
        const reservation = await fs.open(safeOutput.target, 'wx', 0o600);
        await reservation.close();
        try {
            await verifierRun(verifierArguments({
                specPath,
                browserReportPath,
                outputPath: safeOutput.target,
                queryOptions,
            }), env);
            await assertSafeSessionWritePath(paths.session, safeOutput.target);
            const report = await readJson(safeOutput.target, `attempt ${attempt} report`);
            await writeJson(path.join(paths.session, `attempt-${attempt}.json`), report, paths.session);
            return report;
        }
        finally {
            await fs.rm(safeOutput.target, { force: true }).catch(() => {});
        }
    };
}

function formatFinalReportMarkdown(workflow) {
    const lines = [
        '# Browser ingestion verification',
        '',
        `- Status: ${workflow.status}`,
        `- Final attempt: ${workflow.finalAttempt}`,
        `- Initial wait: ${workflow.policy?.ingestionWaitSeconds ?? '-'} seconds`,
        `- Retry wait: ${workflow.policy?.retryWaitSeconds ?? '-'} seconds`,
    ];
    if (workflow.error) lines.push(`- Error: ${workflow.error}`);
    lines.push(
        '',
        '| Attempt | Queried at | Delay | Results |',
        '|---|---|---:|---|',
    );
    for (const attempt of workflow.attempts || []) {
        const statuses = attempt.results.map(result => `${result.id || result.event || 'event'}=${result.status}`).join(', ');
        lines.push(`| ${attempt.attempt} | ${attempt.queriedAt} | ${attempt.delaySeconds}s | ${statuses || '-'} |`);
    }
    lines.push('');
    return `${lines.join('\n')}\n`;
}

async function collapseFailedSession(paths, debugBundle) {
    let ownedPaths = await resolveOwnedSession(paths.session);
    if (!ownedPaths) return false;
    await writeFileAtomic(
        ownedPaths.finalReport,
        formatFinalReportMarkdown(debugBundle.workflow),
        ownedPaths.session,
    );
    await writeJson(ownedPaths.debugBundle, debugBundle, ownedPaths.session);

    ownedPaths = await resolveOwnedSession(ownedPaths.session);
    if (!ownedPaths) return false;
    const keep = new Set([FINAL_REPORT_NAME, DEBUG_BUNDLE_NAME]);
    const removableEntries = (await fs.readdir(ownedPaths.session))
        .filter(entry => !keep.has(entry))
        .sort((left, right) => Number(left === SESSION_MARKER) - Number(right === SESSION_MARKER));
    for (const entry of removableEntries) {
        const currentPaths = await resolveOwnedSession(ownedPaths.session);
        if (!currentPaths) return false;
        await fs.rm(path.join(currentPaths.session, entry), { recursive: true, force: true });
    }
    return true;
}

async function finalizeSession({ paths, bundle, workflow, keepArtifacts = false }) {
    let ownedPaths = await resolveOwnedSession(paths.session);
    if (!ownedPaths) return { cleaned: false, collapsed: false, session: paths.session };
    await writeJson(ownedPaths.result, workflow, ownedPaths.session);
    await writeFileAtomic(ownedPaths.finalReport, formatFinalReportMarkdown(workflow), ownedPaths.session);
    if (keepArtifacts) {
        await writeJson(ownedPaths.debugBundle, { workflow, ...bundle }, ownedPaths.session);
        return { cleaned: false, collapsed: false, session: ownedPaths.session };
    }
    if (workflow.status === 'PASS') {
        ownedPaths = await resolveOwnedSession(ownedPaths.session);
        if (!ownedPaths) return { cleaned: false, collapsed: false, session: paths.session };
        await fs.rm(ownedPaths.session, { recursive: true, force: true });
        return { cleaned: true, collapsed: false, session: ownedPaths.session };
    }
    const debugBundle = workflow.inputValidation?.status === 'PASS'
        ? { workflow, ...bundle }
        : { workflow };
    const collapsed = await collapseFailedSession(ownedPaths, debugBundle);
    return { cleaned: false, collapsed, session: ownedPaths.session };
}

async function executeSession(options, dependencies = {}) {
    let paths = options.session ? await resolveOwnedSession(options.session) : null;
    let bundle = null;
    let workflow;
    let inputValidation = null;
    try {
        const resolved = await resolveSessionInputs(options);
        paths = resolved.paths;
        bundle = resolved.bundle;
        const query = dependencies.query || createSingleQuery({
            paths,
            queryOptions: options,
            verifierRun: dependencies.verifierRun,
            env: dependencies.env,
        });
        inputValidation = validateExecutionInputs(bundle);
        if (inputValidation.status !== 'PASS') {
            const issues = [
                ...(inputValidation.journey?.issues || []),
                ...(inputValidation.targetSupport?.issues || []),
                ...(inputValidation.browserReport?.issues || []),
            ];
            throw new Error(`browser verification input is invalid: ${issues.join('; ')}`);
        }
        workflow = await runVerificationWorkflow({
            journey: bundle.journey,
            specPath: paths.contract,
            browserReportPath: paths.browserReport,
            query,
            sleep: dependencies.sleep,
            now: dependencies.now,
        });
        workflow.inputValidation = inputValidation;
    }
    catch (error) {
        if (!paths) throw error;
        let policy = null;
        try {
            policy = normalizeVerification(bundle?.journey?.verification);
        }
        catch {
            policy = null;
        }
        workflow = {
            schemaVersion: 1,
            status: inputValidation?.status === 'INVALID' || error.isUsageError ? 'BLOCKED' : 'FAILED',
            policy,
            attempts: [],
            finalAttempt: 0,
            finalReport: null,
            inputValidation,
            error: error.message,
        };
    }
    const artifacts = await finalizeSession({
        paths,
        bundle: bundle || {},
        workflow,
        keepArtifacts: options.keepArtifacts,
    });
    return { ...workflow, artifacts };
}

async function runCli(argv = process.argv.slice(2), dependencies = {}) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    if (options.prepare) {
        const prepared = await prepareSession({ temporaryRoot: dependencies.temporaryRoot, now: dependencies.now });
        process.stdout.write(`${JSON.stringify({ session: prepared.session, bundle: prepared.bundle }, null, 2)}\n`);
        return 0;
    }
    if (!options.session && !options.bundle && !options.journey && !options.spec && !options.browserReport) {
        usage('provide --session, --bundle, or explicit --journey/--spec/--browser-report');
    }
    const result = await executeSession(options, dependencies);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'PASS' ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    runCli().then(code => {
        process.exitCode = code;
    }).catch(error => {
        process.stderr.write(`Error: ${error.message}\n`);
        process.exitCode = error.isUsageError ? 2 : 3;
    });
}

export {
    BUNDLE_NAME,
    DEBUG_BUNDLE_NAME,
    FINAL_REPORT_NAME,
    SESSION_MARKER,
    collapseFailedSession,
    createOwnedSession,
    createSingleQuery,
    defaultBundle,
    executeSession,
    finalizeSession,
    formatFinalReportMarkdown,
    isOwnedSession,
    materializeBundle,
    normalizeVerification,
    parseArgs,
    prepareSession,
    reportPassed,
    resolveOwnedSession,
    resolveSessionInputs,
    runCli,
    runVerificationWorkflow,
    sessionPaths,
    shouldRetryReport,
    validateExecutionInputs,
    validateRunnerTargetSupport,
    verifierArguments,
    writeFileAtomic,
};
