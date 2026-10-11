import assert from 'node:assert/strict'
import test, { after, afterEach } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'
import { createServer } from 'vite'

const vite = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  plugins: [{
    name: 'stub-output-directory-store-environment',
    enforce: 'pre',
    transform(_code, id) {
      const path = id.replaceAll('\\', '/')
      if (path.endsWith('/src/stores/settings.ts')) {
        return `
          import { reactive } from 'vue'
          export const settings = reactive({
            maxConcurrentSeparations: 1,
            outputDir: 'D:/DefaultOutput', downloadSource: 'modelscope', downloadMethod: 'aria2c',
            defaultFormat: 'wav', developerMode: false,
            getRuntimeDeviceConfig: () => ({ device: 'cpu', deviceIds: [] }),
            getAudioParams: () => ({}),
          })
          export function useSettingsStore() { return settings }
        `
      }
      if (path.endsWith('/src/i18n/index.ts')) return 'export default { global: { t: key => key } }'
      return null
    },
  }],
})

after(() => vite.close())
const { settings } = await vite.ssrLoadModule('/src/stores/settings.ts')
const { useTaskStore } = await vite.ssrLoadModule('/src/stores/task.ts')
const { useModelStore } = await vite.ssrLoadModule('/src/stores/model.ts')
const { useAppStore } = await vite.ssrLoadModule('/src/stores/app.ts')
const stores = []
const waitForSave = () => new Promise(resolve => setTimeout(resolve, 180))

afterEach(async () => {
  await waitForSave()
  for (const store of stores.splice(0)) store.$dispose()
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'localStorage')
  settings.outputDir = 'D:/DefaultOutput'
})

function storage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [
    `pymss-studio:${key}`, JSON.stringify(value),
  ]))
  globalThis.window = {}
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  return values
}

async function newStore(platform = 'win32') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const task = useTaskStore(pinia)
  const model = useModelStore(pinia)
  const app = useAppStore(pinia)
  app.envInfo = { platform }
  stores.push(task, model, app)
  await Promise.all([task.initialize(), model.initialize()])
  model.selectedModel = 'model-a'
  task.addInputFiles(['D:/Audio/song.wav'])
  return task
}

const workflow = {
  id: 'workflow-a', name: 'Workflow',
  definition: { version: 1, steps: [{ id: 'split', model: 'model-a', input: 'input', stems: ['vocals'], save: { vocals: 'vocals' } }] },
}

test('the initial separation directory follows Settings until a custom directory is entered', async () => {
  storage()
  const task = await newStore()
  assert.equal(task.separateOutputDir, 'D:/DefaultOutput')
  assert.equal(task.separateTemporaryOutputDir, '')
  settings.outputDir = 'F:/NewDefault'
  assert.equal(task.separateOutputDir, 'F:/NewDefault')
  task.separateTemporaryOutputDir = ' E:/CustomOutput '
  assert.equal(task.separateOutputDir, 'E:/CustomOutput')
  assert.equal(settings.outputDir, 'F:/NewDefault')
})

test('a custom directory survives page reuse but resets to Settings on application restart', async () => {
  const values = storage()
  const task = await newStore()
  task.separateTemporaryOutputDir = 'E:/CustomOutput'
  assert.equal(useTaskStore(), task)
  assert.equal(useTaskStore().separateOutputDir, 'E:/CustomOutput')
  task.separateOutputLayout = 'folders'
  await waitForSave()
  assert.equal(Object.hasOwn(JSON.parse(values.get('pymss-studio:separate-state')), 'temporaryOutputDir'), false)
  settings.outputDir = 'F:/NewDefault'
  assert.equal((await newStore()).separateOutputDir, 'F:/NewDefault')
})

test('clearing a directory restores inheritance for the current session', async () => {
  storage()
  const task = await newStore()
  task.separateTemporaryOutputDir = 'E:/CustomOutput'
  task.separateTemporaryOutputDir = ''
  assert.equal(task.separateOutputDir, 'D:/DefaultOutput')
  settings.outputDir = 'F:/NewDefault'
  assert.equal(task.separateOutputDir, 'F:/NewDefault')
})

test('legacy persisted custom directories are ignored on startup', async () => {
  storage({ 'separate-state': { temporaryOutputDir: 'E:/LegacyOutput' } })
  const task = await newStore()
  assert.equal(task.separateTemporaryOutputDir, '')
  assert.equal(task.separateOutputDir, 'D:/DefaultOutput')
})

test('native graph submission and retry preserve graph parameters and the output root as one task', async () => {
  storage()
  const task = await newStore()
  const definition = {
    nodes: [
      { id: 1, type: 'pymss_load_audio_batch', widgets_values: ['D:/Music', true, false, ''] },
      { id: 2, type: 'pymss_save_audio', widgets_values: ['', 'stems', '44100'] },
    ], links: [[1, 1, 0, 2, 0, 'AUDIO']],
  }
  const saved = structuredClone(definition)
  const submitted = await task.startWorkbenchInference({ ...workflow, definition }, {
    inputs: { '1': { files: ['D:/Other/first.wav', 'D:/Other/second.wav'] } },
    outputs: { '2': 'E:/Ignored' }, primaryInput: '1', outputLayout: 'folders',
  })
  assert.equal(submitted.total, 1)
  const original = submitted.tasks[0]
  assert.equal(original.input, '')
  assert.equal(original.output, 'D:/DefaultOutput')
  assert.equal(original.runConfig.outputLayout, 'flat')
  assert.equal(original.runConfig.workbench.nativeGraph, true)
  assert.deepEqual(original.runConfig.workflowDefinition, saved)
  assert.deepEqual(original.runConfig.workbench.outputs, {})
  definition.nodes[0].widgets_values[0] = 'D:/Changed'
  assert.deepEqual(original.runConfig.workbench.sourceDefinition, saved)
  original.status = 'failed'
  settings.outputDir = 'F:/NextRun'
  const retried = await task.retryTask(original.id)
  assert.equal(retried.output, 'D:/DefaultOutput')
  assert.deepEqual(retried.runConfig, JSON.parse(JSON.stringify(original.runConfig)))
})

for (const mode of ['model', 'workflow']) {
  const submit = (task, options) => mode === 'model'
    ? task.startSeparation(options)
    : task.startWorkflowInference(workflow, options)

  test(`${mode} submission trims paths and treats whitespace as default inheritance`, async () => {
    storage()
    const task = await newStore()
    task.separateTemporaryOutputDir = '   '
    const inherited = await submit(task, { outputDir: '   ', outputLayout: 'flat' })
    assert.equal(inherited.tasks[0].output, 'D:/DefaultOutput')
    const custom = await submit(task, { outputDir: ' E:/CustomOutput ', outputLayout: 'folders' })
    assert.equal(custom.tasks[0].jobOutput, 'E:/CustomOutput')
    assert.equal(custom.tasks[0].output, 'E:/CustomOutput/song')
    settings.outputDir = 'F:/NewDefault'
    assert.equal(custom.tasks[0].jobOutput, 'E:/CustomOutput')
    assert.equal(inherited.tasks[0].jobOutput, 'D:/DefaultOutput')
  })

  for (const layout of ['flat', 'folders']) {
    test(`${mode} retry preserves the original ${layout} directory after Settings changes`, async () => {
      storage()
      const task = await newStore()
      const submitted = await submit(task, { outputDir: 'E:/CustomOutput', outputLayout: layout })
      const original = submitted.tasks[0]
      original.status = 'failed'
      settings.outputDir = 'F:/NewDefault'
      task.separateTemporaryOutputDir = 'G:/OtherOutput'
      const retried = await task.retryTask(original.id)
      assert.equal(retried.jobOutput, 'E:/CustomOutput')
      assert.equal(retried.output, original.output)
      assert.equal(retried.runConfig.outputLayout, layout)
    })
  }

  test(`${mode} retry recovers the root of legacy folder tasks without adding another input folder`, async () => {
    storage()
    const task = await newStore()
    const submitted = await submit(task, { outputDir: 'E:/', outputLayout: 'folders' })
    const original = submitted.tasks[0]
    delete original.jobOutput
    original.status = 'failed'
    const retried = await task.retryTask(original.id)
    assert.equal(retried.jobOutput, 'E:/')
    assert.equal(retried.output, 'E:/song')
  })

  test(`${mode} retry keeps a historical absolute folder path after restart`, async () => {
    storage()
    const task = await newStore()
    const submitted = await submit(task, { outputDir: 'delivery', outputLayout: 'folders' })
    const original = submitted.tasks[0]
    const savedDirectory = 'E:/OldWorkingDirectory/delivery/song'
    task.handleWorkerEvent({
      type: 'task_done', taskId: original.id,
      payload: { outputDir: savedDirectory, files: [], outputs: [] },
    })
    assert.equal(original.jobOutput, 'delivery')
    await waitForSave()

    settings.outputDir = 'F:/NewDefault'
    const restarted = await newStore()
    const retried = await restarted.retryTask(original.id)
    assert.equal(retried.jobOutput, 'E:/OldWorkingDirectory/delivery')
    assert.equal(retried.output, savedDirectory)
  })

  test(`${mode} retry keeps the physical output directory reported by the worker`, async () => {
    storage()
    const task = await newStore()
    const submitted = await submit(task, { outputDir: 'D:/OutputAlias', outputLayout: 'folders' })
    const original = submitted.tasks[0]
    task.handleWorkerEvent({
      type: 'task_done', taskId: original.id,
      payload: { outputRoot: 'E:/PhysicalOutput', outputDir: 'E:/PhysicalOutput/song', files: [], outputs: [] },
    })
    const retried = await task.retryTask(original.id)
    assert.equal(retried.jobOutput, 'E:/PhysicalOutput')
    assert.equal(retried.output, 'E:/PhysicalOutput/song')
  })

  test(`${mode} retry preserves filesystem roots in resolved worker paths`, async () => {
    storage()
    const separator = String.fromCharCode(92)
    const roots = [
      { platform: 'win32', root: 'E:/' },
      { platform: 'win32', root: `E:${separator}` },
      { platform: 'linux', root: '/' },
      { platform: 'win32', root: `${separator}${separator}server${separator}share` },
    ]
    for (const { platform, root } of roots) {
      const task = await newStore(platform)
      const joined = root.endsWith('/') || root.endsWith(separator)
        ? `${root}song`
        : `${root}${separator}song`
      const submitted = await submit(task, { outputDir: 'delivery', outputLayout: 'folders' })
      const original = submitted.tasks[0]
      task.handleWorkerEvent({
        type: 'task_done', taskId: original.id,
        payload: { outputDir: joined, files: [], outputs: [] },
      })
      const retried = await task.retryTask(original.id)
      assert.equal(retried.jobOutput, root)
      assert.equal(retried.output, joined)
    }
  })

  for (const reportRoot of [false, true]) {
    test(`${mode} retry preserves a linked subdirectory whose physical name differs (root metadata: ${reportRoot})`, async () => {
      storage()
      const task = await newStore()
      const submitted = await submit(task, { outputDir: 'E:/Outputs', outputLayout: 'folders' })
      const original = submitted.tasks[0]
      const payload = { outputDir: 'E:/Archive/renamed-song', files: [], outputs: [] }
      if (reportRoot) payload.outputRoot = 'E:/Outputs'
      task.handleWorkerEvent({ type: 'task_done', taskId: original.id, payload })
      await waitForSave()
      const restarted = await newStore()
      const retried = await restarted.retryTask(original.id)
      assert.equal(retried.jobOutput, 'E:/Outputs')
      assert.equal(retried.output, 'E:/Outputs/song')
      restarted.handleWorkerEvent({ type: 'task_done', taskId: retried.id, payload })
      assert.equal(retried.output, original.output)
    })
  }

  test(`${mode} retry rejects legacy records whose original output root cannot be recovered`, async () => {
    storage()
    const task = await newStore()
    const original = (await submit(task, { outputDir: 'delivery', outputLayout: 'folders' })).tasks[0]
    task.handleWorkerEvent({
      type: 'task_done', taskId: original.id,
      payload: { outputDir: 'E:/Archive/renamed-song', files: [], outputs: [] },
    })
    const count = task.tasks.length
    await assert.rejects(task.retryTask(original.id), /separate.retryOutputDirectoryUnknown/)
    assert.equal(task.tasks.length, count)
  })

  for (const platform of ['linux', 'darwin']) {
    for (const outputLayout of ['flat', 'folders']) {
      test(`${mode} ${platform} history and retry preserve spaces in native ${outputLayout} output paths`, async () => {
        const values = storage()
        const task = await newStore(platform)
        task.clearInputFiles()
        task.addInputFiles(['/audio/ song .wav'])
        const original = (await submit(task, { outputDir: '/tmp/alias', outputLayout })).tasks[0]
        const outputRoot = '/tmp/physical-root '
        const outputDir = outputLayout === 'folders' ? `${outputRoot}/ song ` : outputRoot
        const output = { stem: 'vocals', path: `${outputDir}/vocals.wav` }
        task.handleWorkerEvent({
          type: 'task_done', taskId: original.id,
          payload: { outputRoot, outputDir, files: [output.path], outputs: [output] },
        })
        await waitForSave()
        const stored = JSON.parse(values.get('pymss-studio:task-history')).tasks.find(item => item.id === original.id)
        assert.equal(stored.output, outputDir)
        assert.equal(stored.jobOutput, outputRoot)
        const restarted = await newStore(platform)
        const restored = restarted.getTaskById(original.id)
        assert.equal(restored.output, outputDir)
        assert.equal(restored.jobOutput, outputRoot)
        const retried = await restarted.retryTask(original.id)
        assert.equal(retried.jobOutput, outputRoot)
        assert.equal(retried.output, outputDir)
      })
    }

    test(`${mode} ${platform} submission and retry preserve backslashes in POSIX names`, async () => {
      storage()
      const task = await newStore(platform)
      const separator = String.fromCharCode(92)
      const root = `/tmp/results${separator}`
      for (const stem of [`AC${separator}DC`, `trailing${separator}`, ` AC${separator}DC `]) {
        task.clearInputFiles()
        task.addInputFiles([`/audio/${stem}.wav`])
        const submitted = await submit(task, { outputDir: root, outputLayout: 'folders' })
        const original = submitted.tasks[0]
        const savedDirectory = `${root}/${stem}`
        assert.equal(original.output, savedDirectory)
        task.handleWorkerEvent({
          type: 'task_done', taskId: original.id,
          payload: { outputDir: savedDirectory, files: [], outputs: [] },
        })
        const retried = await task.retryTask(original.id)
        assert.equal(retried.jobOutput, root)
        assert.equal(retried.output, savedDirectory)
      }
    })

    test(`${mode} ${platform} historical POSIX output keeps its directory after restart`, async () => {
      storage()
      const task = await newStore(platform)
      const separator = String.fromCharCode(92)
      task.clearInputFiles()
      task.addInputFiles([`/audio/AC${separator}DC.wav`])
      const submitted = await submit(task, { outputDir: 'delivery', outputLayout: 'folders' })
      const original = submitted.tasks[0]
      const savedDirectory = `/tmp/results/AC${separator}DC`
      task.handleWorkerEvent({
        type: 'task_done', taskId: original.id,
        payload: { outputDir: savedDirectory, files: [], outputs: [] },
      })
      await waitForSave()
      const restarted = await newStore(platform)
      const retried = await restarted.retryTask(original.id)
      assert.equal(retried.jobOutput, '/tmp/results')
      assert.equal(retried.output, savedDirectory)
    })
  }
}
