import { detectWorkflowFormat, isWorkflowSaveNodeType } from './formats.ts'

export type WorkflowNodeState = { status: 'running' | 'done' | 'failed' | 'cancelled'; progress: number }
export type WorkflowRuntimeBindings = {
  inputs: Record<string, { files: string[]; folder?: string }>
  outputs: Record<string, string>
  primaryInput: string
  outputLayout: 'flat' | 'folders'
}
export type WorkflowBindingNode = { id: string; label: string; embeddedPath?: string; subdirectory?: string }
export type WorkflowWorkbenchSnapshot = {
  version: 1
  sourceUpdatedAt: number
  sourceDefinition: Record<string, unknown>
  bindings: WorkflowRuntimeBindings
  inputs: Record<string, string>
  outputs: Record<string, string>
}
export type WorkbenchRun = { input: string; inputs: Record<string, string>; outputs: Record<string, string> }

const LOAD_TYPES = new Set(['input_audio', 'pymss_load_audio', 'LoadAudio', 'pymss_load_audio_batch'])
function record(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
export function cloneWorkflow<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
export function createWorkflowBindings(): WorkflowRuntimeBindings {
  return { inputs: {}, outputs: {}, primaryInput: '', outputLayout: 'flat' }
}
export function workflowInputNodes(definition: Record<string, unknown>): WorkflowBindingNode[] {
  if (detectWorkflowFormat(definition) === 'simple') return [{ id: 'input', label: 'Input' }]
  return (Array.isArray(definition.nodes) ? definition.nodes : []).filter(record)
    .filter(node => LOAD_TYPES.has(String(node.type)))
    .map(node => {
      const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : []
      const path = String(widgets[0] || '')
      return {
        id: String(node.id), label: String(node.title || `${node.type} #${node.id}`),
        ...(String(node.type) !== 'pymss_load_audio_batch' && /[\\/]/.test(path) ? { embeddedPath: path } : {}),
      }
    })
}
export function workflowOutputNodes(definition: Record<string, unknown>): WorkflowBindingNode[] {
  if (detectWorkflowFormat(definition) !== 'simple') {
    return (Array.isArray(definition.nodes) ? definition.nodes : []).filter(record)
      .filter(node => isWorkflowSaveNodeType(node.type))
      .map(node => {
        const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : []
        const dynamicPrefix = (Array.isArray(node.inputs) ? node.inputs : []).some((input: any) => input?.name === 'filename_prefix' && input.link != null)
        const folder = node.type === 'pymss_save_audio' ? String(widgets[1] || '')
          : dynamicPrefix ? '' : String(widgets[0] || '').replace(/\\/g, '/').split('/').slice(0, -1).join('/')
        return { id: String(node.id), label: String(node.title || `${node.type} #${node.id}`),
          ...(!folder || /^\d+$/.test(folder) || folder.toLowerCase() === 'default' ? {} : { subdirectory: safeDirectoryPart(folder) }) }
      })
  }
  const nodes: WorkflowBindingNode[] = []
  for (const step of (Array.isArray(definition.steps) ? definition.steps : []).filter(record)) {
    for (const [stem, target] of Object.entries(record(step.save) ? step.save : {})) {
      if (target && (!Array.isArray(target) || target.some(Boolean))) {
        nodes.push({ id: `save:${step.id}:${stem}`, label: `${step.id} · ${stem}` })
      }
    }
  }
  for (const item of (Array.isArray(definition.ensembles) ? definition.ensembles : []).filter(record)) {
    if (item.save) nodes.push({ id: `studio:ensemble-save:${item.id}`, label: `${item.id} · ${item.output_stem}` })
  }
  return nodes
}
function fileStem(path: string): string {
  return safeDirectoryPart((path.split(/[\\/]/).pop() || 'workflow').replace(/\.[^.]+$/, ''))
}
function safeDirectoryPart(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/^[. ]+|[. ]+$/g, '') || 'workflow'
}
function appendDirectory(root: string, child: string): string {
  return `${root.replace(/[\\/]+$/, '')}${/^[A-Za-z]:|^\\\\/.test(root) ? '\\' : '/'}${child}`
}
export function workbenchOutputDirectory(node: WorkflowBindingNode, override: string | undefined, defaultDirectory: string): string {
  const root = override || defaultDirectory
  return node.subdirectory ? appendDirectory(root, node.subdirectory) : root
}

/** Build a transient graph and explicit per-file inputs without changing the saved document. */
export function prepareWorkbenchRun(
  definition: Record<string, unknown>, bindings: WorkflowRuntimeBindings, defaultDirectory: string,
): { definition: Record<string, unknown>; runs: WorkbenchRun[] } {
  const transient = cloneWorkflow(definition)
  const inputNodes = workflowInputNodes(transient)
  const outputNodes = workflowOutputNodes(transient)
  if (!outputNodes.length) throw new Error('workbench.noOutputs')
  const filesByNode = new Map(inputNodes.map(node => [node.id, [
    ...(bindings.inputs[node.id]?.files || (node.embeddedPath ? [node.embeddedPath] : [])),
  ].filter(Boolean)]))
  if (inputNodes.some(node => !filesByNode.get(node.id)?.length)) throw new Error('workbench.missingInput')
  const primary = inputNodes.find(node => node.id === bindings.primaryInput) || inputNodes[0]
  const shared = (Array.isArray(transient.nodes) ? transient.nodes : []).filter(record).filter(node => node.type === 'input_audio')
  if (shared.length > 1 || (shared.length && String(shared[0].id) !== primary?.id)) throw new Error('workbench.primaryNativeInput')
  const multiple = inputNodes.filter(node => (filesByNode.get(node.id)?.length || 0) > 1)
  if (multiple.length > 1) throw new Error('workbench.multipleBatches')
  if (multiple.length && multiple[0].id !== primary?.id) throw new Error('workbench.primaryBatch')
  const slotNames = new Map<string, string>()
  if (detectWorkflowFormat(transient) === 'graph') {
    const nodes = (transient.nodes as Record<string, any>[])
    for (const node of nodes.filter(node => LOAD_TYPES.has(String(node.type)))) {
      const id = String(node.id)
      if (node.type === 'input_audio') continue
      const widgets = Array.isArray(node.widgets_values) ? [...node.widgets_values] : []
      const slot = node.type === 'pymss_load_audio_batch' ? 3 : 1
      const name = `studio_input_${id}`
      while (widgets.length <= slot) widgets.push('')
      widgets[slot] = name
      widgets[0] = ''
      node.widgets_values = widgets
      slotNames.set(id, name)
    }
  }
  if (!defaultDirectory.trim() || outputNodes.some(node => !(bindings.outputs[node.id] || defaultDirectory).trim())) {
    throw new Error('workbench.missingOutputDirectory')
  }
  const files = primary ? filesByNode.get(primary.id)! : ['']
  return {
    definition: transient,
    runs: files.map(input => {
      const inputs = Object.fromEntries(inputNodes.flatMap(node => {
        const name = slotNames.get(node.id)
        return name ? [[name, node.id === primary?.id ? input : filesByNode.get(node.id)![0]]] : []
      }))
      const outputs = Object.fromEntries(outputNodes.map(node => {
        const root = workbenchOutputDirectory(node, bindings.outputs[node.id], defaultDirectory)
        return [node.id, bindings.outputLayout === 'folders' ? appendDirectory(root, fileStem(input)) : root]
      }))
      return { input, inputs, outputs }
    }),
  }
}

/** Group compiler-generated nodes into the visible simple editor nodes. */
export function visibleWorkflowNodeId(runtimeId: string, definition: Record<string, unknown>): string {
  if (detectWorkflowFormat(definition) !== 'simple') return runtimeId
  if (runtimeId === 'input' || runtimeId === 'input_audio') return 'input'
  const steps = (Array.isArray(definition.steps) ? definition.steps : []).filter(record)
  const step = steps.find(item => runtimeId === `step:${item.id}`)
  if (step) return String(step.id)
  if (runtimeId.startsWith('save:') || runtimeId.startsWith('studio:ensemble-save:')) return 'save'
  const items = (Array.isArray(definition.ensembles) ? definition.ensembles : []).filter(record)
  const ensemble = items.find(item => runtimeId === `studio:ensemble:${item.id}` || runtimeId.startsWith(`studio:ensemble:${item.id}:mix:`))
  return ensemble ? String(ensemble.id) : ''
}

export const WORKFLOW_NODE_STATUS_KEYS: Record<string, string> = {
  running: 'workbench.running', done: 'workbench.done', failed: 'workbench.failed', cancelled: 'workbench.cancelled',
}
