import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = fs.readFileSync(path.join(skillDirectory, 'SKILL.md'), 'utf8');
const sensorsReference = fs.readFileSync(path.join(skillDirectory, 'references/sensors-verification.md'), 'utf8');
const browserReference = fs.readFileSync(path.join(skillDirectory, 'references/browser-verification.md'), 'utf8');
const browserJourneyExample = JSON.parse(fs.readFileSync(path.join(skillDirectory, 'references/browser-journey.example.json'), 'utf8'));
const browserRunner = fs.readFileSync(path.join(skillDirectory, 'scripts/run-browser-ingestion-verification.mjs'), 'utf8');

test('ordinary tracking work never runs or mentions the updater', () => {
    assert.match(skill, /Do not run the updater during ordinary tracking work/);
    assert.match(skill, /unless the user explicitly asks to update, refresh, or check this Skill/);
    assert.doesNotMatch(skill, /At the beginning of every invocation/);
});

test('documentation examples cannot become binding value constraints', () => {
    assert.match(skill, /Do not copy an illustrative value into `match`, `equals`, `oneOf`, `pattern`/);
    assert.match(sensorsReference, /示例值不得自动进入 `match`、`equals`、`oneOf`、`pattern`/);
    assert.match(sensorsReference, /实际入库为字符串 `3` 时，类型验收通过/);
});

test('browser retries reuse a fixed trigger window and do not invent a maximum count', () => {
    assert.match(skill, /run-browser-ingestion-verification\.mjs --session/);
    assert.match(skill, /without repeating browser actions/);
    assert.match(skill, /When `maxCount` is absent, do not invent `maxCount: 1`/);
    assert.match(browserReference, /两次查询始终读取同一份浏览器报告快照/);
    assert.match(sensorsReference, /`maxCount` 未填写表示不限制上界/);
});

test('version 3 browser verification rejects ambiguous actions and uses bounded delayed retries', () => {
    assert.equal(browserJourneyExample.version, 3);
    assert.equal(browserJourneyExample.verification.ingestionWaitSeconds, 240);
    assert.equal(browserJourneyExample.verification.retryWaitSeconds, 240);
    assert.equal('sinceMinutes' in browserJourneyExample.verification, false);
    assert.match(skill, /require exactly one match/);
    assert.match(skill, /Reject positional CSS and never use `\.first\(\)`/);
    assert.match(browserReference, /`scroll-into-view`/);
    assert.match(browserReference, /`hover`/);
    assert.match(browserRunner, /shouldRetryReport/);
    assert.match(browserRunner, /MAX_WAIT_SECONDS = 1800/);
});

test('browser verification keeps one bundle and cleans marker-owned temporary artifacts', () => {
    assert.match(skill, /single `verification-bundle\.json`/);
    assert.match(skill, /keeps only `final-report\.md` and `debug-bundle\.json`/);
    assert.match(browserReference, /不要再分别创建 `contract\.json`、`journey\.json`、`browser-report\.json`/);
    assert.match(browserRunner, /SESSION_MARKER/);
    assert.match(browserRunner, /--keep-artifacts/);
});
