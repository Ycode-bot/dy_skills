import path from 'node:path';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { issueDetails } from './reporting.mjs';

const UNKNOWN = Symbol('unknown');
function loadParsers(root) {
    const require = createRequire(path.join(path.resolve(root || process.cwd()), 'package.json'));
    try {
        const ts = require('typescript');
        let vue;
        try { vue = require('vue/compiler-sfc'); } catch { /* TS projects need no Vue parser. */ }
        return { ts, vue };
    } catch { return {}; }
}
function walk(ts, node, callback) { callback(node); ts.forEachChild(node, child => walk(ts, child, callback)); }
function normalize(file) { return path.posix.normalize(file.replaceAll('\\', '/')); }

export function analyzeTarget(expected, sources, root = '', options = {}) {
    const { ts, vue } = options.parsers || loadParsers(root);
    const checks = [];
    const issues = [];
    const add = (code, message, location, nextStep) => issues.push(issueDetails({ code, message, location, nextStep }, {
        attempted: '已关联目标方法、传输参数及调用表达式',
    }));
    const finish = status => ({ ...expected, status, scope: options.scope || 'integration', checks, issues });
    if (!ts) {
        add('PARSER_UNAVAILABLE', '项目现有依赖中没有可用的 TypeScript 解析器，不能进行可靠语法检查', root || '项目根目录', '由 Agent 读取目标方法和调用点补充证据；不擅自安装依赖');
        return finish('NEEDS_REVIEW');
    }
    if (!expected.wrapper) {
        add('WRAPPER_UNDECLARED', '契约未指定业务方法，无法关联目标实现', '事件契约', '确认本事件的方法名称并补入契约');
        return finish('NEEDS_REVIEW');
    }
    const modules = new Map();
    const templateBindings = new WeakMap();
    for (const source of sources) {
        if (/\.(json|md|yaml|yml)$/.test(source.path)) continue;
        let text = source.text;
        let template = '';
        let offset = 0;
        if (source.path.endsWith('.vue')) {
            if (!vue) {
                if (source.text.includes(expected.wrapper)) add('VUE_PARSER_UNAVAILABLE', '无法解析 Vue 单文件组件', source.path, '读取组件脚本和模板补查实际调用');
                continue;
            }
            const parsed = vue.parse(text);
            if (parsed.errors.length) {
                if (source.text.includes(expected.wrapper)) add('SOURCE_PARSE_ERROR', 'Vue 文件存在语法问题，无法完整检查', source.path, '修复或确认该文件语法问题');
                continue;
            }
            const block = parsed.descriptor.scriptSetup || parsed.descriptor.script;
            text = block?.content || '';
            offset = block ? block.loc.start.line - 1 : 0;
            // Both script blocks need review rather than silently ignoring one.
            if (source.text.includes(expected.wrapper) && parsed.descriptor.scriptSetup && parsed.descriptor.script) add('DUAL_SCRIPT', '组件同时包含两种脚本，需补查普通脚本与 setup 的关联', source.path, '检查两个脚本块的导出与调用');
            template = parsed.descriptor.template?.content || '';
        }
        const ast = ts.createSourceFile(source.path, text, ts.ScriptTarget.Latest, true, source.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const module = { path: normalize(source.path), ast, imports: new Map(), exports: new Map(), definitions: new Map(), calls: [], offset, template };
        modules.set(module.path, module);
        for (const statement of ast.statements) {
            if (ts.isImportDeclaration(statement) && statement.importClause && ts.isStringLiteral(statement.moduleSpecifier)) {
                const clause = statement.importClause;
                if (clause.isTypeOnly) continue;
                if (clause.name) module.imports.set(clause.name.text, { from: statement.moduleSpecifier.text, name: 'default' });
                if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
                    for (const item of clause.namedBindings.elements) if (!item.isTypeOnly) module.imports.set(item.name.text, { from: statement.moduleSpecifier.text, name: item.propertyName?.text || item.name.text });
                }
                if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) module.imports.set(clause.namedBindings.name.text, { from: statement.moduleSpecifier.text, name: '*' });
            }
            if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
                for (const item of statement.exportClause.elements) module.exports.set(item.name.text, { from: statement.moduleSpecifier?.text, name: item.propertyName?.text || item.name.text });
            }
        }
        for (const statement of ast.statements) {
            if (ts.isFunctionDeclaration(statement) && statement.name && statement.modifiers?.some(item => item.kind === ts.SyntaxKind.DefaultKeyword)) {
                module.exports.set('default', { name: statement.name.text });
            }
            if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) {
                module.exports.set('default', { name: statement.expression.text });
            }
        }
        walk(ts, ast, node => {
            if (ts.isFunctionDeclaration(node) && node.parent === ast && node.name && node.body) module.definitions.set(node.name.text, node);
            if (ts.isVariableDeclaration(node) && node.parent?.parent?.parent === ast && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) module.definitions.set(node.name.text, node.initializer);
            if (ts.isCallExpression(node)) module.calls.push(node);
        });
        if (template && vue) {
            try {
                const parsedTemplate = vue.parse(`<template>${template}</template>`);
                const templateAst = { errors: parsedTemplate.errors, ast: parsedTemplate.descriptor.template.ast };
                if (templateAst.errors.length) throw new Error('template');
                // Parse only event handler expressions from the template AST, never arbitrary text/attributes.
                const visitTemplate = (node, inherited = []) => {
                    const bindings = [...inherited];
                    for (const prop of node.props || []) {
                        if (prop.type !== 7) continue;
                        let names = [];
                        if (prop.name === 'for') {
                            if (!prop.forParseResult) throw new Error('无法解析循环作用域');
                            names = ['value', 'key', 'index'].map(key => prop.forParseResult[key]?.content).filter(Boolean);
                        } else if (prop.name === 'slot' && prop.exp?.content) names = [prop.exp.content];
                        for (const name of names) {
                            const bindingAst = ts.createSourceFile('binding.ts', `function scope(${name}) {}`, ts.ScriptTarget.Latest, true);
                            if (bindingAst.parseDiagnostics.length) throw new Error('无法解析模板绑定');
                            bindings.push(...bindingAst.statements[0].parameters.map(parameter => parameter.name));
                        }
                    }
                    for (const prop of node.props || []) {
                        if (prop.type === 7 && prop.name === 'on' && prop.exp?.content) {
                            const expression = prop.exp.content;
                            const handlerAst = ts.createSourceFile('handler.ts', /^[A-Za-z_$][\w$]*$/.test(expression) ? `${expression}()` : expression, ts.ScriptTarget.Latest, true);
                            walk(ts, handlerAst, item => { if (ts.isCallExpression(item)) { templateBindings.set(item, bindings); module.calls.push(item); } });
                        }
                    }
                    for (const child of node.children || []) visitTemplate(child, bindings);
                };
                visitTemplate(templateAst.ast);
            } catch { add('TEMPLATE_PARSE_ERROR', '模板事件绑定无法完整解析', source.path, '补查模板事件处理方法'); }
        }
    }
    const locate = (module, node) => `${module.path}:${node.getSourceFile() === module.ast ? module.ast.getLineAndCharacterOfPosition(node.getStart()).line + 1 + module.offset : '模板事件'}`;
    let compilerOptions = {};
    if (root) {
        const config = ts.findConfigFile(path.resolve(root), ts.sys.fileExists);
        if (config) {
            const loaded = ts.readConfigFile(config, ts.sys.readFile);
            if (!loaded.error) compilerOptions = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(config)).options;
        }
    }
    function resolveModule(module, specifier) {
        let candidate = specifier.startsWith('.') ? path.posix.join(path.posix.dirname(module.path), specifier)
            : /^[@~]\//.test(specifier) ? specifier.slice(2) : specifier;
        candidate = normalize(candidate);
        for (const name of [candidate, ...['.ts', '.tsx', '.js', '.vue', '/index.ts', '/index.js', '.d.ts', '.mjs'].map(ext => candidate + ext)]) if (modules.has(name)) return modules.get(name);
        if (root) {
            const resolved = ts.resolveModuleName(specifier, path.resolve(root, module.path), compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
            if (resolved) return modules.get(normalize(path.relative(root, resolved)));
        }
        return null;
    }
    function resolveSymbol(module, name, visited = new Set()) {
        const key = `${module.path}:${name}`;
        if (visited.has(key)) return null;
        visited.add(key);
        if (module.definitions.has(name)) return { module, node: module.definitions.get(name) };
        const entry = module.imports.get(name) || module.exports.get(name);
        if (entry) {
            const target = entry.from ? resolveModule(module, entry.from) : module;
            if (target) return resolveSymbol(target, entry.name, visited);
        }
        // Nuxt's generated exports are authoritative for auto-imports.
        for (const generated of ['.nuxt/imports.d.ts', '.nuxt/imports.mjs']) {
            const auto = modules.get(generated);
            if (auto?.exports.has(name)) return resolveSymbol(auto, name, visited);
        }
        return null;
    }
    const definitions = [...modules.values()].flatMap(module => module.definitions.has(expected.wrapper) ? [{ module, node: module.definitions.get(expected.wrapper) }] : []);
    if (definitions.length !== 1) {
        add(definitions.length ? 'AMBIGUOUS_WRAPPER' : 'MISSING_IMPLEMENTATION', definitions.length ? `找到多个同名方法 ${expected.wrapper}，不能确定目标` : `未找到方法 ${expected.wrapper} 的函数实现`, definitions.map(x => locate(x.module, x.node)).join('、') || '目标源码', '确认目标方法定义位置及导出关系');
        return finish(definitions.length ? 'NEEDS_REVIEW' : 'MISSING_IMPLEMENTATION');
    }
    const target = definitions[0];
    checks.push({ kind: 'wrapper', name: expected.wrapper, found: true, files: [locate(target.module, target.node)] });
    if (target.module.ast.parseDiagnostics.length) {
        add('SOURCE_PARSE_ERROR', '目标方法所在文件存在语法错误', locate(target.module, target.node), '先修复语法错误');
        return finish('NEEDS_REVIEW');
    }
    function binds(name, binding) {
        if (!binding) return false;
        if (ts.isIdentifier(binding)) return binding.text === name;
        return binding.elements?.some(item => !ts.isOmittedExpression(item) && binds(name, item.name)) || false;
    }
    function locallyBound(call, name, module) {
        if (templateBindings.get(call)?.some(binding => binds(name, binding))) return true;
        for (let scope = call.parent; scope && scope !== module.ast; scope = scope.parent) {
            if (scope.parameters?.some(item => binds(name, item.name))) return true;
            if (ts.isFunctionExpression(scope) && binds(name, scope.name)) return true;
            if (ts.isCatchClause(scope) && binds(name, scope.variableDeclaration?.name)) return true;
            let found = false;
            const scan = node => {
                if (node !== scope && ts.isFunctionLike(node)) {
                    if (ts.isFunctionDeclaration(node) && binds(name, node.name)) found = true;
                    return;
                }
                if (node !== scope && (ts.isBlock(node) || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node))) return;
                if ((ts.isVariableDeclaration(node) || ts.isClassDeclaration(node)) && binds(name, node.name)) found = true;
                ts.forEachChild(node, scan);
            };
            scan(scope);
            // var declarations belong to the entire function, including nested blocks.
            if (ts.isFunctionLike(scope)) {
                const scanVar = node => {
                    if (node !== scope && ts.isFunctionLike(node)) return;
                    if (ts.isVariableDeclarationList(node) && !(node.flags & ts.NodeFlags.BlockScoped)
                        && node.declarations.some(item => binds(name, item.name))) found = true;
                    ts.forEachChild(node, scanVar);
                };
                scanVar(scope);
            }
            if (found) return true;
        }
        return false;
    }
    const callers = [];
    const unresolved = [];
    for (const module of modules.values()) for (const call of module.calls) {
        let symbol;
        if (ts.isIdentifier(call.expression)) {
            if (!locallyBound(call, call.expression.text, module)) symbol = resolveSymbol(module, call.expression.text);
        }
        else if (ts.isPropertyAccessExpression(call.expression) && ts.isIdentifier(call.expression.expression)) {
            const entry = !locallyBound(call, call.expression.expression.text, module) && module.imports.get(call.expression.expression.text);
            const owner = entry?.name === '*' ? resolveModule(module, entry.from) : null;
            if (owner) symbol = resolveSymbol(owner, call.expression.name.text);
        }
        if (symbol?.node === target.node && !(module === target.module && call.pos >= target.node.pos && call.end <= target.node.end)) callers.push(locate(module, call));
        else if (call.expression.getText() === expected.wrapper && !symbol) unresolved.push(locate(module, call));
    }
    checks.push({ kind: 'call', found: callers.length > 0, files: callers });
    if ((options.scope || 'integration') !== 'method' && !callers.length) {
        add(unresolved.length ? 'CALL_BINDING_UNRESOLVED' : 'WRAPPER_NOT_CALLED', unresolved.length ? '发现同名调用但无法确认导入关系，可能需要补查自动导入或别名' : '未找到目标方法的实际调用表达式', unresolved.join('、') || locate(target.module, target.node), '检查业务触发所有者、导入及 Nuxt 自动导入配置');
    }
    function evaluate(node, module, seen = new Set()) {
        if (!node) return UNKNOWN;
        if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return evaluate(node.expression, module, seen);
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
        if (ts.isNumericLiteral(node)) return Number(node.text);
        if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
        if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
        if (node.kind === ts.SyntaxKind.NullKeyword) return null;
        if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
        if (ts.isObjectLiteralExpression(node)) {
            const object = {};
            for (const prop of node.properties) {
                if (ts.isSpreadAssignment(prop)) return UNKNOWN;
                const name = prop.name?.text;
                if (!name) return UNKNOWN;
                object[name] = ts.isPropertyAssignment(prop) ? evaluate(prop.initializer, module, new Set(seen)) : UNKNOWN;
            }
            return object;
        }
        if (ts.isArrayLiteralExpression(node)) return node.elements.map(value => evaluate(value, module, new Set(seen)));
        if (ts.isIdentifier(node) && !seen.has(node.text)) {
            if (locallyBound(node, node.text, module)) return UNKNOWN;
            seen.add(node.text);
            // Only immutable module-level constants. Function parameters/local mutable values need review.
            for (const statement of module.ast.statements) if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const)) {
                const declaration = statement.declarationList.declarations.find(item => item.name.getText() === node.text);
                if (declaration?.initializer) {
                    const value = evaluate(declaration.initializer, module, seen);
                    // const protects the binding, not objects/arrays or their aliases.
                    if (value !== null && typeof value === 'object') {
                        add('MUTABLE_CONSTANT', `常量 ${node.text} 引用对象或数组，无法排除属性修改、别名写入或传参后的变化`, locate(module, declaration), '检查所有写入和引用路径，补充运行时字段证据');
                        return UNKNOWN;
                    }
                    return value;
                }
            }
        }
        return UNKNOWN;
    }
    function transportPlatform(call, module, visited = new Set()) {
        const expression = call.expression;
        const receiver = ts.isPropertyAccessExpression(expression) ? expression.expression : expression;
        if (!ts.isIdentifier(receiver) || locallyBound(call, receiver.text, module)) return null;
        const name = receiver.text;
        const entry = module.imports.get(name);
        const packages = {
            '@joyme/sensors-data': 'sensors', 'sa-sdk-javascript': 'sensors',
            'sensorsdata-javascript-sdk': 'sensors', 'mixpanel-browser': 'mixpanel',
            '@amplitude/analytics-browser': 'amplitude', 'amplitude-js': 'amplitude',
            'posthog-js': 'posthog', '@segment/analytics-next': 'segment',
        };
        if (entry && packages[entry.from]) return packages[entry.from];
        // Trace project transport helpers; a familiar receiver name alone is not SDK evidence.
        if (ts.isIdentifier(expression)) {
            const symbol = resolveSymbol(module, name);
            if (symbol && !visited.has(symbol.node)) {
                visited.add(symbol.node);
                const body = symbol.node.body;
                const statements = body && ts.isBlock(body) ? body.statements : [];
                const statement = statements.length === 1 ? statements[0] : null;
                const forwarded = statement && (ts.isExpressionStatement(statement) || ts.isReturnStatement(statement))
                    ? statement.expression : body && ts.isCallExpression(body) ? body : null;
                const parameters = symbol.node.parameters;
                const transparent = forwarded && ts.isCallExpression(forwarded)
                    && parameters.length === 2
                    && parameters.every(parameter => ts.isIdentifier(parameter.name) && !parameter.initializer && !parameter.dotDotDotToken)
                    && forwarded.arguments.length === 2
                    && forwarded.arguments.every((argument, index) => ts.isIdentifier(argument) && argument.text === parameters[index].name.text);
                if (!transparent) {
                    add('TRANSPORT_ARGUMENTS_UNRESOLVED', '传输封装并非可确认的事件与字段原样透传，可能修改参数或改变发送条件', locate(symbol.module, symbol.node), '追踪最终 SDK 的事件名、字段和执行条件，补充实际发送证据');
                    return null;
                }
                return transportPlatform(forwarded, symbol.module, visited);
            }
        }
        return null;
    }
    function checkTransport(node) {
        const platform = transportPlatform(node, target.module);
        if (!platform) {
            add('TRANSPORT_BINDING_UNRESOLVED', '传输对象来源未确认，可能是局部同名方法、全局对象或间接封装，不能据此证明 SDK 上报', locate(target.module, node), '追踪对象的导入、初始化和作用域，记录实际 SDK 与目标平台的证据');
        } else if (platform !== expected.platform) {
            add('TRANSPORT_PLATFORM_MISMATCH', `实际传输平台 ${platform} 与要求的 ${expected.platform} 不一致`, locate(target.module, node), '核对并实现本事件要求的平台，不能使用其他平台的上报替代');
        }
    }
    const sends = [];
    let controlFlowUnresolved = false;
    walk(ts, target.node.body, node => {
        if (ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isConditionalExpression(node) || ts.isReturnStatement(node) || ts.isThrowStatement(node) || ts.isIterationStatement(node, false)) controlFlowUnresolved = true;
    });
    if (controlFlowUnresolved) add('CONTROL_FLOW_REVIEW', '方法包含分支、提前退出或循环，需确认传输是否在正确条件下执行', locate(target.module, target.node), '逐条检查成功、失败、匿名及重复路径，补充针对性测试');
    const visitBody = node => {
        if (node !== target.node && (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))) return;
        if (ts.isCallExpression(node)) {
            const name = node.expression.getText();
            if (/(?:^|\.)(track|capture)$/.test(name)) {
                const event = evaluate(node.arguments[0], target.module);
                if (event === expected.event || event === UNKNOWN) {
                    checkTransport(node);
                    sends.push({ event, payload: evaluate(node.arguments[1], target.module), node });
                }
            } else if (/\.push$/.test(name) && /dataLayer/.test(name)) {
                const payload = evaluate(node.arguments[0], target.module);
                if (payload === UNKNOWN || payload.event === expected.event) {
                    checkTransport(node);
                    sends.push({ event: payload === UNKNOWN ? UNKNOWN : payload.event, payload, node });
                }
            } else if (name === 'gtag' && evaluate(node.arguments[0], target.module) === 'event') {
                const event = evaluate(node.arguments[1], target.module);
                if (event === expected.event || event === UNKNOWN) {
                    checkTransport(node);
                    sends.push({ event, payload: evaluate(node.arguments[2], target.module), node });
                }
            }
        }
        ts.forEachChild(node, visitBody);
    };
    visitBody(target.node);
    let mismatch = false;
    if (!sends.length) add('TRANSPORT_UNRESOLVED', '目标方法内未找到匹配事件的直接传输调用，需确认间接封装或缺失实现', locate(target.module, target.node), '继续追踪该方法调用的传输封装，确认事件和 payload 来源');
    for (const send of sends) {
        checks.push({ kind: 'transport', name: expected.event, files: [locate(target.module, send.node)] });
        if (send.event === UNKNOWN || send.payload === UNKNOWN) {
            add('DYNAMIC_PAYLOAD', '事件名或 payload 来自动态参数、展开或间接数据，静态检查未能证明完整取值', locate(target.module, send.node), '追踪调用实参、类型、公共字段及运行时证据');
            continue;
        }
        for (const [name, rule] of Object.entries(expected.properties || {})) {
            const value = send.payload?.[name];
            if (value === UNKNOWN) {
                add('DYNAMIC_PROPERTY', `字段 ${name} 的值需要追踪运行时来源`, locate(target.module, send.node), '核对赋值路径、类型和相关测试');
                continue;
            }
            if (value === undefined && rule.required === false) continue;
            const typeMatches = !rule.type || (rule.type === 'integer' ? Number.isInteger(value) : rule.type === 'array' ? Array.isArray(value) : rule.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : typeof value === rule.type);
            if (value === undefined || !typeMatches || ('equals' in rule && !isDeepStrictEqual(value, rule.equals)) || (rule.oneOf && !rule.oneOf.some(v => isDeepStrictEqual(v, value))) || (rule.pattern && typeof value === 'string' && !new RegExp(rule.pattern).test(value))) {
                mismatch = true;
                add('PROPERTY_MISMATCH', `目标 payload 的字段 ${name} 缺失或不满足类型/取值要求`, locate(target.module, send.node), '修正字段来源或取值；若由公共传输注入，补查并记录该路径');
            }
        }
        for (const [name, value] of Object.entries(expected.match || {})) {
            if (send.payload?.[name] === UNKNOWN) {
                add('DYNAMIC_MATCH', `关联字段 ${name} 来自动态值，尚未证明与本次业务动作一致`, locate(target.module, send.node), '追踪实际调用参数或采集运行时值');
                continue;
            }
            if (!isDeepStrictEqual(send.payload?.[name], value)) {
                mismatch = true;
                add('MATCH_MISMATCH', `目标 payload 的关联字段 ${name} 与本次要求不一致`, locate(target.module, send.node), '核对关联字段及公共上下文来源');
            }
        }
    }
    if (mismatch || issues.some(issue => issue.code === 'TRANSPORT_PLATFORM_MISMATCH')) return finish('CONTRACT_MISMATCH');
    if (issues.some(issue => issue.code === 'WRAPPER_NOT_CALLED')) return finish('UNREACHABLE');
    return finish(issues.length ? 'NEEDS_REVIEW' : 'PASS');
}
