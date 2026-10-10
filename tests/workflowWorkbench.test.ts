import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkflowBindings, prepareWorkbenchRun, visibleWorkflowNodeId, workflowOutputNodes } from '../src/workflows/workbench.ts'

const graph = {
  nodes: [
    { id: 1, type: 'pymss_load_audio', widgets_values: ['old.wav', 'shared'] },
    { id: 2, type: 'pymss_load_audio_batch', widgets_values: ['old-folder', true, true, 'shared'] },
    { id: 3, type: 'pymss_save_audio', widgets_values: ['wav', 'Default', '44100'] },
    { id: 4, type: 'SaveAudio', widgets_values: ['output'] },
  ], links: [],
}

test('workbench isolates input slots and freezes per-node directories without modifying the saved graph', () => {
  const bindings = createWorkflowBindings()
  bindings.inputs = { '1': { files: ['C:/music/one.wav', 'C:/music/two.wav'] }, '2': { files: ['C:/music/reference.wav'] } }
  bindings.primaryInput = '1'
  bindings.outputs = { '4': 'D:/other' }
  bindings.outputLayout = 'folders'
  const original = JSON.stringify(graph)
  const prepared = prepareWorkbenchRun(graph, bindings, 'D:/output')
  assert.equal(JSON.stringify(graph), original)
  assert.equal(prepared.runs.length, 2)
  assert.deepEqual(prepared.runs[1].inputs, { studio_input_1: 'C:/music/two.wav', studio_input_2: 'C:/music/reference.wav' })
  assert.equal(prepared.runs[1].outputs['4'].replaceAll('\\', '/'), 'D:/other/two')
  assert.equal(prepared.runs[1].outputs['3'].replaceAll('\\', '/'), 'D:/output/two')
  bindings.inputs['1'].files[0] = 'changed.wav'
  assert.equal(prepared.runs[0].input, 'C:/music/one.wav')
  assert.equal((prepared.definition.nodes as any[])[1].widgets_values[0], '')
})

test('workbench requires explicit bindings and rejects ambiguous multi-file pairing', () => {
  const bindings = createWorkflowBindings()
  assert.throws(() => prepareWorkbenchRun(graph, bindings, 'out'), /missingInput/)
  bindings.inputs = { '1': { files: ['a', 'b'] }, '2': { files: ['c', 'd'] } }
  assert.throws(() => prepareWorkbenchRun(graph, bindings, 'out'), /multipleBatches/)
  bindings.inputs['2'].files = ['c']
  bindings.primaryInput = '2'
  assert.throws(() => prepareWorkbenchRun(graph, bindings, 'out'), /primaryBatch/)
})

test('simple output identities and generated operation nodes map to their editor identities', () => {
  const definition = { version: 1, steps: [{ id: 'split', stems: ['Vocals'], save: { Vocals: 'Default' } }], ensembles: [{ id: 'mix', save: 'Default', output_stem: 'Instrumental' }] }
  assert.deepEqual(workflowOutputNodes(definition).map(node => node.id), ['save:split:Vocals', 'studio:ensemble-save:mix'])
  assert.equal(visibleWorkflowNodeId('step:split', definition), 'split')
  assert.equal(visibleWorkflowNodeId('studio:ensemble:mix:mix:2', definition), 'mix')
  assert.equal(visibleWorkflowNodeId('studio:ensemble-save:mix', definition), 'save')
  assert.equal(visibleWorkflowNodeId('unknown-helper', definition), '')
})
