import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifySource } from './verify-tracking-source.mjs';
import { compareContract, normalizeContract, buildSensorsSql, filterEnvironmentRows, resolveQueryWindow } from './verify-sensors-events.mjs';
import { buildReport, formatMarkdown } from './generate-tracking-report.mjs';
import { statusLabel, formatValidation } from './reporting.mjs';

const require = createRequire(path.join(process.cwd(), 'package.json'));
let parsers;
try { parsers = { ts: require('typescript'), vue: require('vue/compiler-sfc') }; } catch { /* Parser-dependent cases explicitly skip on projects without these dependencies. */ }
const contract = { version: 2, events: [{ id: 'click', trigger: '点击', targets: { sensors: { status: 'required', event: 'clicked', wrapper: 'trackClick', properties: { source: { type: 'string', equals: 'page' } } } } }] };
const sources = body => [
    { path: 'lib/track/click.ts', text: 'import sensors from "@joyme/sensors-data";\n' + body },
    { path: 'pages/index.vue', text: '<script setup lang="ts">import { trackClick as send } from "../lib/track/click"</script><template><button @click="send()">测试</button></template>' },
];
const verify = (code, options = {}, spec = contract) => verifySource(spec, sources(code), '', { parsers, ...options }).results[0];
const parserTest = (name, callback) => test(name, { skip: !parsers && '当前测试项目未安装 TypeScript/Vue 解析器' }, callback);
parserTest('real Vue template calls and import aliases link to the wrapper', () => {
    assert.equal(verify('export function trackClick() { sensors.track("clicked", { source: "page" }) }').status, 'PASS');
});
parserTest('comments and unrelated files cannot substitute implementation', () => {
    const files = sources('export function trackClick() {} // trackClick sensors.track("clicked", {source:"page"})');
    files.push({ path: 'unrelated.ts', text: 'const x = {event: "clicked", source: "page"}' });
    const result = verifySource(contract, files, '', { parsers }).results[0];
    assert.notEqual(result.status, 'PASS');
    assert.ok(result.issues.every(issue => issue.message && issue.location && issue.nextStep && issue.impact && issue.attempted));
});
parserTest('method-only does not require a caller, integration does', () => {
    const files = [sources('export function trackClick() { sensors.track("clicked", { source: "page" }) }')[0]];
    assert.equal(verifySource(contract, files, '', { parsers, scope: 'method' }).results[0].status, 'PASS');
    assert.equal(verifySource(contract, files, '', { parsers }).results[0].status, 'UNREACHABLE');
});
parserTest('parameter shadowing cannot use a module constant as evidence', () => {
    assert.equal(verify('const source="page"; export function trackClick(source) { sensors.track("clicked", {source:source}) }').status, 'NEEDS_REVIEW');
});
parserTest('dynamic match cannot silently pass', () => {
    const spec = structuredClone(contract);
    spec.events[0].targets.sensors.match = { id: 'right' };
    assert.equal(verify('export function trackClick(id) { sensors.track("clicked", { source:"page", id:id }) }', {}, spec).status, 'NEEDS_REVIEW');
});
parserTest('early returns cannot prove a reachable transport', () => {
    assert.equal(verify('export function trackClick() { return; sensors.track("clicked", {source:"page"}) }').status, 'NEEDS_REVIEW');
});
parserTest('object spread, indirect transport and missing import include concrete reasons', () => {
    for (const body of ['export function trackClick(params) { sensors.track("clicked", {...params}) }', 'export function trackClick() { sendBusinessEvent() }']) assert.equal(verify(body).status, 'NEEDS_REVIEW');
    const files = sources('export function trackClick() { sensors.track("clicked", {source:"page"}) }');
    files[1].text = '<script setup>trackClick()</script>';
    assert.equal(verifySource(contract, files, '', { parsers }).results[0].status, 'NEEDS_REVIEW');
});
parserTest('Nuxt generated auto-import binding resolves the actual module', () => {
    const files = sources('export function trackClick() { sensors.track("clicked", {source:"page"}) }');
    files[1].text = '<script setup>trackClick()</script>';
    files.push({ path: '.nuxt/imports.d.ts', text: 'export { trackClick } from "../lib/track/click"' });
    assert.equal(verifySource(contract, files, '', { parsers }).results[0].status, 'PASS');
});
test('missing parser does not fall back to string matching', () => {
    assert.equal(verifySource(contract, sources(''), '', { parsers: {} }).results[0].issues[0].code, 'PARSER_UNAVAILABLE');
});
test('zero expected with zero actual passes, one actual fails and query failure still wins', () => {
    const spec = normalizeContract({ events: [{ event: 'clicked', minCount: 0, maxCount: 0, properties: {} }] });
    assert.equal(compareContract(spec, []).results[0].status, 'PASS');
    assert.equal(compareContract(spec, [{event:'clicked'}]).results[0].status, 'DUPLICATED');
});
test('environment isolation compares host and port, not path/query text or suffix', () => {
    const options = { environmentValue: 'localhost:3000' };
    const rows = ['http://localhost:3000/a', 'http://localhost:30001/a', 'https://evil.test/?next=http://localhost:3000', 'http://localhost:3000.evil.test'].map(lmweb_url => ({lmweb_url}));
    const filtered = filterEnvironmentRows(rows, options);
    assert.equal(filtered.rows.length, 1);
    assert.equal(filterEnvironmentRows([{lmweb_url:'bad'}], options).invalidEnvironmentCount, 1);
    assert.equal(filterEnvironmentRows([{lmweb_url:'http://[::1]:3000/a'}], {environmentValue:'[::1]:3000'}).rows.length, 1);
});
test('query window rejects unspecified timezone and SQL is host-timezone independent', () => {
    assert.throws(() => resolveQueryWindow({}, {startedAt:'2026-10-12T10:00:00',finishedAt:'2026-10-12T10:01:00'}), /时区/);
    const options = {startedAt:'2026-10-12T00:00:00Z',finishedAt:'2026-10-12T00:01:00Z',queryTimeZone:'Asia/Shanghai'};
    assert.match(buildSensorsSql({event:'clicked'}, options), /08:00:00/);
    const url = new URL('./verify-sensors-events.mjs', import.meta.url).href;
    const script = `import {buildSensorsSql} from ${JSON.stringify(url)}; console.log(buildSensorsSql({event:'clicked'},${JSON.stringify(options)}))`;
    const outputs = ['UTC', 'America/Los_Angeles'].map(TZ => spawnSync(process.execPath, ['--input-type=module','-e',script], {encoding:'utf8',env:{...process.env,TZ}}).stdout);
    assert.equal(outputs[0], outputs[1]);
});
const window = {startedAt:'2026-10-12T00:00:00Z',finishedAt:'2026-10-12T00:01:00Z'};
function evidenceSet() {
    const spec = structuredClone(contract);
    spec.environments = {local:{startUrl:'http://localhost:3000',query:{property:'lmweb_url',operator:'contains',value:'localhost:3000'}}};
    spec.events[0].validation = {environments:{local:{status:'required',evidence:['source','browser','ingestion']}}};
    const result = {id:'click',platform:'sensors',event:'clicked',status:'PASS'};
    return {contract:spec, mode:'full-lifecycle',
        source:{results:[{...result}]},
        browser:{environment:'local',triggerWindow:window,results:[{...result}]},
        ingestion:{environment:{name:'local',property:'lmweb_url',value:'localhost:3000'},results:[{...result,queryWindow:window}]},
        development:{businessImpact:{status:'PASS',risk:'low',evidence:['handler.ts:10 已审查']},documentation:{status:'PASS',path:'docs/tracking/events.md',evidence:['事件表已更新']}}
    };
}
test('full lifecycle requires development, browser and matching ingestion window', () => {
    assert.equal(buildReport(evidenceSet()).status, 'PASS');
    for (const field of ['development', 'browser', 'ingestion']) {
        const input = evidenceSet(); delete input[field];
        assert.notEqual(buildReport(input).status, 'PASS');
    }
    const input = evidenceSet(); input.ingestion.results[0].queryWindow = {...window,finishedAt:'2026-10-12T00:02:00Z'};
    assert.notEqual(buildReport(input).status, 'PASS');
});
test('wrong event and empty acceptance rows never pass', () => {
    const input = evidenceSet(); input.source.results[0].event = 'wrong';
    assert.notEqual(buildReport(input).status, 'PASS');
    input.contract.events[0].targets = {};
    assert.notEqual(buildReport(input).status, 'PASS');
});
test('report preserves reasons and presents statuses in Chinese', () => {
    const input = evidenceSet(); input.source.results[0].status = 'NEEDS_REVIEW';
    input.source.results[0].issues = [{message:'字段来自动态参数',location:'handler.ts:12',nextStep:'检查实参'}];
    const report = buildReport(input);
    const output = formatMarkdown(report);
    assert.match(output, /字段来自动态参数/);
    assert.match(output, /handler.ts:12/);
    assert.doesNotMatch(output, /NEEDS_REVIEW|INCOMPLETE|PASS/);
    assert.equal(statusLabel('NEEDS_REVIEW'), '需进一步确认');
    assert.match(formatValidation({status:'INVALID',issues:['report.steps must be an array']}), /必须是数组/);
});

test('CLI executes through a symlink path and emits Chinese help', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const { fileURLToPath } = await import('node:url');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tracking-cli-link-'));
    try {
        const link = path.join(directory, 'verifier.mjs');
        await fs.symlink(fileURLToPath(new URL('./verify-tracking-source.mjs', import.meta.url)), link);
        const output = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
        assert.equal(output.status, 0);
        assert.match(output.stdout, /埋点源码检查/);
        assert.ok(output.stdout.length > 0);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('zero counts never bypass truncated or failed ingestion evidence', async () => {
    const { compareQueriedContract } = await import('./verify-sensors-events.mjs');
    const spec = normalizeContract({events:[{event:'clicked',minCount:0,maxCount:0,properties:{}}]});
    for (const source of [{rows:[],truncated:true,limit:100},{rows:[],error:'查询失败'}]) assert.equal(compareQueriedContract(spec,[source]).results[0].status, 'QUERY_FAILED');
});

test('another project can verify its contract-declared QA origin', async () => {
    const fs = await import('node:fs/promises');
    const { validateBrowserJourney } = await import('./validate-browser-journey.mjs');
    const journey = JSON.parse(await fs.readFile(new URL('../references/browser-journey.example.json',import.meta.url),'utf8'));
    const originalOrigin = new URL(journey.startUrl).origin;
    const customized = JSON.parse(JSON.stringify(journey).replaceAll(originalOrigin,'https://qa.other.test'));
    customized.environment = 'qa';
    const spec = {environments:{qa:{startUrl:customized.startUrl,query:{property:'lmweb_url',operator:'contains',value:'qa.other.test'}}},events:[]};
    // Environment validation must use the supplied project; unrelated coverage constraints still apply.
    const result = validateBrowserJourney(customized,spec);
    assert.ok(!result.issues.some(issue => issue.includes('qa.imastudio.com')));
    spec.environments.qa.startUrl='https://other.test/';
    assert.ok(validateBrowserJourney(customized,spec).issues.some(issue => issue.includes('起始地址与契约环境不一致')));
});

parserTest('lexical shadows never count as imported wrapper calls', () => {
    const bodies = [
        'function click(){const trackClick=()=>{};trackClick()}',
        'function click(){function trackClick(){};trackClick()}',
        'function click(){const {trackClick}=other;trackClick()}',
        'function click(){try{}catch(trackClick){trackClick()}}',
        'function click(){if(true){var trackClick=()=>{}};trackClick()}',
        'function click(){const api={trackClick(){}};api.trackClick()}',
    ];
    for (const body of bodies) {
        const files = [sources('export function trackClick(){sensors.track("clicked",{source:"page"})}')[0], {path:'caller.ts',text:`import {trackClick} from "./lib/track/click";import * as api from "./lib/track/click";${body}`}];
        assert.notEqual(verifySource(contract,files,'',{parsers}).results[0].status,'PASS',body);
    }
    const files = [sources('export function trackClick(){sensors.track("clicked",{source:"page"})}')[0], {path:'caller.ts',text:'import {trackClick} from "./lib/track/click";function unrelated(){const trackClick=()=>{}};trackClick()'}];
    assert.equal(verifySource(contract,files,'',{parsers}).results[0].status,'PASS');
});
parserTest('object mutation, alias and escape require concrete review evidence', () => {
    for (const mutation of ['payload.source="wrong";', 'Object.assign(payload,{source:"wrong"});', 'const alias=payload;alias.source="wrong";', 'change(payload);']) {
        const result = verify(`const payload={source:"page"};${mutation}export function trackClick(){sensors.track("clicked",payload)}`);
        assert.equal(result.status,'NEEDS_REVIEW');
        assert.ok(result.issues.some(issue=>issue.code==='MUTABLE_CONSTANT' && issue.nextStep));
    }
    assert.equal(verify('const source="page";export function trackClick(){sensors.track("clicked",{source:source})}').status,'PASS');
});
test('full lifecycle preserves additional mandatory runtime evidence', () => {
    const input=evidenceSet();
    input.contract.events[0].validation.environments.local.evidence.push('runtime');
    assert.notEqual(buildReport(input).status,'PASS');
    input.runtime={environment:'local',results:[{...input.source.results[0],status:'CONTRACT_MISMATCH'}]};
    assert.notEqual(buildReport(input).status,'PASS');
    input.runtime.results[0].status='PASS';
    assert.equal(buildReport(input).status,'PASS');
});
test('runner retains field diagnosis in Chinese report', async () => {
    const {runVerificationWorkflow,formatFinalReportMarkdown}=await import('./run-browser-ingestion-verification.mjs');
    const result=await runVerificationWorkflow({journey:{verification:{ingestionWaitSeconds:0,retryWaitSeconds:60,maxQueryAttempts:1}},specPath:'mock',browserReportPath:'mock',sleep:async()=>{},query:async()=>({results:[{id:'click',event:'clicked',status:'CONTRACT_MISMATCH',issues:[{property:'source',message:'来源字段不符合要求',expected:'page',actual:'wrong'}]}]})});
    const output=formatFinalReportMarkdown(result);
    for(const value of ['来源字段不符合要求','字段："source"','预期："page"','实际："wrong"']) assert.ok(output.includes(value));
});
test('successful runner evidence feeds aggregate report before explicit cleanup', async t => {
    const fs=await import('node:fs/promises');
    const os=await import('node:os');
    const {createOwnedSession,finalizeSession,runCli}=await import('./run-browser-ingestion-verification.mjs');
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'tracking-evidence-'));
    t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const paths=await createOwnedSession({temporaryRoot:root});
    const input=evidenceSet();
    const artifacts=await finalizeSession({paths,bundle:{browserReport:input.browser},workflow:{status:'PASS',attempts:[],policy:{},finalReport:input.ingestion}});
    input.browser=JSON.parse(await fs.readFile(artifacts.browserEvidence,'utf8'));
    input.ingestion=JSON.parse(await fs.readFile(artifacts.ingestionEvidence,'utf8'));
    assert.equal(buildReport(input).status,'PASS');
    assert.equal(await runCli(['--cleanup','--session',paths.session]),0);
    await assert.rejects(fs.access(paths.session));
    await assert.rejects(runCli(['--cleanup','--session',root]));
});

test('aggregate uses the selected browser report window and rejects stale ingestion', () => {
    const input = evidenceSet();
    const latestWindow = { startedAt:'2026-10-12T02:00:00Z', finishedAt:'2026-10-12T02:01:00Z' };
    input.browser = [input.browser, {...structuredClone(input.browser), triggerWindow:latestWindow}];
    assert.notEqual(buildReport(input).status, 'PASS');
    input.ingestion.results[0].queryWindow = latestWindow;
    assert.equal(buildReport(input).status, 'PASS');
    input.browser[1].results[0].status = 'FAILED';
    assert.equal(buildReport(input).status, 'FAILED');
});
test('platform fallback checks event identity and retains issue details', () => {
    for (const stage of ['source', 'browser', 'runtime']) {
        const input = evidenceSet();
        input.contract.events[0].validation.environments.local.evidence.push('runtime');
        input.runtime = { environment:'local', results:[{...input.source.results[0]}] };
        delete input[stage].results[0].platform;
        assert.equal(buildReport(input).status, 'PASS');
        input[stage].results[0].event = 'wrong';
        assert.equal(buildReport(input).status, 'FAILED', stage);
        input[stage].results[0].event = 'clicked';
        input[stage].results[0].status = 'NEEDS_REVIEW';
        input[stage].results[0].issues = [{message:'来源待确认',location:'caller.ts:10',nextStep:'检查初始化'}];
        const report = buildReport(input);
        assert.notEqual(report.status, 'PASS');
        assert.match(formatMarkdown(report), /来源待确认/);
        assert.match(formatMarkdown(report), /caller.ts:10/);
    }
});
parserTest('SDK platform must match the required target', () => {
    const spec = structuredClone(contract);
    spec.events[0].targets.ga4 = spec.events[0].targets.sensors;
    delete spec.events[0].targets.sensors;
    const result = verify('export function trackClick(){sensors.track("clicked",{source:"page"})}', {}, spec);
    assert.equal(result.status, 'CONTRACT_MISMATCH');
    assert.ok(result.issues.some(issue => issue.code === 'TRANSPORT_PLATFORM_MISMATCH'));
    const files = [
        {path:'track.ts',text:'import sdk from "mixpanel-browser";export function trackClick(){sdk.track("clicked",{source:"page"})}'},
        {path:'caller.ts',text:'import {trackClick} from "./track";trackClick()'},
    ];
    assert.equal(verifySource(contract, files, '', {parsers}).results[0].status, 'CONTRACT_MISMATCH');
    const mixpanel = structuredClone(contract);
    mixpanel.events[0].targets.mixpanel = mixpanel.events[0].targets.sensors;
    delete mixpanel.events[0].targets.sensors;
    assert.equal(verifySource(mixpanel, files, '', {parsers}).results[0].status, 'PASS');
});
parserTest('local SDK shadows and unknown imports cannot prove a transport', () => {
    for (const body of [
        'export function trackClick(){const sensors={track(){}};sensors.track("clicked",{source:"page"})}',
        'export function trackClick(sensors){sensors.track("clicked",{source:"page"})}',
        'export function trackClick({sensors}){sensors.track("clicked",{source:"page"})}',
    ]) {
        const result = verify(body);
        assert.equal(result.status, 'NEEDS_REVIEW');
        assert.ok(result.issues.some(issue => issue.code === 'TRANSPORT_BINDING_UNRESOLVED'));
    }
    for (const prefix of ['', 'const sensors={track(){}};', 'import sensors from "./fake";']) {
        const files = [
            {path:'track.ts',text:prefix+'export function trackClick(){sensors.track("clicked",{source:"page"})}'},
            {path:'caller.ts',text:'import {trackClick} from "./track";trackClick()'},
        ];
        assert.equal(verifySource(contract, files, '', {parsers}).results[0].status, 'NEEDS_REVIEW');
    }
});
parserTest('transport helper must resolve to the required SDK without local shadowing', () => {
    const files = [
        {path:'transport.ts',text:'import sdk from "@joyme/sensors-data";export function track(event,payload){sdk.track(event,payload)}'},
        {path:'track.ts',text:'import {track} from "./transport";export function trackClick(){track("clicked",{source:"page"})}'},
        {path:'caller.ts',text:'import {trackClick} from "./track";trackClick()'},
    ];
    assert.equal(verifySource(contract, files, '', {parsers}).results[0].status, 'PASS');
    files[0].text = 'import sdk from "@joyme/sensors-data";export function track(event,payload){const sdk={track(){}};sdk.track(event,payload)}';
    assert.equal(verifySource(contract, files, '', {parsers}).results[0].status, 'NEEDS_REVIEW');
});

test('conflicting report and result environments cannot reuse local evidence as QA', () => {
    for (const stage of ['browser', 'ingestion']) {
        const input = evidenceSet();
        input.contract.environments.qa = {startUrl:'https://qa.example.com',query:{property:'lmweb_url',value:'qa.example.com'}};
        input.contract.events[0].validation.environments = {local:{status:'disabled'},qa:{status:'required',evidence:['source','browser','ingestion']}};
        input.browser.environment = 'qa';
        input.ingestion.environment = {name:'qa',property:'lmweb_url',value:'qa.example.com'};
        assert.equal(buildReport(input).status, 'PASS');
        input[stage].environment = stage === 'browser' ? 'local' : {name:'local',property:'lmweb_url',value:'localhost:3000'};
        input[stage].results[0].environment = 'qa';
        assert.equal(buildReport(input).status, 'FAILED');
        input[stage].results[0].method = 'agent-review';
        assert.equal(buildReport(input).status, 'FAILED');
    }
});
test('missing or mismatched windows preserve explicit ingestion failures', () => {
    for (const status of ['QUERY_FAILED', 'CONTRACT_MISMATCH', 'DUPLICATED', 'NOT_FOUND']) {
        for (const queryWindow of [null, {...window,finishedAt:'2026-10-12T03:00:00Z'}]) {
            const input = evidenceSet();
            Object.assign(input.ingestion.results[0], {status,queryWindow,issues:[{message:'本次验收的原始失败原因'}]});
            const report = buildReport(input);
            assert.equal(report.status, 'FAILED');
            assert.equal(report.results[0].ingestion, status);
            assert.match(formatMarkdown(report), /本次验收的原始失败原因/);
            assert.match(formatMarkdown(report), /窗口缺失或不一致/);
        }
    }
});
parserTest('transport modifications cannot substitute outer arguments as SDK evidence', () => {
    for (const body of [
        'sensors.track("wrong_event",{source:"wrong"})',
        'payload.source="wrong";sensors.track(event,payload)',
        'if(false){sensors.track(event,payload)}',
        'sensors.track(payload,event)',
    ]) {
        const files = [
            {path:'transport.ts',text:`import sensors from "@joyme/sensors-data";export function track(event,payload){${body}}`},
            {path:'track.ts',text:'import {track} from "./transport";export function trackClick(){track("clicked",{source:"page"})}'},
            {path:'caller.ts',text:'import {trackClick} from "./track";trackClick()'},
        ];
        const result = verifySource(contract, files, '', {parsers}).results[0];
        assert.equal(result.status, 'NEEDS_REVIEW', body);
        assert.ok(result.issues.some(issue => issue.code === 'TRANSPORT_ARGUMENTS_UNRESOLVED' && issue.location.includes('transport.ts')));
    }
});
parserTest('Vue loop and slot bindings shadow imports without affecting sibling handlers', () => {
    const templates = [
        '<button v-for="trackClick in items" @click="trackClick()"/>',
        '<div v-for="{action:trackClick} in items"><button @click="trackClick()"/></div>',
        '<X v-slot="{trackClick}"><button @click="trackClick()"/></X>',
        '<X v-slot="{action:trackClick}"><button @click="trackClick"/></X>',
    ];
    for (const template of templates) {
        const files = sources('export function trackClick(){sensors.track("clicked",{source:"page"})}');
        files[1].text = `<script setup>import {trackClick} from "../lib/track/click";const items=[()=>{}]</script><template>${template}</template>`;
        assert.notEqual(verifySource(contract,files,'',{parsers}).results[0].status, 'PASS', template);
        files[1].text = files[1].text.replace('</template>', '<button @click="trackClick()"/></template>');
        assert.equal(verifySource(contract,files,'',{parsers}).results[0].status, 'PASS');
    }
});

test('method-only source does not satisfy complete lifecycle integration evidence', () => {
    const input = evidenceSet();
    input.source.results[0].scope = 'method';
    assert.notEqual(buildReport(input).status, 'PASS');
    assert.match(formatMarkdown(buildReport(input)), /尚未验证业务调用点/);
    input.source.results[0].scope = 'integration';
    assert.equal(buildReport(input).status, 'PASS');
});
parserTest('named default exports and default export assignments resolve callers', () => {
    for (const body of [
        'export default function trackClick(){sensors.track("clicked",{source:"page"})}',
        'const trackClick=()=>{sensors.track("clicked",{source:"page"})};export default trackClick',
    ]) {
        const files = sources(body);
        files[1].text='<script setup>import send from "../lib/track/click"</script><template><button @click="send()"/></template>';
        assert.equal(verifySource(contract,files,'',{parsers}).results[0].status,'PASS');
    }
});
test('unknown targets and empty source scope cannot return success', () => {
    const spec = structuredClone(contract);
    spec.events[0].targets.sensors.status='unknown';
    const report=verifySource(spec,[],'',{parsers:{}});
    assert.equal(report.results[0].status,'BLOCKED');
    assert.ok(report.results[0].issues[0].nextStep);
    assert.notEqual(report.status,'PASS');
    spec.events[0].targets.sensors.status='disabled';
    const empty=verifySource(spec,[],'',{parsers:{}});
    assert.notEqual(empty.status,'PASS');
    assert.ok(empty.issues.length);
});
test('page evidence cannot replace required runtime evidence', () => {
    const input=evidenceSet();
    input.browser.results[0].status='NOT_AVAILABLE';
    assert.notEqual(buildReport(input).status,'PASS');
    input.browser.results[0].pageStatus='PASS';
    assert.equal(buildReport(input).status,'PASS');
    assert.match(formatMarkdown(buildReport(input)),/发送证据当前无法获取/);
    input.contract.events[0].validation.environments.local.evidence.push('runtime');
    assert.notEqual(buildReport(input).status,'PASS');
    input.runtime=structuredClone(input.browser);
    assert.notEqual(buildReport(input).status,'PASS');
    input.browser.results[0].status='FAILED';
    assert.equal(buildReport(input).status,'FAILED');
});

test('source CLI exits unsuccessfully for unknown or empty target scope', async t => {
    const fs=await import('node:fs/promises');
    const os=await import('node:os');
    const {fileURLToPath}=await import('node:url');
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'tracking-unknown-'));
    t.after(()=>fs.rm(root,{recursive:true,force:true}));
    for(const status of ['unknown','disabled']) {
        const spec=structuredClone(contract);
        spec.events[0].targets.sensors.status=status;
        const file=path.join(root,'contract.json');
        await fs.writeFile(file,JSON.stringify(spec));
        const result=spawnSync(process.execPath,[fileURLToPath(new URL('./verify-tracking-source.mjs',import.meta.url)),'--root',root,'--spec',file],{encoding:'utf8'});
        assert.equal(result.status,1);
        assert.match(result.stdout,/尚未确定|没有可检查的目标/);
    }
});
