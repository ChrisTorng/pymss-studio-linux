import { computed, onBeforeUnmount, onMounted, ref, watch, type ComputedRef } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { useWorkbenchStore } from '@/stores/workbench'
import { useTaskStore } from '@/stores/task'
import { useSettingsStore } from '@/stores/settings'
import type { WorkflowEntry } from '@/stores/workflow'
import { cloneWorkflow, prepareWorkbenchRun, visibleWorkflowNodeId, workbenchOutputDirectory, workflowInputNodes, workflowOutputNodes, type WorkflowNodeState } from '@/workflows/workbench'

export function useWorkflowWorkbench(options: {
  workflowKey: ComputedRef<string>
  definition: () => Record<string, unknown>
  save: () => Promise<WorkflowEntry | null>
}) {
  const store = useWorkbenchStore()
  const tasks = useTaskStore()
  const settings = useSettingsStore()
  const { t } = useI18n()
  const message = useMessage()
  const submitting = ref(false)
  const session = computed(() => store.session(options.workflowKey.value))
  const viewMode = computed({ get: () => session.value.viewMode, set: value => { session.value.viewMode = value } })
  const selectedJobId = computed({ get: () => session.value.selectedJobId, set: value => { session.value.selectedJobId = value } })
  const focusedJob = computed(() => tasks.allJobs.find(job => job.id === selectedJobId.value) || null)
  const focusedTask = computed(() => focusedJob.value?.tasks.find(task => task.id === session.value.selectedTaskId)
    || focusedJob.value?.tasks.find(task => task.status === 'separating')
    || focusedJob.value?.tasks.find(task => !['done', 'failed', 'cancelled'].includes(task.status))
    || focusedJob.value?.primary || null)
  const executionDefinition = computed(() => focusedTask.value?.runConfig?.workbench?.sourceDefinition || null)
  const executionNodeSummaries = computed(() => {
    const target = focusedTask.value
    const snapshot = target?.runConfig?.workbench
    if (!target || !snapshot) return {}
    const summary: Record<string, string> = {}
    for (const node of workflowInputNodes(snapshot.sourceDefinition)) {
      const path = snapshot.inputs[`studio_input_${node.id}`] || target.input
      summary[node.id] = path.split(/[\\/]/).pop() || path
    }
    for (const node of workflowOutputNodes(snapshot.sourceDefinition)) summary[node.id] = snapshot.outputs[node.id] || ''
    summary.save = [...new Set(Object.values(snapshot.outputs))].join(' | ')
    return summary
  })
  const running = computed(() => Boolean(focusedJob.value?.tasks.some(task => !['done', 'failed', 'cancelled'].includes(task.status))))
  const nodeSummaries = computed(() => Object.fromEntries([
    ...workflowInputNodes(options.definition()).map(node => {
      const files = session.value.bindings.inputs[node.id]?.files || (node.embeddedPath ? [node.embeddedPath] : [])
      return [node.id, files.length ? `${files.length} · ${files[0].split(/[\\/]/).pop()}` : t('workbench.inputCount', { count: 0 })]
    }),
    ...workflowOutputNodes(options.definition()).map(node => [node.id, workbenchOutputDirectory(node, session.value.bindings.outputs[node.id], settings.outputDir)]),
  ]))
  const nodeStates = computed(() => {
    const result: Record<string, WorkflowNodeState> = {}
    const definition = executionDefinition.value
    if (!definition) return result
    for (const [runtimeId, state] of Object.entries(focusedTask.value?.nodeStates || {})) {
      const visible = visibleWorkflowNodeId(runtimeId, definition)
      if (!visible) continue
      if (visible === 'save') {
        const previous = result[visible]
        result[visible] = previous && previous.status !== 'done' ? previous : state
      } else {
        // Intermediate merge completion is not completion of the visible sum node.
        result[visible] = runtimeId.includes(':mix:') && state.status === 'done'
          ? { status: 'running', progress: state.progress } : state
      }
    }
    return result
  })
  watch(() => [options.workflowKey.value, workflowInputNodes(options.definition()).map(node => node.id).join('\n'),
    workflowOutputNodes(options.definition()).map(node => node.id).join('\n')], () => {
    const inputs = new Set(workflowInputNodes(options.definition()).map(node => node.id))
    const outputs = new Set(workflowOutputNodes(options.definition()).map(node => node.id))
    for (const key of Object.keys(session.value.bindings.inputs)) if (!inputs.has(key)) delete session.value.bindings.inputs[key]
    for (const key of Object.keys(session.value.bindings.outputs)) if (!outputs.has(key)) delete session.value.bindings.outputs[key]
  })
  let unlistenDrop: (() => void) | undefined
  let disposed = false
  onMounted(async () => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return
    try {
      const remove = await getCurrentWebview().onDragDropEvent(async event => {
        if (event.payload.type !== 'drop' || viewMode.value !== 'edit') return
        const nodes = workflowInputNodes(options.definition())
        const position = event.payload.position
        const target = document.elementFromPoint(position.x / window.devicePixelRatio, position.y / window.devicePixelRatio)?.closest<HTMLElement>('[data-workbench-input]')
        const id = target?.dataset.workbenchInput || session.value.bindings.primaryInput || (nodes.length === 1 ? nodes[0].id : '')
        if (!id || !nodes.some(node => node.id === id)) { message.warning(t('workbench.missingInput')); return }
        try {
          const scanned = await invoke<{ files: string[] }>('scan_media_paths', { paths: event.payload.paths })
          const previous = session.value.bindings.inputs[id]?.files || []
          session.value.bindings.inputs[id] = { files: [...new Set([...previous, ...scanned.files])] }
          session.value.bindings.primaryInput ||= id
        } catch (error) { message.error(String(error)) }
      })
      if (disposed) remove()
      else unlistenDrop = remove
    } catch { /* Browser previews and older webviews use the explicit file controls. */ }
  })
  onBeforeUnmount(() => { disposed = true; unlistenDrop?.() })
  function adoptWorkflowKey(key: string) { store.adopt(options.workflowKey.value, key) }
  async function run() {
    if (submitting.value) return
    submitting.value = true
    try {
      const originalKey = options.workflowKey.value
      const bindings = cloneWorkflow(session.value.bindings)
      prepareWorkbenchRun(options.definition(), bindings, settings.outputDir)
      const entry = await options.save()
      if (!entry) return
      store.adopt(originalKey, entry.id)
      const result = await tasks.startWorkbenchInference(entry, bindings)
      const target = store.session(entry.id)
      target.selectedJobId = result.jobId
      target.selectedTaskId = ''
      target.viewMode = 'execution'
      message.success(t('workbench.submitted', { count: result.total }))
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      message.error(text.startsWith('workbench.') ? t(text) : text)
    } finally { submitting.value = false }
  }
  async function cancel() {
    if (focusedJob.value) await tasks.cancelWorkbenchJob(focusedJob.value.id).catch(error => message.error(String(error)))
  }
  return { session, viewMode, selectedJobId, focusedJob, focusedTask, executionDefinition, executionNodeSummaries, nodeStates, nodeSummaries, running, submitting, run, cancel, adoptWorkflowKey }
}
