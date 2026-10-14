// Pure decisions: never operate a browser or mutate application files here.
export function nextWorkflowAction({ mode = 'full-lifecycle', phase = 'implementation', risk = 'low', loginRequired = false, loginVerified = false, loginAcknowledged = false, failure = '', repairRounds = 0, stagnantRounds = 0 } = {}) {
    if (!['full-lifecycle', 'instrument', 'generate-method', 'discover', 'contract', 'verify-source', 'verify-runtime', 'verify-data', 'browser-verify'].includes(mode)) {
        return { action: 'clarify', message: '工作范围尚未确定，请明确本次任务' };
    }
    const mayRepair = ['full-lifecycle', 'instrument', 'generate-method'].includes(mode);
    if (risk === 'high') return { action: 'stop-business', message: '存在重大业务影响，先修复或提交影响报告，暂停业务触发' };
    if (failure) {
        if (['query', 'permission', 'truncated', 'service'].includes(failure)) return { action: 'resolve-condition', message: '外部验收条件未满足，保留已完成证据，不据此修改埋点代码' };
        if (failure === 'code') {
            if (!mayRepair) return { action: 'report', message: '发现实现差异，本次只读检查不修改代码' };
            if (repairRounds >= 3 || stagnantRounds >= 2) return { action: 'stop-repair', message: '修复已达到停止条件，报告具体原因、证据和恢复路径' };
            return { action: 'repair', restartAt: 'business-impact', newTriggerWindow: true, message: '修复后重审业务影响、更新文档并使用新窗口验收' };
        }
        if (failure === 'not-found') return { action: 'bounded-query-retry', message: '核对环境与关联，按有限重查规则处理，不重复浏览器操作' };
        if (failure !== 'login') return { action: 'diagnose', message: '先区分定位、业务和实现问题，不能盲目重试' };
    }
    if (phase === 'browser' && loginRequired && !loginVerified) return loginAcknowledged
        ? { action: 'check-login', message: '重新检查选定会话的可见登录状态，确认后继续' }
        : { action: 'wait-login', message: '请在选定的同一浏览器会话登录并回复“已登录”，确认后继续' };
    if (['instrument', 'generate-method'].includes(mode) && phase === 'source-complete') return { action: 'deliver', message: '本次代码与文档检查完成，不追加浏览器或平台查询' };
    if (mode === 'full-lifecycle' && phase === 'source-complete') return { action: 'browser', message: '进入浏览器触发与平台验收' };
    return { action: 'continue', message: '继续本次范围内的下一阶段' };
}
