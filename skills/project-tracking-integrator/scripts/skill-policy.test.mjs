import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = fs.readFileSync(path.join(skillDirectory, 'SKILL.md'), 'utf8');
const sensorsReference = fs.readFileSync(path.join(skillDirectory, 'references/sensors-verification.md'), 'utf8');

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
