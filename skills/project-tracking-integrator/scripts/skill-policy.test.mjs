import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { nextWorkflowAction } from './workflow-policy.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('all relative skill references exist', () => {
    const text = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
    for (const [, target] of text.matchAll(/\]\((references\/[^)]+)\)/g)) assert.ok(fs.existsSync(path.join(root, target)), target);
});
test('流程规则由对应文档维护，恢复方式边界保持唯一', () => {
    const read = name => fs.readFileSync(path.join(root, name), 'utf8');
    const skill = read('SKILL.md');
    const browser = read('references/browser-verification.md');
    const sensors = read('references/sensors-verification.md');
    const evidence = read('references/evidence-management.md');
    const development = read('references/development-verification.md');
    assert.match(skill, /browser-verification\.md/);
    assert.match(skill, /evidence-management\.md/);
    assert.match(skill, /evidence-review\.md/);
    assert.match(browser, /等待 240 秒/);
    assert.doesNotMatch(sensors, /runner 默认等待 240 秒/);
    assert.match(evidence, /恢复方式矩阵/);
    for (const mode of ['--resume', '--review', '新建会话']) assert.match(evidence, new RegExp(mode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(development, /evidence-review\.md/);
});
test('full development proceeds to browser while narrow development stops', () => {
    assert.equal(nextWorkflowAction({ phase: 'source-complete' }).action, 'browser');
    for (const mode of ['instrument', 'generate-method']) assert.equal(nextWorkflowAction({ mode, phase: 'source-complete' }).action, 'deliver');
});
test('login acknowledgement requires verification, expired login stops again', () => {
    const state = { phase: 'browser', loginRequired: true };
    assert.equal(nextWorkflowAction(state).action, 'wait-login');
    assert.equal(nextWorkflowAction({ ...state, loginAcknowledged: true }).action, 'check-login');
    assert.equal(nextWorkflowAction({ ...state, loginVerified: true }).action, 'continue');
    assert.equal(nextWorkflowAction({ ...state, loginVerified: false }).action, 'wait-login');
});
test('high business risk stops before browser and code repairs are bounded', () => {
    assert.equal(nextWorkflowAction({ risk: 'high', phase: 'browser' }).action, 'stop-business');
    const repair = nextWorkflowAction({ failure: 'code' });
    assert.equal(repair.action, 'repair');
    assert.equal(repair.restartAt, 'business-impact');
    assert.equal(repair.newTriggerWindow, true);
    assert.equal(nextWorkflowAction({ failure: 'code', repairRounds: 3 }).action, 'stop-repair');
    assert.equal(nextWorkflowAction({ failure: 'code', stagnantRounds: 2 }).action, 'stop-repair');
});
test('read-only work and query failures never authorize code repair', () => {
    assert.equal(nextWorkflowAction({ failure: 'code', mode: 'verify-data' }).action, 'report');
    assert.equal(nextWorkflowAction({ failure: 'query' }).action, 'resolve-condition');
    assert.equal(nextWorkflowAction({ failure: 'not-found' }).action, 'bounded-query-retry');
});
