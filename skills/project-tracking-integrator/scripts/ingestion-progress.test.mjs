import assert from 'node:assert/strict';
import test from 'node:test';
import { runVerificationWorkflow } from './run-browser-ingestion-verification.mjs';

const journey = { verification: { ingestionWaitSeconds: 240, retryWaitSeconds: 240, maxQueryAttempts: 2 } };
const report = status => ({ results: [{ id: 'private-account-marker', status }] });

test('progress follows wait/query/retry order without changing query inputs or exposing event data', async () => {
    const actions = [];
    const messages = [];
    const queries = [];
    const result = await runVerificationWorkflow({
        journey, specPath: '/fixed/contract', browserReportPath: '/fixed/browser',
        onProgress: message => { messages.push(message); actions.push('progress'); },
        sleep: async ms => { actions.push(`sleep:${ms}`); },
        query: async input => { actions.push('query'); queries.push(input); return report(input.attempt === 1 ? 'NOT_FOUND' : 'PASS'); },
    });
    assert.equal(result.status, 'PASS');
    assert.equal(result.finalAttempt, 2);
    assert.deepEqual(actions, ['progress', 'sleep:240000', 'progress', 'query', 'progress', 'progress', 'sleep:240000', 'progress', 'query', 'progress', 'progress']);
    assert.ok(queries.every(input => input.specPath === '/fixed/contract' && input.browserReportPath === '/fixed/browser'));
    assert.match(messages[2], /未找到 1 项/);
    assert.match(messages[3], /条件重查等待 240 秒/);
    assert.match(messages.at(-1), /检查通过/);
    assert.ok(messages.every(message => !message.includes('private-account-marker')));
});

test('contract mismatch and query errors stop without retry, and errors are not leaked into progress', async () => {
    for (const throws of [false, true]) {
        const messages = [];
        let queries = 0;
        const result = await runVerificationWorkflow({
            journey, sleep: async () => {}, onProgress: message => messages.push(message),
            query: async () => { queries++; if (throws) throw new Error('secret-token'); return report('CONTRACT_MISMATCH'); },
        });
        assert.equal(result.status, 'FAILED');
        assert.equal(queries, 1);
        assert.equal(messages.some(message => message.includes('条件重查')), false);
        assert.equal(messages.some(message => message.includes('secret-token')), false);
        assert.match(messages.at(-1), throws ? /查询异常/ : /未通过/);
    }
});

test('broken progress consumer cannot prevent a successful query', async () => {
    let queries = 0;
    const result = await runVerificationWorkflow({
        journey, sleep: async () => {}, onProgress: () => { throw new Error('output unavailable'); },
        query: async () => { queries++; return report('PASS'); },
    });
    assert.equal(result.status, 'PASS');
    assert.equal(queries, 1);
});
