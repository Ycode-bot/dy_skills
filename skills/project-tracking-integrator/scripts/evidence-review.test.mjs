import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, formatMarkdown, parseArgs } from './generate-tracking-report.mjs';
import { normalizeContract, compareQueriedContract } from './verify-sensors-events.mjs';
import { shouldRetryReport } from './run-browser-ingestion-verification.mjs';
import { run } from './generate-tracking-report.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function fixture() {
    const triggerWindow = { startedAt: '2026-10-20T08:00:00Z', finishedAt: '2026-10-20T08:01:00Z' };
    const queryWindow = { ...triggerWindow, finishedAt: '2026-10-20T08:01:05Z' };
    const event = { id: 'success', event: 'pay', platform: 'sensors', status: 'PASS' };
    const old = { environment: { name: 'local', property: 'lmweb_url', value: 'localhost:3001' }, results: [{ ...event, status: 'NOT_FOUND', queryWindow: triggerWindow, issues: [{ message: '原窗口未找到' }] }] };
    const current = { environment: old.environment, results: [{ ...event, queryWindow, candidateCount: 1, passingCount: 1 }] };
    return {
        mode: 'full-lifecycle',
        contract: { version: 2, environments: { local: { query: { property: 'lmweb_url', value: 'localhost:3001' } } }, events: [{ id: 'success', targets: { sensors: { status: 'required', event: 'pay' } }, validation: { environments: { local: { status: 'required' } } } }] },
        development: { businessImpact: { status: 'PASS', risk: 'low', evidence: ['业务检查记录'] }, documentation: { status: 'PASS', evidence: ['文档已同步'] } },
        source: { results: [{ ...event, scope: 'integration' }] },
        browser: { environment: 'local', triggerWindow, results: [{ ...event, status: 'NOT_AVAILABLE', pageStatus: 'PASS' }] },
        ingestion: [old, current],
        review: { version: 1, resolutions: [{ id: 'success', platform: 'sensors', environment: 'local', stage: 'ingestion', reportIndex: 1, supersedes: [0], reason: '原记录结束过早，补查确认本次付款', evidence: ['checkout-proof.jpg；query-2.json'], windowReview: { triggerWindow, queryWindow, observedWindow: { ...queryWindow }, reason: '补查结束取成功截图确认时间', evidence: ['checkout-proof.jpg 拍摄时间'], association: '本次独立账号、订单及曝光关联检查通过' } }] },
    };
}

test('补查通过更新最终结论并保留原失败，无复核仍不自动覆盖', () => {
    const input = fixture();
    assert.notEqual(buildReport({ ...input, review: null }).status, 'PASS');
    const before = JSON.stringify(input);
    const report = buildReport(input);
    assert.equal(report.status, 'PASS');
    assert.equal(report.summary.passed, 1);
    assert.equal(report.results[0].reviewHistory[0].previousResults[0].status, 'NOT_FOUND');
    assert.equal(JSON.stringify(input), before);
    const md = formatMarkdown(report);
    assert.match(md, /原窗口未找到/);
    assert.doesNotMatch(md, /## 待处理/);
    assert.doesNotMatch(md, /\| SDK\/请求 \|/);
});

for (const [name, change] of [
    ['直接指定通过状态', input => { input.review.resolutions[0].status = 'PASS'; }],
    ['缺少复核依据', input => { input.review.resolutions[0].evidence = []; }],
    ['遗漏旧报告', input => { input.review.resolutions[0].supersedes = []; }],
    ['报告索引无效', input => { input.review.resolutions[0].reportIndex = 99; }],
    ['重复决议', input => { input.review.resolutions.push(structuredClone(input.review.resolutions[0])); }],
    ['错误环境', input => { input.ingestion[1].environment.value = 'other.test'; }],
    ['查询截断失败', input => { input.ingestion[1].results[0].status = 'QUERY_FAILED'; }],
    ['字段不符', input => { input.ingestion[1].results[0].status = 'CONTRACT_MISMATCH'; }],
    ['错误事件', input => { input.ingestion[1].results[0].event = 'another'; }],
    ['无关联依据', input => { input.review.resolutions[0].windowReview.association = ''; }],
    ['无限扩大窗口', input => { input.ingestion[1].results[0].queryWindow = { startedAt: '2020-01-01T00:00:00Z', finishedAt: '2030-01-01T00:00:00Z' }; }],
    ['非观测时间', input => { input.review.resolutions[0].windowReview.observedWindow.finishedAt = '2026-10-20T08:01:00Z'; }],
]) test(`复核不能绕过${name}`, () => {
    const input = fixture(); change(input);
    assert.throws(() => buildReport(input), /补查复核无效/);
});

test('没有窗口复核时，报告通过不能消除时间窗口不一致', () => {
    const input = fixture(); delete input.review.resolutions[0].windowReview;
    assert.equal(buildReport(input).results[0].ingestion, 'NEEDS_REVIEW');
});

test('人工源码补查可解决间接传输未解析，仍要求 integration 范围', () => {
    const input = fixture();
    input.source = [{ results: [{ id: 'success', platform: 'sensors', status: 'NEEDS_REVIEW' }] }, input.source];
    input.source[1].results[0].method = 'agent-review';
    input.source[1].results[0].evidence = ['wrapper.ts:10 → transport.ts:20 → SDK'];
    input.review.resolutions.push({ id: 'success', platform: 'sensors', environment: 'local', stage: 'source', reportIndex: 1, supersedes: [0], reason: '已追踪间接调用', evidence: ['wrapper.ts:10、业务入口.ts:15'] });
    assert.equal(buildReport(input).status, 'PASS');
    input.source[1].results[0].scope = 'method';
    assert.notEqual(buildReport(input).status, 'PASS');
});

test('运行时为必需阶段时继续阻塞且显示该列', () => {
    const input = fixture(); input.contract.events[0].validation.environments.local.evidence = ['runtime'];
    const report = buildReport(input);
    assert.notEqual(report.status, 'PASS');
    assert.match(formatMarkdown(report), /\| SDK\/请求 \|/);
});

test('补查不能跳过跨事件断言及其他必需阶段', () => {
    const input = fixture();
    input.contract.crossEventAssertions = [{ id: 'payment', eventIds: ['show', 'success'], groupBy: 'exposure_id', equalProperties: ['entry'] }];
    assert.throws(() => buildReport(input), /跨事件断言/);
    input.ingestion[1].correlations = [{ id: 'payment', eventIds: ['show', 'success'], status: 'PASS' }];
    input.ingestion[1].results.push({ ...input.ingestion[1].results[0], id: 'show' });
    assert.equal(buildReport(input).status, 'PASS');
    input.browser.results[0].pageStatus = 'BLOCKED';
    assert.notEqual(buildReport(input).status, 'PASS');
});

test('缺失关联事件可有限重查，字段漂移和重复歧义不能重查掩盖', () => {
    const spec = normalizeContract({ version: 2, events: ['show', 'success'].map(id => ({ id, targets: { sensors: { status: 'required', event: 'pay', match: { action: id } } } })), crossEventAssertions: [{ id: 'payment', eventIds: ['show', 'success'], groupBy: 'exposure_id', equalProperties: ['entry'] }] });
    const rows = [{ event: 'pay', action: 'show', exposure_id: 'one', entry: 'badge', lmweb_url: 'http://localhost:3001/' }];
    const compare = () => compareQueriedContract(spec, ['show', 'success'].map(() => ({ rows, truncated: false })));
    assert.equal(shouldRetryReport(compare()), true);
    rows.push({ ...rows[0], action: 'success', entry: 'wrong' });
    assert.equal(shouldRetryReport(compare()), false);
    rows[1].entry = 'badge';
    assert.equal(compare().summary.failed, 0);
    rows.push({ ...rows[1] });
    assert.equal(shouldRetryReport(compare()), false);
});

test('CLI 接受独立复核文件', () => {
    assert.equal(parseArgs(['--spec', 'contract.json', '--review', 'review.json']).review, 'review.json');
});

test('CLI 从磁盘证据生成最终通过报告，保留历史且不改写原文件', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tracking-review-test-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const input = fixture();
    const args = ['--mode', 'full-lifecycle'];
    const saved = [];
    for (const [key, value] of Object.entries(input)) {
        if (key === 'mode') continue;
        for (const [index, report] of (Array.isArray(value) ? value : [value]).entries()) {
            const file = path.join(dir, `${key}-${index}.json`);
            const body = JSON.stringify(report);
            await fs.writeFile(file, body);
            args.push(key === 'contract' ? '--spec' : `--${key}`, file);
            saved.push([file, body]);
        }
    }
    const output = path.join(dir, 'report.json');
    assert.equal(await run([...args, '--format', 'json', '--out', output]), 0);
    const report = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(report.status, 'PASS');
    assert.equal(report.summary.passed, 1);
    assert.equal(report.results[0].reviewHistory[0].previousResults[0].status, 'NOT_FOUND');
    for (const [file, body] of saved) assert.equal(await fs.readFile(file, 'utf8'), body);
});
