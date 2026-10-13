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

test('non-Windows startup skips automatic runtime updates and update prompts', async () => {
  const actions = []
  const scope = { app: { runtimeManagementSupported: false, updateRuntimeCore: async () => actions.push('update') } }
  componentFunction('../src/App.vue', 'showRuntimeCorePrompt', scope)()
  await componentFunction('../src/App.vue', 'synchronizeRuntimeManifest', scope)()
  assert.deepEqual(actions, [])
})

test('non-Windows developer controls cannot open an editor or mutate runtime files', async () => {
  const scope = { app: { runtimeManagementSupported: false } }
  for (const name of ['openRuntimeDebugEditor', 'saveRuntimeDebugEditor', 'restoreRuntimeDebugFile', 'overrideActiveRuntimePointer']) {
    await componentFunction('../src/views/DebugView.vue', name, scope)({ editable: true, backupExists: true })
  }
})
