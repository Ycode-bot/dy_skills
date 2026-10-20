import { isDeepStrictEqual } from 'node:util';

const text = value => typeof value === 'string' && value.trim().length > 0;
const evidence = value => Array.isArray(value) && value.length > 0 && value.every(text);
const fail = message => { throw new Error(`补查复核无效：${message}`); };
const windowTimes = value => {
    const times = [value?.startedAt, value?.finishedAt].map(v => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN);
    return times.every(Number.isFinite) && times[0] <= times[1] ? times : null;
};

export function validateReviews(review, rows) {
    if (review == null) return [];
    if (review.version !== 1 || !Array.isArray(review.resolutions)
        || Object.keys(review).some(key => !['version', 'resolutions'].includes(key))) fail('需要 version=1 和 resolutions 数组');
    const seen = new Set();
    for (const item of review.resolutions) {
        if (!item || Object.keys(item).some(key => !['id', 'platform', 'environment', 'stage', 'reportIndex', 'supersedes', 'reason', 'evidence', 'windowReview'].includes(key))
            || !['source', 'browser', 'runtime', 'ingestion'].includes(item.stage)
            || !rows.some(row => row.id === item.id && row.platform === item.platform && row.environment === item.environment && row.requiredEvidence.includes(item.stage))
            || !Number.isInteger(item.reportIndex) || item.reportIndex < 0
            || !Array.isArray(item.supersedes) || item.supersedes.some(i => !Number.isInteger(i) || i < 0 || i === item.reportIndex)
            || new Set(item.supersedes).size !== item.supersedes.length
            || !text(item.reason) || !evidence(item.evidence)) fail('需要有效场景、阶段、报告索引、supersedes、原因及可定位证据');
        const key = `${item.id}/${item.platform}/${item.environment}/${item.stage}`;
        if (seen.has(key)) fail(`重复复核 ${key}`);
        seen.add(key);
        if (item.windowReview && item.stage !== 'ingestion') fail('只有入库阶段可以复核查询窗口');
    }
    return review.resolutions;
}

export function selectReviewedEvidence({ resolution, reports, row, stage, select, contract }) {
    if (!resolution) return null;
    const matches = reports.map((report, reportIndex) => ({ ...select(report), reportIndex })).filter(item => item.result);
    const selected = matches.find(item => item.reportIndex === resolution.reportIndex);
    if (!selected || !(selected.result.status === 'PASS'
        || stage === 'browser' && selected.result.status === 'NOT_AVAILABLE' && selected.result.pageStatus === 'PASS')) fail('选中的报告必须已通过对应阶段检查');
    if (selected.result.event && selected.result.event !== row.event) fail('事件名不匹配');
    const old = matches.filter(item => item.reportIndex !== resolution.reportIndex);
    if (!isDeepStrictEqual(old.map(item => item.reportIndex).sort((a,b) => a-b), [...resolution.supersedes].sort((a,b) => a-b))) fail('supersedes 必须明确列出同一场景其余报告索引');
    if (stage === 'ingestion') {
        if (selected.result.event !== row.event) fail('入库报告必须包含正确事件名');
        for (const rule of contract.crossEventAssertions || []) {
            if (!rule.eventIds.includes(row.id) || row.platform !== 'sensors') continue;
            const assertion = selected.report.correlations?.find(item => item.id === rule.id);
            if (assertion?.status !== 'PASS' || !isDeepStrictEqual(assertion.eventIds, rule.eventIds)
                || rule.eventIds.some(id => !selected.report.results?.some(item => item.id === id && item.status === 'PASS'))) fail('补查必须在同一报告中通过全部关联事件及跨事件断言');
        }
    }
    return { ...selected, resolution, history: old.map(item => ({ reportIndex: item.reportIndex, status: item.result.status, issues: item.result.issues || [], queryWindow: item.result.queryWindow || null })) };
}

export function reviewWindowMatches(resolution, triggerWindow, queryWindow) {
    const review = resolution?.windowReview;
    if (!review) return false;
    const trigger = windowTimes(triggerWindow);
    const query = windowTimes(queryWindow);
    const observed = windowTimes(review.observedWindow);
    if (!trigger || !query || !observed
        || Object.keys(review).some(key => !['triggerWindow', 'queryWindow', 'observedWindow', 'reason', 'evidence', 'association'].includes(key))
        || !isDeepStrictEqual(review.triggerWindow, triggerWindow) || !isDeepStrictEqual(review.queryWindow, queryWindow)
        || !text(review.reason) || !evidence(review.evidence) || !text(review.association)
        || query[0] > trigger[1] || query[1] < trigger[0]
        || query[0] < observed[0] || query[1] > observed[1]) fail('窗口复核需要原始窗口、实际查询窗口、覆盖查询的已观测区间及同次业务关联依据');
    return true;
}
