import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    DEBUG_BUNDLE_NAME,
    FINAL_REPORT_NAME,
    createOwnedSession,
    createSingleQuery,
    defaultBundle,
    executeSession,
    finalizeSession,
    isOwnedSession,
    materializeBundle,
    prepareSession,
    runVerificationWorkflow,
    sessionPaths,
} from './run-browser-ingestion-verification.mjs';

function report(...statuses) {
    return {
        summary: {
            total: statuses.length,
            passed: statuses.filter(status => status === 'PASS').length,
            failed: statuses.filter(status => status !== 'PASS').length,
        },
        results: statuses.map((status, index) => ({
            id: `event-${index + 1}`,
            event: `Event${index + 1}`,
            status,
            queryWindow: {
                mode: 'fixed-browser-trigger',
                startedAt: '2026-07-23T04:45:17.656Z',
                finishedAt: '2026-07-23T04:45:36.349Z',
            },
        })),
    };
}

function journey(overrides = {}) {
    return {
        verification: {
            ingestionWaitSeconds: 240,
            retryWaitSeconds: 240,
            maxQueryAttempts: 2,
            ...overrides,
        },
    };
}

function executableBundle() {
    const bundle = defaultBundle();
    bundle.contract = {
        version: 2,
        environments: {
            local: {
                startUrl: 'http://localhost:3000/',
                query: { property: 'lmweb_url', operator: 'contains', valueFrom: 'browser-host' },
            },
        },
        events: [{
            id: 'event-1',
            trigger: 'Example section enters the viewport',
            targets: {
                sensors: {
                    status: 'required',
                    event: 'Event1',
                    properties: {},
                },
            },
        }],
    };
    bundle.journey.steps.push({
        id: 'expose-example-section',
        action: 'scroll-into-view',
        locator: { type: 'testId', value: 'example-section' },
        covers: ['event-1'],
    });
    bundle.browserReport.triggerWindow = {
        startedAt: '2026-07-23T04:45:17.656Z',
        finishedAt: '2026-07-23T04:45:36.349Z',
    };
    bundle.browserReport.steps = [
        {
            id: 'open-start-url',
            action: 'goto',
            status: 'PASS',
            locator: null,
            matchCount: null,
            executedAt: '2026-07-23T04:45:16.000Z',
        },
        {
            id: 'expose-example-section',
            action: 'scroll-into-view',
            status: 'PASS',
            locator: { type: 'testId', value: 'example-section' },
            matchCount: 1,
            resolvedAt: '2026-07-23T04:45:20.000Z',
            executedAt: '2026-07-23T04:45:21.000Z',
            resolvedElement: { role: 'region', name: 'Example section' },
        },
    ];
    bundle.browserReport.results = [{
        id: 'event-1',
        platform: 'sensors',
        status: 'PASS',
        method: 'in-app-browser',
    }];
    return bundle;
}

function fakeClock(start = '2026-07-23T04:45:36.349Z') {
    let milliseconds = new Date(start).getTime();
    const sleeps = [];
    return {
        sleeps,
        now: () => new Date(milliseconds),
        sleep: async duration => {
            sleeps.push(duration);
            milliseconds += duration;
        },
    };
}

async function temporaryDirectory(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-ingestion-runner-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return directory;
}

test('waits until t+240, retries once at t+480, and reuses the fixed browser report', async () => {
    const clock = fakeClock();
    const calls = [];
    const reports = [report('NOT_FOUND'), report('PASS')];
    const result = await runVerificationWorkflow({
        journey: journey(),
        specPath: '/tmp/session/.inputs/contract.json',
        browserReportPath: '/tmp/session/.inputs/browser-report.json',
        sleep: clock.sleep,
        now: clock.now,
        query: async call => {
            calls.push(call);
            return reports.shift();
        },
    });

    assert.equal(result.status, 'PASS');
    assert.equal(result.finalAttempt, 2);
    assert.deepEqual(clock.sleeps, [240_000, 240_000]);
    assert.deepEqual(result.attempts.map(item => item.queriedAt), [
        '2026-07-23T04:49:36.349Z',
        '2026-07-23T04:53:36.349Z',
    ]);
    assert.equal(calls[0].browserReportPath, calls[1].browserReportPath);
    assert.equal(calls[0].specPath, calls[1].specPath);
    assert.equal(result.finalReport.results[0].status, 'PASS');
});

test('a first-attempt PASS stops without a retry', async () => {
    const clock = fakeClock();
    let queries = 0;
    const result = await runVerificationWorkflow({
        journey: journey(),
        specPath: '/tmp/spec.json',
        browserReportPath: '/tmp/browser.json',
        sleep: clock.sleep,
        now: clock.now,
        query: async () => {
            queries += 1;
            return report('PASS');
        },
    });
    assert.equal(result.status, 'PASS');
    assert.equal(queries, 1);
    assert.deepEqual(clock.sleeps, [240_000]);
});

test('any non PASS/NOT_FOUND result stops immediately', async t => {
    for (const status of ['CONTRACT_MISMATCH', 'DUPLICATED', 'COUNT_MISMATCH', 'QUERY_FAILED']) {
        await t.test(status, async () => {
            const clock = fakeClock();
            let queries = 0;
            const result = await runVerificationWorkflow({
                journey: journey(),
                specPath: '/tmp/spec.json',
                browserReportPath: '/tmp/browser.json',
                sleep: clock.sleep,
                now: clock.now,
                query: async () => {
                    queries += 1;
                    return report('NOT_FOUND', status);
                },
            });
            assert.equal(result.status, 'FAILED');
            assert.equal(queries, 1);
            assert.deepEqual(clock.sleeps, [240_000]);
        });
    }
});

test('two NOT_FOUND results never cause a third query', async () => {
    const clock = fakeClock();
    let queries = 0;
    const result = await runVerificationWorkflow({
        journey: journey({ maxQueryAttempts: 2 }),
        specPath: '/tmp/spec.json',
        browserReportPath: '/tmp/browser.json',
        sleep: clock.sleep,
        now: clock.now,
        query: async () => {
            queries += 1;
            return report('NOT_FOUND');
        },
    });
    assert.equal(result.status, 'FAILED');
    assert.equal(result.finalAttempt, 2);
    assert.equal(queries, 2);
    assert.deepEqual(clock.sleeps, [240_000, 240_000]);
});

test('a retry exception preserves the completed fixed-window attempt evidence', async () => {
    const clock = fakeClock();
    let queries = 0;
    const result = await runVerificationWorkflow({
        journey: journey(),
        specPath: '/tmp/spec.json',
        browserReportPath: '/tmp/browser.json',
        sleep: clock.sleep,
        now: clock.now,
        query: async () => {
            queries += 1;
            if (queries === 1) return report('NOT_FOUND');
            throw new Error('network failed during retry');
        },
    });

    assert.equal(result.status, 'FAILED');
    assert.equal(result.finalAttempt, 2);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0].results[0].status, 'NOT_FOUND');
    assert.match(result.attempts[1].error, /network failed during retry/);
});

test('--prepare creates one visible bundle and hidden materialized input paths', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const prepared = await prepareSession({ temporaryRoot });
    assert.equal(await isOwnedSession(prepared.session, temporaryRoot), true);
    assert.deepEqual((await fs.readdir(prepared.session)).sort(), [
        '.inputs',
        '.project-tracking-ingestion-session.json',
        'verification-bundle.json',
    ]);
    for (const file of [prepared.bundle, prepared.contract, prepared.journey, prepared.browserReport]) {
        await fs.access(file);
    }
    const preparedJourney = JSON.parse(await fs.readFile(prepared.journey, 'utf8'));
    assert.equal(preparedJourney.version, 3);
    assert.equal(preparedJourney.steps[0].id, 'open-start-url');
    assert.equal(preparedJourney.verification.ingestionWaitSeconds, 240);
});

test('session ownership uses canonical paths and remains contained by the canonical temporary root', async t => {
    const container = await temporaryDirectory(t);
    const canonicalRoot = path.join(container, 'canonical-root');
    const otherRoot = path.join(container, 'other-root');
    const rootAlias = path.join(container, 'root-alias');
    await fs.mkdir(canonicalRoot);
    await fs.mkdir(otherRoot);
    await fs.symlink(canonicalRoot, rootAlias, 'dir');

    const paths = await createOwnedSession({ temporaryRoot: rootAlias });
    assert.equal(path.dirname(paths.session), await fs.realpath(canonicalRoot));
    assert.equal(await isOwnedSession(paths.session, rootAlias), true);
    assert.equal(await isOwnedSession(paths.session, otherRoot), false);

    const marker = JSON.parse(await fs.readFile(paths.marker, 'utf8'));
    assert.equal(marker.root, paths.session);
});

test('a session-directory symlink is rejected even when its target has a valid marker', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const target = await createOwnedSession({ temporaryRoot });
    const alias = path.join(temporaryRoot, 'project-tracking-browser-ingestion-symlink');
    await fs.symlink(target.session, alias, 'dir');

    assert.equal(await isOwnedSession(alias, temporaryRoot), false);
    const workflow = {
        status: 'PASS',
        policy: { ingestionWaitSeconds: 240, retryWaitSeconds: 240 },
        attempts: [],
        finalAttempt: 1,
        finalReport: report('PASS'),
    };
    const artifacts = await finalizeSession({
        paths: sessionPaths(alias),
        bundle: defaultBundle(),
        workflow,
    });

    assert.equal(artifacts.cleaned, false);
    assert.equal((await fs.lstat(alias)).isSymbolicLink(), true);
    await fs.access(target.marker);
    await fs.access(target.bundle);
});

test('materializing a bundle never follows a child artifact symlink outside the session', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const paths = await createOwnedSession({ temporaryRoot });
    const victim = path.join(temporaryRoot, 'victim-contract.json');
    await fs.writeFile(victim, 'keep-me', 'utf8');
    await fs.rm(paths.contract);
    await fs.symlink(victim, paths.contract);

    await assert.rejects(
        materializeBundle(paths, defaultBundle()),
        /artifact target must be a regular file/,
    );
    assert.equal(await fs.readFile(victim, 'utf8'), 'keep-me');
});

test('materializing a bundle rejects symlinked input directories', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const paths = await createOwnedSession({ temporaryRoot });
    const externalDirectory = path.join(temporaryRoot, 'external-inputs');
    const victim = path.join(externalDirectory, 'contract.json');
    await fs.mkdir(externalDirectory);
    await fs.writeFile(victim, 'keep-me', 'utf8');
    await fs.rm(paths.inputDirectory, { recursive: true });
    await fs.symlink(externalDirectory, paths.inputDirectory, 'dir');

    await assert.rejects(
        materializeBundle(paths, defaultBundle()),
        /artifact parent must not be a symlink/,
    );
    assert.equal(await fs.readFile(victim, 'utf8'), 'keep-me');
});

test('query attempt output never follows a predictable artifact symlink', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const paths = await createOwnedSession({ temporaryRoot });
    const victim = path.join(temporaryRoot, 'victim-attempt.json');
    await fs.writeFile(victim, 'keep-me', 'utf8');
    await fs.symlink(victim, path.join(paths.session, 'attempt-1.json'));
    const query = createSingleQuery({
        paths,
        verifierRun: async args => {
            const outputPath = args[args.indexOf('--out') + 1];
            await fs.writeFile(outputPath, `${JSON.stringify(report('PASS'))}\n`, 'utf8');
        },
    });

    await assert.rejects(
        query({ attempt: 1, specPath: paths.contract, browserReportPath: paths.browserReport }),
        /artifact target must be a regular file/,
    );
    assert.equal(await fs.readFile(victim, 'utf8'), 'keep-me');
});

test('finalization never follows a result artifact symlink outside the session', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const paths = await createOwnedSession({ temporaryRoot });
    const victim = path.join(temporaryRoot, 'victim-result.json');
    await fs.writeFile(victim, 'keep-me', 'utf8');
    await fs.symlink(victim, paths.result);
    const workflow = {
        status: 'FAILED',
        policy: { ingestionWaitSeconds: 240, retryWaitSeconds: 240 },
        attempts: [],
        finalAttempt: 0,
        finalReport: null,
    };

    await assert.rejects(
        finalizeSession({ paths, bundle: defaultBundle(), workflow }),
        /artifact target must be a regular file/,
    );
    assert.equal(await fs.readFile(victim, 'utf8'), 'keep-me');
});

test('default PASS cleanup removes only its marker-owned session', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const paths = await createOwnedSession({ temporaryRoot });
    const sibling = path.join(temporaryRoot, 'unowned-sibling');
    await fs.mkdir(sibling);
    await fs.writeFile(path.join(sibling, 'keep.txt'), 'keep', 'utf8');
    const workflow = {
        status: 'PASS',
        policy: { ingestionWaitSeconds: 240, retryWaitSeconds: 240 },
        attempts: [],
        finalAttempt: 1,
        finalReport: report('PASS'),
    };
    const artifacts = await finalizeSession({ paths, bundle: defaultBundle(), workflow });
    assert.equal(artifacts.cleaned, true);
    await assert.rejects(fs.access(paths.session));
    assert.equal(await fs.readFile(path.join(sibling, 'keep.txt'), 'utf8'), 'keep');
});

test('failure collapses a marker-owned session to final-report.md and debug-bundle.json', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const paths = await createOwnedSession({ temporaryRoot });
    await fs.writeFile(path.join(paths.session, 'attempt-1.json'), '{}', 'utf8');
    const workflow = {
        status: 'FAILED',
        policy: { ingestionWaitSeconds: 240, retryWaitSeconds: 240 },
        attempts: [],
        finalAttempt: 1,
        finalReport: report('NOT_FOUND'),
    };
    const artifacts = await finalizeSession({ paths, bundle: defaultBundle(), workflow });
    assert.equal(artifacts.collapsed, true);
    assert.deepEqual((await fs.readdir(paths.session)).sort(), [DEBUG_BUNDLE_NAME, FINAL_REPORT_NAME].sort());
});

test('--keep-artifacts preserves all marker-owned session files', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const paths = await createOwnedSession({ temporaryRoot });
    await fs.writeFile(path.join(paths.session, 'attempt-1.json'), '{}', 'utf8');
    const workflow = {
        status: 'PASS',
        policy: { ingestionWaitSeconds: 240, retryWaitSeconds: 240 },
        attempts: [],
        finalAttempt: 1,
        finalReport: report('PASS'),
    };
    const artifacts = await finalizeSession({ paths, bundle: defaultBundle(), workflow, keepArtifacts: true });
    assert.equal(artifacts.cleaned, false);
    const entries = await fs.readdir(paths.session);
    assert.ok(entries.includes('attempt-1.json'));
    assert.ok(entries.includes('verification-result.json'));
    assert.ok(entries.includes(FINAL_REPORT_NAME));
    assert.ok(entries.includes(DEBUG_BUNDLE_NAME));
});

test('a non-marker directory is never deleted or collapsed', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const directory = path.join(temporaryRoot, 'ordinary-directory');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'keep.txt'), 'keep', 'utf8');
    const workflow = {
        status: 'PASS',
        policy: {},
        attempts: [],
        finalAttempt: 1,
        finalReport: report('PASS'),
    };
    const artifacts = await finalizeSession({
        paths: sessionPaths(directory),
        bundle: defaultBundle(),
        workflow,
    });
    assert.equal(artifacts.cleaned, false);
    assert.equal(await fs.readFile(path.join(directory, 'keep.txt'), 'utf8'), 'keep');
});

test('finalization rechecks ownership immediately before PASS deletion', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const paths = await createOwnedSession({ temporaryRoot });
    const workflow = {
        status: 'PASS',
        policy: { ingestionWaitSeconds: 240, retryWaitSeconds: 240 },
        attempts: [],
        finalAttempt: 1,
        finalReport: report('PASS'),
    };
    Object.defineProperty(workflow, 'toJSON', {
        value() {
            unlinkSync(paths.marker);
            return {
                status: this.status,
                policy: this.policy,
                attempts: this.attempts,
                finalAttempt: this.finalAttempt,
                finalReport: this.finalReport,
            };
        },
    });

    const artifacts = await finalizeSession({ paths, bundle: defaultBundle(), workflow });
    assert.equal(artifacts.cleaned, false);
    await fs.access(paths.session);
    await fs.access(paths.bundle);
});

test('failure collapse rechecks ownership before removing session entries', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const paths = await createOwnedSession({ temporaryRoot });
    const workflow = {
        status: 'FAILED',
        policy: { ingestionWaitSeconds: 240, retryWaitSeconds: 240 },
        attempts: [],
        finalAttempt: 1,
        finalReport: report('NOT_FOUND'),
    };
    Object.defineProperty(workflow, 'toJSON', {
        value() {
            unlinkSync(paths.marker);
            return {
                status: this.status,
                policy: this.policy,
                attempts: this.attempts,
                finalAttempt: this.finalAttempt,
                finalReport: this.finalReport,
            };
        },
    });

    const artifacts = await finalizeSession({ paths, bundle: defaultBundle(), workflow });
    assert.equal(artifacts.collapsed, false);
    await fs.access(paths.session);
    await fs.access(paths.bundle);
});

test('executeSession consumes the editable bundle and cleans up after PASS', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const paths = await createOwnedSession({ temporaryRoot });
    const bundle = executableBundle();
    await fs.writeFile(paths.bundle, `${JSON.stringify(bundle)}\n`, 'utf8');
    const browserPaths = [];
    const result = await executeSession({ session: paths.session, keepArtifacts: false }, {
        sleep: async () => {},
        query: async call => {
            browserPaths.push(call.browserReportPath);
            return report('PASS');
        },
    });
    assert.equal(result.status, 'PASS');
    assert.equal(browserPaths[0], paths.browserReport);
    await assert.rejects(fs.access(paths.session));
});

test('executeSession blocks an invalid browser report before waiting or querying', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const bundle = executableBundle();
    bundle.browserReport.steps[1].matchCount = 2;
    const paths = await createOwnedSession({ temporaryRoot, bundle });
    let slept = false;
    let queried = false;

    const result = await executeSession({ session: paths.session, keepArtifacts: false }, {
        sleep: async () => { slept = true; },
        query: async () => {
            queried = true;
            return report('PASS');
        },
    });

    assert.equal(result.status, 'BLOCKED');
    assert.equal(slept, false);
    assert.equal(queried, false);
    assert.deepEqual((await fs.readdir(paths.session)).sort(), [DEBUG_BUNDLE_NAME, FINAL_REPORT_NAME].sort());
});

test('default failure artifacts do not retain rejected browser-report fields', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const bundle = executableBundle();
    bundle.browserReport.rawCookie = 'secret-cookie';
    const paths = await createOwnedSession({ temporaryRoot, bundle });

    const result = await executeSession({ session: paths.session, keepArtifacts: false }, {
        sleep: async () => {},
        query: async () => report('PASS'),
    });
    const debugBundle = JSON.parse(await fs.readFile(paths.debugBundle, 'utf8'));

    assert.equal(result.status, 'BLOCKED');
    assert.equal(debugBundle.browserReport, undefined);
    assert.doesNotMatch(JSON.stringify(debugBundle), /secret-cookie/);
});

test('executeSession blocks required non-Sensors targets instead of claiming an overall PASS', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const bundle = executableBundle();
    bundle.contract.events.push({
        id: 'ga-only-event',
        trigger: 'Example GA-only action',
        targets: {
            sensors: { status: 'disabled' },
            ga4: { status: 'required', event: 'ga_only_event' },
        },
    });
    const paths = await createOwnedSession({ temporaryRoot, bundle });
    let queried = false;

    const result = await executeSession({ session: paths.session, keepArtifacts: false }, {
        sleep: async () => {},
        query: async () => {
            queried = true;
            return report('PASS');
        },
    });

    assert.equal(result.status, 'BLOCKED');
    assert.equal(queried, false);
    assert.match(result.error, /cannot verify required ga4 target: ga-only-event/);
});

test('executeSession blocks covered events that the Sensors verifier would skip', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const bundle = executableBundle();
    bundle.contract.events.push({
        id: 'optional-covered-event',
        trigger: 'Optional example exposure',
        targets: { sensors: { status: 'required', event: 'OptionalEvent' } },
        validation: {
            environments: {
                local: { status: 'optional', evidence: ['browser', 'ingestion'] },
            },
        },
    });
    bundle.journey.steps[1].covers.push('optional-covered-event');
    bundle.browserReport.results.push({
        id: 'optional-covered-event',
        platform: 'sensors',
        status: 'PASS',
        method: 'in-app-browser',
    });
    const paths = await createOwnedSession({ temporaryRoot, bundle });

    const result = await executeSession({ session: paths.session, keepArtifacts: false }, {
        sleep: async () => {},
        query: async () => report('PASS'),
    });

    assert.equal(result.status, 'BLOCKED');
    assert.match(result.error, /requires every covered event to be a required Sensors target: optional-covered-event/);
});

test('executeSession collapses a malformed prepared bundle into a BLOCKED result', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const paths = await createOwnedSession({ temporaryRoot });
    await fs.writeFile(paths.bundle, '{invalid json', 'utf8');

    const result = await executeSession({ session: paths.session, keepArtifacts: false });

    assert.equal(result.status, 'BLOCKED');
    assert.match(result.error, /cannot read verification bundle/);
    assert.deepEqual((await fs.readdir(paths.session)).sort(), [DEBUG_BUNDLE_NAME, FINAL_REPORT_NAME].sort());
});

test('executeSession reports missing query configuration as BLOCKED', async t => {
    const temporaryRoot = await temporaryDirectory(t);
    const paths = await createOwnedSession({ temporaryRoot, bundle: executableBundle() });
    const usageError = new Error('Sensors credentials are not configured');
    usageError.isUsageError = true;

    const result = await executeSession({ session: paths.session, keepArtifacts: false }, {
        sleep: async () => {},
        query: async () => { throw usageError; },
    });

    assert.equal(result.status, 'BLOCKED');
    assert.match(result.error, /credentials are not configured/);
    assert.deepEqual((await fs.readdir(paths.session)).sort(), [DEBUG_BUNDLE_NAME, FINAL_REPORT_NAME].sort());
});
