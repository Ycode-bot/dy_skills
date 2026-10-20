import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeContract, compareQueriedContract, preflightQuery } from './verify-sensors-events.mjs';
import { resultMap, buildReport, formatMarkdown } from './generate-tracking-report.mjs';
import { createOwnedSession, executeSession, defaultBundle, isOwnedSession } from './run-browser-ingestion-verification.mjs';
import { appendEvidence } from './append-browser-evidence.mjs';
import { validateBrowserReport } from './validate-browser-report.mjs';

function contract() {
    return normalizeContract({ version: 2, events: ['show', 'click', 'success'].map(id => ({ id, targets: { sensors: { status: 'required', event: 'pay', match: { action: id }, properties: {} } } })), crossEventAssertions: [{ id: 'payment-chain', eventIds: ['show', 'click', 'success'], groupBy: 'exposure_id', equalProperties: ['offer_entry', 'timing_group'] }] });
}
function sources() {
    const rows = ['show', 'click', 'success'].map(action => ({ event: 'pay', action, exposure_id: 'one', offer_entry: 'badge', timing_group: 'after_generation', lmweb_url: 'http://localhost:3000/community' }));
    return ['show', 'click', 'success'].map(() => ({ rows, truncated: false, queryWindow: { startedAt: '2026-10-15T01:00:00Z', finishedAt: '2026-10-15T01:01:00Z' } }));
}
test('跨事件验证一致字段及多个独立曝光组', () => {
    const data = sources();
    data[0].rows.push(...structuredClone(data[0].rows).map(row => ({ ...row, exposure_id: 'two' })));
    assert.equal(compareQueriedContract(contract(), data).summary.failed, 0);
    assert.equal(compareQueriedContract(contract(), data).correlations[0].groupCount, 2);
});
for (const [name, mutate] of [
    ['字段漂移', data => { data[0].rows[2].timing_group = 'no_auto'; }],
    ['缺关联键', data => { delete data[0].rows[2].exposure_id; }],
    ['重复歧义', data => { data[0].rows.push({ ...data[0].rows[2] }); }],
    ['跨环境', data => { data[0].rows[2].lmweb_url = 'https://other.test/'; }],
    ['截断', data => { data[1].truncated = true; }],
    ['查询失败', data => { data[1].error = '网络失败'; }],
    ['时间窗不一致', data => { data[1].queryWindow.finishedAt = '2026-10-15T02:00:00Z'; }],
]) test(`跨事件拒绝${name}`, () => {
    const data = sources(); mutate(data);
    assert.ok(compareQueriedContract(contract(), data).summary.failed > 0);
});
test('声明次数后允许重复并校验上限，未知事件规则无效', () => {
    const spec = contract(); spec.crossEventAssertions[0].counts = { success: { min: 2, max: 2 } };
    const data = sources(); data[0].rows.push({ ...data[0].rows[2] });
    assert.equal(compareQueriedContract(spec, data).summary.failed, 0);
    data[0].rows.push({ ...data[0].rows[2] });
    assert.ok(compareQueriedContract(spec, data).summary.failed > 0);
    assert.throws(() => normalizeContract({ version: 2, events: [{ id: 'a', targets: { sensors: { status: 'required', event: 'a' } } }], crossEventAssertions: [{ id: 'bad', eventIds: ['a', 'missing'], groupBy: 'id', equalProperties: ['x'] }] }));
});
test('只读预检允许零条结果，限制一条且不产生验收 results', async () => {
    let options;
    const result = await preflightQuery(contract(), { environmentValue: 'localhost:3000' }, {}, async (_, opts) => { options = opts; return []; });
    assert.equal(options.limit, 1); assert.equal(options.environmentValue, 'localhost:3000');
    assert.equal(result.status, 'PASS'); assert.equal(result.results, undefined);
});
for (const message of ['HTTP 401', 'fetch failed']) test(`预检区分故障 ${message}`, async () => {
    const result = await preflightQuery(contract(), {}, {}, async () => { throw new Error(message); });
    assert.equal(result.status, 'QUERY_FAILED');
    assert.equal(result.message.includes('401'), message.includes('401'));
});
test('汇总保留失败，不能被后来的成功覆盖', () => {
    for (const statuses of [['FAILED','PASS'], ['PASS','FAILED']]) {
        const map = resultMap(statuses.map(status => ({ environment:'local', results:[{ id:'a', platform:'sensors', status }] })));
        assert.equal(map.get('a::sensors::local').result.status, 'FAILED');
        assert.match(map.get('a::sensors::local').result.issues.at(-1).message, /冲突/);
    }
});
function bundle() {
    const b = defaultBundle();
    b.contract = { version:2, environments:{ local:{ startUrl:'http://localhost:3000/', query:{property:'lmweb_url',operator:'contains',value:'localhost:3000'} } }, events:[{id:'a',targets:{sensors:{status:'required',event:'pay',properties:{}}},validation:{environments:{local:{status:'required'}}}}] };
    b.journey.steps = [{id:'visit',action:'goto',url:'http://localhost:3000/',covers:['a']}];
    b.browserReport.triggerWindow = {startedAt:'2026-10-15T01:00:00Z',finishedAt:'2026-10-15T01:01:00Z'};
    b.browserReport.steps = [{id:'visit',action:'goto',status:'PASS',locator:null,matchCount:null,executedAt:'2026-10-15T01:00:10Z'}];
    b.browserReport.results = [{id:'a',platform:'sensors',status:'NOT_AVAILABLE',method:'可见页面结果，未捕获发送'}];
    return b;
}
async function session(t, b) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(),'tracking-recovery-'));
    t.after(() => fs.rm(root,{recursive:true,force:true}));
    return createOwnedSession({temporaryRoot:root,bundle:b});
}
const pass = b => ({summary:{total:1,passed:1,failed:0},results:[{id:'a',status:'PASS',queryWindow:b.browserReport.triggerWindow}]});
test('未知字段校验失败保留原文件，修正后显式恢复且不丢历史', async t => {
    const b=bundle();b.browserReport.steps[0].extra='unexpected';
    const p=await session(t,b);const original=await fs.readFile(p.bundle,'utf8');
    let calls=0;
    const failed=await executeSession({session:p.session},{sleep:async()=>{},query:async()=>{calls++;return pass(b);}});
    assert.equal(failed.status,'BLOCKED');assert.equal(calls,0);
    assert.equal(await fs.readFile(p.bundle,'utf8'),original);assert.ok(await isOwnedSession(p.session));
    delete b.browserReport.steps[0].extra;await fs.writeFile(p.bundle,JSON.stringify(b));
    const ok=await executeSession({session:p.session,resume:true},{sleep:async()=>{},query:async()=>pass(b)});
    assert.equal(ok.status,'PASS');assert.equal(ok.previousRuns.length,1);
});
test('查询恢复保持原窗口，窗口变化被拒绝且旧记录不变', async t => {
    const b=bundle();const p=await session(t,b);
    const failed=await executeSession({session:p.session},{sleep:async()=>{},query:async()=>{throw new Error('network');}});
    assert.equal(failed.status,'FAILED');
    const original=await fs.readFile(p.debugBundle,'utf8');
    const altered=structuredClone(b);altered.browserReport.triggerWindow.finishedAt='2026-10-15T02:00:00Z';
    await fs.writeFile(p.bundle,JSON.stringify(altered));
    await assert.rejects(executeSession({session:p.session,resume:true}),/不能修改/);
    assert.equal(await fs.readFile(p.debugBundle,'utf8'),original);
    await fs.writeFile(p.bundle,JSON.stringify(b));
    const ok=await executeSession({session:p.session,resume:true},{sleep:async()=>{},query:async({browserReportPath})=>{
        assert.deepEqual(JSON.parse(await fs.readFile(browserReportPath,'utf8')).triggerWindow,b.browserReport.triggerWindow);return pass(b);
    }});
    assert.equal(ok.status,'PASS');assert.equal(ok.finalReport.recoveryHistory.length,1);
});
test('追加证据校验失败不修改原文件，合法证据原样写入', async t => {
    const b=bundle();const step=b.browserReport.steps[0];b.browserReport.steps=[];b.browserReport.results=[];
    const p=await session(t,b);const before=await fs.readFile(p.bundle,'utf8');
    await assert.rejects(appendEvidence(p.session,{step:{...step,extra:'bad'}}),/unsupported/);
    assert.equal(await fs.readFile(p.bundle,'utf8'),before);
    await appendEvidence(p.session,{step});
    const saved=JSON.parse(await fs.readFile(p.bundle,'utf8'));
    assert.deepEqual(saved.browserReport.steps,[step]);assert.deepEqual(saved.browserReport.results,[]);
});
test('报告区分前置条件不满足、未执行与发送不可见，并记录账号条件', () => {
    const b=bundle();b.browserReport.accountConditions=['尚未购买；B 组'];
    b.browserReport.results[0].reason={code:'PRECONDITION_UNMET',message:'本轮付款后资格失效',recovery:'换用仍有资格的测试账号',changedByRun:true};
    assert.equal(validateBrowserReport(b.browserReport,b.journey,b.contract).status,'PASS');
    const browser={...b.browserReport,results:[{...b.browserReport.results[0],pageStatus:'PASS'}]};
    const report=buildReport({contract:b.contract,browser,mode:'full-lifecycle'});
    const md=formatMarkdown(report);
    assert.match(md,/未直接捕获/);assert.match(md,/尚未购买/);assert.match(md,/换用仍有资格/);
});
