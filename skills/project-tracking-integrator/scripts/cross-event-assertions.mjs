import { isDeepStrictEqual } from 'node:util';

const property = (row, key) => row?.properties?.[key] ?? row?.[key];
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;

export function validateAssertions(rules, events) {
    if (rules === undefined) return [];
    if (!Array.isArray(rules)) throw new Error('crossEventAssertions 必须是数组');
    const ids = new Set(events.map(event => event.id));
    const seen = new Set();
    for (const rule of rules) {
        if (!rule || Object.keys(rule).some(k => !['id', 'eventIds', 'groupBy', 'equalProperties', 'counts'].includes(k))
            || !nonEmpty(rule.id) || seen.has(rule.id)
            || !Array.isArray(rule.eventIds) || rule.eventIds.length < 2 || new Set(rule.eventIds).size !== rule.eventIds.length
            || rule.eventIds.some(id => !ids.has(id))
            || !nonEmpty(rule.groupBy) || !Array.isArray(rule.equalProperties) || !rule.equalProperties.length
            || rule.equalProperties.some(k => !nonEmpty(k))) throw new Error('跨事件规则无效：需要唯一 id、至少两个有效 eventIds、groupBy 和 equalProperties');
        seen.add(rule.id);
        if (rule.counts !== undefined && (!rule.counts || typeof rule.counts !== 'object' || Array.isArray(rule.counts))) throw new Error('counts 必须为对象');
        for (const [id, count] of Object.entries(rule.counts || {})) {
            if (!rule.eventIds.includes(id) || !count || Object.keys(count).some(k => !['min', 'max'].includes(k))
                || !Number.isInteger(count.min) || count.min < 1
                || (count.max !== undefined && (!Number.isInteger(count.max) || count.max < count.min))) throw new Error('counts 只能指定参与事件，min >= 1，max >= min');
        }
    }
    return rules;
}

// Each source is already isolated to the selected environment and fixed query window.
export function compareAssertions(contract, sources) {
    return (contract.crossEventAssertions || []).map(rule => {
        const issues = [];
        const groups = new Map();
        const hosts = new Set();
        const windows = new Set();
        for (const id of rule.eventIds) {
            const index = contract.events.findIndex(e => e.id === id);
            const expected = contract.events[index];
            const source = sources[index];
            if (!source || source.error || source.truncated) {
                issues.push({ code: 'QUERY_FAILED', message: `${id} 查询失败、缺失或截断，不能关联` });
                continue;
            }
            if (source.queryWindow) windows.add(JSON.stringify([source.queryWindow.startedAt, source.queryWindow.finishedAt]));
            const rows = source.rows.filter(row => (row.event ?? row.event_name ?? row.name) === expected.event
                && Object.entries(expected.match || {}).every(([k, v]) => property(row, k) != null && String(property(row, k)) === String(v)));
            if (!rows.length) issues.push({ code: 'NOT_FOUND', message: `${id} 没有可关联事件` });
            for (const row of rows) {
                try { hosts.add(new URL(property(row, source.environmentProperty || 'lmweb_url')).host); }
                catch { issues.push({ code: 'ENVIRONMENT_MISSING', message: `${id} 缺少有效环境 URL` }); }
                const key = property(row, rule.groupBy);
                if (!(nonEmpty(key) || typeof key === 'number' && Number.isFinite(key))) {
                    issues.push({ code: 'CORRELATION_KEY_MISSING', message: `${id} 缺少关联字段 ${rule.groupBy}` });
                    continue;
                }
                const keyString = JSON.stringify(key);
                if (!groups.has(keyString)) groups.set(keyString, new Map());
                const group = groups.get(keyString);
                group.set(id, [...(group.get(id) || []), row]);
            }
        }
        if (hosts.size > 1 || windows.size > 1) issues.push({ code: 'ENVIRONMENT_CONFLICT', message: '跨事件来源环境或时间窗口不一致，禁止混合比较' });
        for (const group of groups.values()) {
            const all = [];
            for (const id of rule.eventIds) {
                const rows = group.get(id) || [];
                const count = rule.counts?.[id];
                if (!rows.length) issues.push({ code: 'NOT_FOUND', message: `${id} 关联组内事件尚未到齐` });
                else if (count && (rows.length < count.min || count.max !== undefined && rows.length > count.max)) issues.push({ code: 'COUNT_MISMATCH', message: `${id} 在关联组内缺失或次数不符合要求` });
                if (!count && rows.length > 1) issues.push({ code: 'CORRELATION_AMBIGUOUS', message: `${id} 同一关联键有多条记录，需求未声明次数，不能唯一关联` });
                if (rows.some(row => all.includes(row))) issues.push({ code: 'CORRELATION_AMBIGUOUS', message: '同一候选记录命中多个参与事件，请收紧 match' });
                all.push(...rows);
            }
            for (const key of rule.equalProperties) {
                if (all.some(row => property(row, key) === undefined || property(row, key) === null || property(row, key) === '')
                    || all.some(row => !isDeepStrictEqual(property(row, key), property(all[0], key)))) issues.push({ code: 'CROSS_EVENT_MISMATCH', message: `关联字段 ${key} 缺失或不一致` });
            }
        }
        return { id: rule.id, eventIds: rule.eventIds, status: !issues.length ? 'PASS' : issues.every(issue => issue.code === 'NOT_FOUND') ? 'NOT_FOUND' : 'CONTRACT_MISMATCH', groupCount: groups.size, issues };
    });
}
