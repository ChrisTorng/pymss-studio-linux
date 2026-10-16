import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { detectRuntimePlatform } from '../src/utils/runtime.ts'

function componentFunction(file, name, scope) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(declaration, `${name} must exist`)
  const code = ts.transpileModule(declaration.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return vm.runInNewContext(`${code}\n${name}`, scope)
}

function componentComputed(file, name, scope) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = parsed.statements
    .filter(ts.isVariableStatement)
    .flatMap(node => [...node.declarationList.declarations])
    .find(node => node.name.getText(parsed) === name)
  assert.ok(declaration?.initializer, `${name} must exist`)
  const code = ts.transpileModule(`const ${name} = ${declaration.initializer.getText(parsed)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return vm.runInNewContext(`${code}\n${name}`, { computed: fn => fn(), ...scope })
}

for (const [platform, machine, expected] of [
  ['darwin', 'arm64', ['mlx']],
  ['darwin', 'aarch64', ['mlx']],
  ['win32', 'AMD64', ['cpu', 'cuda', 'rocm']],
]) {
  test(`${platform}/${machine} settings and onboarding offer the intended runtime environments`, () => {
    const scope = {
      runtimePlatform: { value: detectRuntimePlatform({ platform, machine }) },
      runtimeBackendName: backend => backend,
      runtimeBackendDescription: backend => backend,
      t: key => key,
      backendInstalled: () => true,
      runtimeRecommendedBackend: { value: expected[0] },
      runtimeSizeHint: () => '',
    }
    const catalog = componentComputed('../src/views/SettingsView.vue', 'runtimeBackendCatalog', scope)
    const choices = componentComputed('../src/components/StartupOnboarding.vue', 'runtimeBackendChoices', scope)
    assert.deepEqual(Array.from(catalog, item => item.backend), expected)
    assert.deepEqual(Array.from(choices, item => item.value), expected)
  })
}

for (const platform of ['darwin', 'linux', 'win32']) {
  for (const installed of [false, true]) {
    test(`${platform} onboarding with ${installed ? 'an installed' : 'a missing'} runtime respects the management boundary`, async () => {
      const actions = []
      const app = {
        runtimeManagementSupported: platform === 'win32',
        runtimeReadyForBackend: () => false,
        runtimeInfo: { installedEnvironments: [{ backend: 'cpu', pythonPath: '/runtime/cpu/bin/python' }] },
        activateRuntime: async () => actions.push('activate'),
        installRuntime: async () => actions.push('install'),
      }
      const finish = componentFunction('../src/components/StartupOnboarding.vue', 'finishOnboarding', {
        app,
        selectedBackend: { value: 'cpu' },
        backendInstalled: () => installed,
        settings: { markStartupOnboardingCompleted: async () => actions.push('complete') },
        router: { push: async () => actions.push('settings') },
        emit: () => actions.push('emitted'),
        runRippleViewTransition: async action => action(),
        getElementOrigin: () => null,
        completeButtonRef: { value: null },
        window: { innerWidth: 1280, innerHeight: 800 },
        runtimeMirror: { value: 'auto' },
        currentLocale: { value: 'zh-CN' },
      })
      await finish()
      assert.deepEqual(actions, platform === 'win32'
        ? ['complete', 'settings', 'emitted', installed ? 'activate' : 'install']
        : ['complete', 'emitted'])
    })
  }
}

test('unsupported platforms skip core update prompts', () => {
  const actions = []
  const scope = { app: { runtimeCoreUpdateSupported: false, updateRuntimeCore: async () => actions.push('update') } }
  componentFunction('../src/App.vue', 'showRuntimeCorePrompt', scope)()
  assert.deepEqual(actions, [])
})

for (const backend of ['mlx', 'cpu']) {
  test(`${backend} startup requests confirmation and never starts a core synchronization`, () => {
    const actions = []
    const scope = {
      app: { runtimeManagementSupported: false, runtimeCoreUpdateSupported: true, updateRuntimeCore: async (...args) => actions.push(args) },
      runtimeCorePromptShown: { value: false },
      bootReady: { value: true },
      showStartupOnboarding: { value: false },
      isStandaloneRoute: { value: false },
      runtimeManifestSyncRequired: { value: true },
      runtimeCoreUpdateAvailable: { value: true },
      activeRuntime: { value: { backend, pythonPath: '/runtime/bin/python3' } },
      runtimeCorePromptVisible: { value: false },
    }
    componentFunction('../src/App.vue', 'showRuntimeCorePrompt', scope)()
    assert.equal(actions.length, 0)
    assert.equal(scope.runtimeCorePromptVisible.value, true)
  })
}

for (const confirmed of [false, true]) {
  test(`settings ${confirmed ? 'applies' : 'discards'} the exact prepared plan after confirmation`, async () => {
    const calls = []
    const plan = { id: 'confirmed-plan', backend: 'mlx', pythonPath: '/runtime/bin/python', mode: 'update', mirror: 'pypi', channel: 'prerelease', currentVersions: { pymss: '2.1.8', 'pymss-core': '0.1.11' }, targetVersions: { pymss: '2.2.0rc1', 'pymss-core': '0.2.0' }, dependencyCount: 1 }
    const scope = {
      app: { runtimeCoreUpdateSupported: true, prepareRuntimeCoreUpdate: async () => { calls.push('prepare'); return plan }, updateRuntimeCore: async (...args) => calls.push(args) },
      runtimeBusy: { value: false }, runtimeMirror: { value: 'auto' }, currentLocale: { value: 'zh-CN' },
      t: (key, values) => `${key}:${JSON.stringify(values || {})}`,
      confirmRuntimeAction: async (_title, content) => { assert.match(content, /2\.2\.0rc1/); return confirmed },
      message: { error: error => assert.fail(error) },
    }
    await componentFunction('../src/views/SettingsView.vue', 'runRuntimeCoreOperation', scope)({ backend: 'mlx' }, 'update')
    assert.equal(calls[0], 'prepare')
    assert.equal(calls.length, confirmed ? 2 : 1)
    if (confirmed) assert.equal(calls[1][3].planId, plan.id)
  })
}

test('non-Windows developer controls cannot open an editor or mutate runtime files', async () => {
  const scope = { app: { runtimeManagementSupported: false } }
  for (const name of ['openRuntimeDebugEditor', 'saveRuntimeDebugEditor', 'restoreRuntimeDebugFile', 'overrideActiveRuntimePointer']) {
    await componentFunction('../src/views/DebugView.vue', name, scope)({ editable: true, backupExists: true })
  }
})
