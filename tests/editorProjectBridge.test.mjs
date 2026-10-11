import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.createSourceFile('bridge.ts', readFileSync(new URL('../src/composables/useEditorProjectBridge.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const declaration = source.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === 'useEditorProjectBridge')
const code = ts.transpileModule(declaration.getText(source).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function environment() {
  let mounted, unmount, projectEvent
  const calls = []
  const errors = []
  const editor = {
    session: null,
    async loadProject(id) { calls.push(['load', id]); editor.session = { id, volume: 1 } },
    async saveProject() { calls.push(['save', editor.session.id, editor.session.volume]) },
  }
  let dropSubscribe = async () => () => calls.push(['remove-drop'])
  let projectSubscribe = async callback => { projectEvent = callback; return () => calls.push(['remove-project']) }
  const context = {
    ref: value => ({ value }),
    watch() {},
    onMounted: callback => { mounted = callback },
    onBeforeUnmount: callback => { unmount = callback },
    getCurrentWebview: () => ({ onDragDropEvent: callback => dropSubscribe(callback) }),
    listen: (_event, callback) => projectSubscribe(callback),
  }
  const create = vm.runInNewContext(`${code}\nuseEditorProjectBridge`, context)
  const bridge = create({ routeProjectId: { value: '' }, hasTauriApis: true, editor, assetPanelEl: { value: null }, message: { error: value => errors.push(value) }, t: value => value })
  return { bridge, editor, calls, errors, mount: () => mounted(), unmount: () => unmount(),
    event: id => projectEvent({ payload: { projectId: id } }),
    setDrop: callback => { dropSubscribe = callback }, setProject: callback => { projectSubscribe = callback } }
}

test('reopening the current audio project preserves edits and pending autosave', async () => {
  const env = environment()
  await env.mount()
  await env.bridge.loadProject('project')
  env.editor.session.volume = 0.25
  env.event('project')
  await env.bridge.loadProject('project')
  assert.equal(env.editor.session.volume, 0.25)
  assert.deepEqual(env.calls, [['load', 'project']])
  env.unmount()
})

test('queued duplicate opens load once and switching projects saves the current draft first', async () => {
  const env = environment()
  await Promise.all([env.bridge.loadProject('first'), env.bridge.loadProject('first')])
  env.editor.session.volume = 0.3
  await env.bridge.loadProject('second')
  assert.deepEqual(env.calls, [['load', 'first'], ['save', 'first', 0.3], ['load', 'second']])
})

test('a failed save prevents switching projects and a later request can retry', async () => {
  const env = environment()
  await env.bridge.loadProject('first')
  env.editor.saveProject = async () => { throw new Error('disk full') }
  await assert.rejects(env.bridge.loadProject('second'), /disk full/)
  assert.equal(env.editor.session.id, 'first')
  env.editor.saveProject = async () => {}
  await env.bridge.loadProject('second')
  assert.equal(env.editor.session.id, 'second')
})

test('an asynchronous drop subscription is removed when the view closes before it resolves', async () => {
  const env = environment()
  const waiting = deferred()
  env.setDrop(() => waiting.promise)
  const mounting = env.mount()
  env.unmount()
  waiting.resolve(() => env.calls.push(['late-drop-removed']))
  await mounting
  await env.bridge.loadProject('project')
  assert.deepEqual(env.calls, [['late-drop-removed']])
})

test('an asynchronous project subscription is removed when the view closes before it resolves', async () => {
  const env = environment()
  const waiting = deferred()
  env.setProject(() => waiting.promise)
  const mounting = env.mount()
  await new Promise(resolve => setImmediate(resolve))
  env.unmount()
  waiting.resolve(() => env.calls.push(['late-project-removed']))
  await mounting
  assert.deepEqual(env.calls, [['remove-drop'], ['late-project-removed']])
})
