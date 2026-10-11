<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { convertFileSrc } from '@tauri-apps/api/core'
import { isTauriRuntime } from '@/utils/appStore'
import TaskLogConsole from '@/components/TaskLogConsole.vue'
import WorkflowNodeLog from '@/components/workflow/WorkflowNodeLog.vue'
import WorkflowExecutionProgress from '@/components/workflow/WorkflowExecutionProgress.vue'
import { visibleWorkflowNodeLogs } from '@/workflows/nodeLogs'
import { workflowOutputNodes, visibleWorkflowNodeStates } from '@/workflows/workbench'
import { useTaskStore } from '@/stores/task'
import { useWorkbenchStore } from '@/stores/workbench'
import { isMainTaskOwner } from '@/utils/taskOwner'
import { requestWorkbenchAction } from '@/utils/workbenchBridge'
import type { TaskStatus } from '@/features/tasks/lifecycle'

const props = withDefaults(defineProps<{
  workflowKey: string; submitting?: boolean; canRun?: boolean; size?: 'small' | 'medium'; runPrimary?: boolean
}>(), { canRun: true, size: 'medium', runPrimary: false })
const jobId = defineModel<string>('jobId', { default: '' })
const emit = defineEmits<{ run: []; cancel: [] }>()
const task = useTaskStore()
const workbench = useWorkbenchStore()
const { t } = useI18n()
const message = useMessage()
const showDetails = ref(false)
const detailsTab = ref('logs')
const session = computed(() => workbench.session(props.workflowKey))
const owner = isMainTaskOwner()
const jobs = computed(() => owner
  ? task.allJobs.filter(job => job.primary.runConfig?.workbench && job.primary.runConfig.workflowId === props.workflowKey)
  : workbench.remoteJobs[props.workflowKey] || [])
const currentJob = computed(() => jobs.value.find(job => job.id === jobId.value) || null)
const currentTask = computed(() => currentJob.value?.tasks.find(item => item.id === session.value.selectedTaskId)
  || currentJob.value?.tasks.find(item => item.status === 'separating')
  || currentJob.value?.tasks.find(item => !['done', 'failed', 'cancelled'].includes(item.status))
  || currentJob.value?.primary || null)
const active = computed(() => currentJob.value?.tasks.some(item => !['done', 'failed', 'cancelled'].includes(item.status)))
const statusKeys: Record<TaskStatus, string> = {
  queued: 'tasks.statusQueued', preparing: 'tasks.statusPreparing', separating: 'tasks.statusSeparating',
  done: 'tasks.statusDone', failed: 'tasks.statusFailed', cancelled: 'tasks.statusCancelled',
  validating_input: 'tasks.statusValidatingInput', downloading_model: 'tasks.statusCheckingModel',
  ensuring_model: 'tasks.statusCheckingModel', loading_model: 'tasks.statusLoadingModel', writing_output: 'tasks.statusWritingOutput',
}
const jobOptions = computed(() => jobs.value.map(job => {
  const status = job.tasks.some(item => !['done', 'failed', 'cancelled'].includes(item.status)) ? job.status
    : job.tasks.some(item => item.status === 'failed') ? 'failed' : job.status
  return { value: job.id, label: new Date(job.primary.createdAt).toLocaleTimeString() + ' · ' + job.inputCount + ' · ' + t(statusKeys[status] || 'tasks.statusSeparating') }
}))
const taskOptions = computed(() => [
  { value: '', label: t('workbench.followActive') },
  ...(currentJob.value?.tasks || []).map((item, index) => ({ value: item.id, label: String(index + 1) + '. ' + (item.input.split(/[\\/]/).pop() || item.model) })),
])
const detailNodeStates = computed(() => visibleWorkflowNodeStates(currentTask.value?.runConfig?.workbench?.sourceDefinition || {}, currentTask.value?.nodeStates))
const detailNodeLogs = computed(() => visibleWorkflowNodeLogs(currentTask.value?.runConfig?.workbench?.sourceDefinition || {}, currentTask.value?.nodeLogs))
const detailNodes = computed(() => {
  const definition = currentTask.value?.runConfig?.workbench?.sourceDefinition
  if (!definition) return []
  if (Array.isArray(definition.nodes)) return definition.nodes.map((node: any) => ({ id: String(node.id), label: String(node.title || node.type) }))
  return [
    { id: 'input', label: t('workflows.originalInput') },
    ...(Array.isArray(definition.steps) ? definition.steps : []).map((step: any, index: number) => ({ id: String(step.id), label: String(step.model || t('workflows.stepTitle', { index: index + 1 })) })),
    ...(Array.isArray(definition.ensembles) ? definition.ensembles : []).map((item: any) => ({ id: String(item.id), label: String(item.output_stem || item.algorithm) })),
    ...(workflowOutputNodes(definition).length ? [{ id: 'save', label: t('workflows.saveNode') }] : []),
  ]
})
function audioSource(path: string) { return isTauriRuntime() ? convertFileSrc(path) : '' }
function fileName(path: string) { return path.split(/[\\/]/).pop() || path }
async function retry() {
  if (!currentTask.value) return
  try {
    const next = owner
      ? await task.retryTask(currentTask.value.id).then(value => value ? { jobId: value.jobId || value.id } : null)
      : await requestWorkbenchAction({ action: 'retry', workflowKey: props.workflowKey, taskId: currentTask.value.id })
    if (next?.jobId) { jobId.value = next.jobId; session.value.selectedTaskId = '' }
  } catch (error) { message.error(String(error)) }
}
</script>

<template>
  <span class="workflow-run-controls" data-workbench-run-panel>
    <n-button :size="size" :type="runPrimary ? 'primary' : 'default'" :disabled="!canRun || submitting" :loading="submitting" @click="emit('run')">{{ t('workflows.runWorkflowAction') }}</n-button>
    <n-button v-if="active" type="error" :size="size" @click="emit('cancel')">{{ t('tasks.cancelAction') }}</n-button>
    <span v-if="currentTask" class="run-status" :title="currentTask.message" :data-run-status="currentTask.status">
      {{ t(statusKeys[currentTask.status]) }} · {{ Math.round(currentJob?.progress ?? currentTask.progress) }}%
    </span>
    <n-button v-if="jobs.length" :size="size" @click="showDetails = true">{{ t('workbench.details') }}</n-button>
    <n-modal v-model:show="showDetails" preset="card" :title="t('workbench.details')" class="workflow-run-details-modal" style="width: min(960px, calc(100vw - 48px))">
      <div class="run-details" data-workbench-details>
        <div class="run-detail-selection">
          <label><span>{{ t('workbench.chooseRun') }}</span><n-select v-model:value="jobId" :options="jobOptions" size="small" @update:value="session.selectedTaskId = ''" /></label>
          <label v-if="currentTask"><span>{{ t('workbench.executionFile') }}</span><n-select v-model:value="session.selectedTaskId" :options="taskOptions" size="small" /></label>
        </div>
        <template v-if="currentTask">
          <WorkflowExecutionProgress :job="currentJob" :task="currentTask" />
          <n-alert v-if="currentTask.error" type="error" :show-icon="true">{{ currentTask.error }}</n-alert>
          <n-tabs v-model:value="detailsTab" type="line" size="small">
            <n-tab-pane name="logs" :tab="t('tasks.logs')"><TaskLogConsole :lines="currentTask.logs" /></n-tab-pane>
            <n-tab-pane name="nodes" :tab="t('workbench.nodeExecution')">
              <div class="run-node-list">
                <section v-for="node in detailNodes" :key="node.id" class="run-node-detail"><strong :title="node.label">{{ node.label }}</strong><WorkflowNodeLog :node-id="node.id" :state="detailNodeStates[node.id]" :logs="detailNodeLogs[node.id]" pending /></section>
              </div>
            </n-tab-pane>
            <n-tab-pane name="results" :tab="t('nav.results') + ' · ' + currentTask.outputs.length">
              <div class="run-folders"><n-button v-for="directory in currentTask.outputDirectories" :key="directory" size="small" secondary :title="directory" @click="task.revealPath(directory)">{{ t('separate.openOutput') }} · {{ fileName(directory) }}</n-button></div>
              <div v-if="currentTask.outputs.length" class="run-output-list">
                <article v-for="output in currentTask.outputs" :key="output.path" class="run-output"><div class="run-output__heading"><strong>{{ output.stem }}</strong><n-button size="tiny" quaternary @click="task.revealPath(output.path)">{{ t('common.open') }}</n-button></div><span :title="output.path">{{ fileName(output.path) }}</span><audio controls preload="none" :src="audioSource(output.path)" /></article>
              </div>
              <n-empty v-else :description="t('workbench.noResultsYet')" />
            </n-tab-pane>
          </n-tabs>
          <div v-if="['failed', 'cancelled'].includes(currentTask.status)" class="run-retry"><n-button size="small" secondary @click="retry">{{ t('common.retry') }}</n-button></div>
        </template>
      </div>
    </n-modal>
  </span>
</template>

<style scoped>
.workflow-run-controls { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.run-status { white-space: nowrap; color: inherit; font-size: 12px; }
.run-status[data-run-status="failed"] { color: var(--danger); }
.run-details { display: grid; gap: 16px; max-height: calc(100vh - 180px); overflow-y: auto; }
.run-detail-selection { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.run-detail-selection label { display: grid; gap: 6px; min-width: 0; }
.run-detail-selection label > span { color: var(--on-surface-muted); font-size: 11px; }
.run-folders { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.run-output-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.run-output { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--outline); border-radius: 10px; background: var(--surface-1); }
.run-output__heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
.run-output > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--on-surface-muted); }
.run-output audio { width: 100%; height: 32px; }
.run-node-list { display: grid; gap: 10px; }
.run-node-detail { padding: 12px; border: 1px solid var(--outline); border-radius: 10px; }
.run-node-detail > strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.run-node-detail :deep(.workflow-node-log) { margin-top: 6px; }
.run-node-detail :deep(.log-console) { max-height: 260px; }
.run-retry { display: flex; justify-content: flex-end; }
@media (max-width: 640px) { .run-detail-selection, .run-output-list { grid-template-columns: 1fr; } }
</style>
