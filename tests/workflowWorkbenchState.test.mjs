import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { computed, isReactive } from 'vue'
import { useWorkbenchStore } from '../src/stores/workbench.ts'

test('a newly created session remains reactive while switching between editing and execution', () => {
  setActivePinia(createPinia())
  const store = useWorkbenchStore()
  const session = store.session('new-simple')
  assert.equal(isReactive(session), true)
  const mode = computed(() => session.viewMode)
  assert.equal(mode.value, 'edit')
  store.session('new-simple').viewMode = 'execution'
  assert.equal(mode.value, 'execution')
})

test('saving a new document preserves its input bindings and selected execution session', () => {
  setActivePinia(createPinia())
  const store = useWorkbenchStore()
  const source = store.session('new-simple')
  source.bindings.inputs.input = { files: ['D:/song.wav'] }
  source.selectedJobId = 'job-1'
  store.adopt('new-simple', 'saved')
  assert.deepEqual(store.session('saved').bindings.inputs.input.files, ['D:/song.wav'])
  assert.equal(store.session('saved').selectedJobId, 'job-1')
  store.session('another').bindings.inputs.input = { files: ['D:/other.wav'] }
  assert.deepEqual(store.session('saved').bindings.inputs.input.files, ['D:/song.wav'])
})
