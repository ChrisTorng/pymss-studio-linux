import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { appendWorkflowNodeLogs } from '../src/workflows/nodeLogs.ts'

const source = ts.createSourceFile('task.ts', readFileSync(new URL('../src/stores/task.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const names = new Set(['normalizeStatus', 'clamp', 'resolveStageProgress', 'handleWorkerEvent'])
const selected = []
function collect(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) selected.push(node.getText(source))
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(source) === 'STAGE_META')) selected.push(node.getText(source))
  ts.forEachChild(node, collect)
}
collect(source)
assert.equal(selected.length, names.size + 1)
const code = ts.transpileModule(selected.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function setup() {
  const task = { id: 'workflow', status: 'separating', progress: 35, createdAt: 1, logs: [], runConfig: {} }
  const terminal = ['done', 'failed', 'cancelled']
  const handle = vm.runInNewContext(`${code}\nhandleWorkerEvent`, {
    tasks: { value: [task] },
    TERMINAL_STATUSES: terminal,
    isTerminalTaskStatus: status => terminal.includes(status),
    markTaskStarted: () => {}, touch: () => {}, queueProgressPersist: () => {},
    appendWorkflowNodeLogs, useSettingsStore: () => ({ developerMode: false }),
    appendTaskLogs: (target, lines) => target.logs.push(...(Array.isArray(lines) ? lines : [lines])),
    normalizeStemOutputs: () => [], resolveTaskErrorMessage: (_code, message) => message,
    markTaskFinished: () => {}, queuePersist: () => {},
    scheduleQueue: () => {},
  })
  return {
    task,
    progress: payload => handle({ type: 'task_progress', taskId: task.id, payload: { stage: 'separating', ...payload } }),
    event: (type, payload) => handle({ type, taskId: task.id, payload }),
  }
}

test('workflow percentage uses overall progress while audio time stays local to the node', () => {
  const { task, progress } = setup()
  progress({ done: 192, total: 192, progress: 44, message: 'node=41 Processing audio' })
  assert.equal(task.progress, 44)
  progress({ progress: 44, message: 'node=42 type=pymss_mss_separate' })
  assert.equal(task.progress, 44)
  assert.equal(task.progressCurrent, undefined)
  assert.equal(task.progressTotal, undefined)
  progress({ done: 0, total: 192, progress: 44, message: 'node=42 Processing audio' })
  assert.equal(task.progress, 44)
  assert.equal(task.progressCurrent, 0)
  assert.equal(task.progressTotal, 192)
})

test('single-model events retain audio percentage and reject invalid explicit percentages', () => {
  const { task, progress } = setup()
  for (const explicit of [undefined, null, '60', NaN, Infinity]) {
    progress({ done: 25, total: 100, progress: explicit })
    assert.equal(task.progress, 25)
  }
  progress({ done: 0, total: 100, progress: 120 })
  assert.equal(task.progress, 99)
  progress({ done: 0, total: 100, progress: -2 })
  assert.equal(task.progress, 0)
})

test('late workflow progress cannot resurrect a cancelled task', () => {
  const { task, progress } = setup()
  task.status = 'cancelled'
  task.progress = 100
  progress({ done: 0, total: 192, progress: 44 })
  assert.equal(task.status, 'cancelled')
  assert.equal(task.progress, 100)
})

test('only explicit node ids route logs, even while another node is active', () => {
  const { task, progress, event } = setup()
  progress({ nodeId: 'first', nodeProgress: 0, message: 'Loading audio' })
  progress({ nodeId: 'first', nodeProgress: .2, message: 'Loading audio' })
  assert.equal(task.nodeLogs.first.length, 1)
  event('task_log', { message: 'Unattributed stderr', level: 'warning' })
  assert.equal(task.nodeLogs.first.length, 1)
  assert.equal(task.logs[0], 'warning: Unattributed stderr')
  event('task_log', { nodeId: 'second', message: 'Model log', level: 'info' })
  assert.deepEqual(task.nodeLogs.second, ['info: Model log'])
})

test('failed nodes retain their progress, diagnostics and tracebacks', () => {
  const { task, progress, event } = setup()
  progress({ nodeId: 'first', nodeProgress: .4, message: 'Processing audio' })
  event('error', { message: 'Model failed', detail: 'Traceback:\n  File "model.py", line 1\nValueError: invalid' })
  assert.equal(task.nodeStates.first.status, 'failed')
  assert.equal(task.nodeStates.first.progress, 40)
  assert.ok(task.nodeLogs.first.some(line => line.includes('ValueError: invalid')))
})

test('node cancellation is recorded and late progress cannot overwrite it', () => {
  const { task, progress, event } = setup()
  progress({ nodeId: 'first', nodeProgress: .4, message: 'Processing audio' })
  event('task_cancelled', { message: 'Cancelled by user' })
  progress({ nodeId: 'first', nodeProgress: 1, message: 'Completed' })
  assert.equal(task.nodeStates.first.status, 'cancelled')
  assert.equal(task.nodeLogs.first.at(-1), '[info] Cancelled by user')
})

test('finishing audio does not complete a node before its output handling returns', () => {
  const { task, progress, event } = setup()
  progress({ nodeId: 'first', nodeProgress: 1, audioIndex: 1, audioCount: 1, unit: 'seconds', message: 'Audio processed' })
  assert.equal(task.nodeStates.first.status, 'running')
  assert.equal(task.currentNodeId, 'first')
  event('error', { message: 'Missing output stem' })
  assert.equal(task.nodeStates.first.status, 'failed')
  assert.ok(task.nodeLogs.first.some(line => line.includes('Missing output stem')))
})
