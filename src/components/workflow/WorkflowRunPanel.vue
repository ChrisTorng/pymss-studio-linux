<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { convertFileSrc } from '@tauri-apps/api/core'
import { isTauriRuntime } from '@/utils/appStore'
import { useTaskStore } from '@/stores/task'
import { useWorkbenchStore } from '@/stores/workbench'
import { isMainTaskOwner } from '@/utils/taskOwner'
import { requestWorkbenchAction } from '@/utils/workbenchBridge'

const props = defineProps<{ workflowKey: string; definition: Record<string, unknown>; submitting?: boolean; dirty?: boolean }>()
const viewMode = defineModel<'edit' | 'execution'>('viewMode', { default: 'edit' })
const jobId = defineModel<string>('jobId', { default: '' })
const emit = defineEmits<{ run: []; cancel: [] }>()
const task = useTaskStore()
const workbench = useWorkbenchStore()
const { t } = useI18n()
const message = useMessage()
const expanded = ref(false)
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
const statusKeys: Record<string, string> = {
  queued: 'tasks.statusQueued', preparing: 'tasks.statusPreparing', separating: 'tasks.statusSeparating',
  done: 'tasks.statusDone', failed: 'tasks.statusFailed', cancelled: 'tasks.statusCancelled',
}
const jobOptions = computed(() => jobs.value.map(job => ({
  value: job.id, label: `${new Date(job.primary.createdAt).toLocaleTimeString()} · ${job.inputCount} · ${t(statusKeys[job.status] || 'tasks.statusSeparating')}`,
})))
const taskOptions = computed(() => [
  { value: '', label: t('workbench.followActive') },
  ...(currentJob.value?.tasks || []).map((item, index) => ({ value: item.id, label: `${index + 1}. ${item.input.split(/[\\/]/).pop() || item.model}` })),
])
function audioSource(path: string) { return isTauriRuntime() ? convertFileSrc(path) : '' }
async function retry() {
  if (!currentTask.value) return
  try {
    const next = owner
      ? await task.retryTask(currentTask.value.id).then(value => value ? { jobId: value.jobId || value.id } : null)
      : await requestWorkbenchAction({ action: 'retry', workflowKey: props.workflowKey, taskId: currentTask.value.id })
    if (next?.jobId) { jobId.value = next.jobId; session.value.selectedTaskId = ''; viewMode.value = 'execution' }
  } catch (error) { message.error(String(error)) }
}
</script>

<template>
  <section class="workflow-run-panel" data-workbench-run-panel :data-workbench-view="viewMode">
    <div class="run-toolbar">
      <n-radio-group v-model:value="viewMode" size="small">
        <n-radio-button value="edit">{{ t('workbench.currentFlow') }}</n-radio-button>
        <n-radio-button value="execution" :disabled="!currentJob">{{ t('workbench.execution') }}</n-radio-button>
      </n-radio-group>
      <n-select class="run-job-select" v-model:value="jobId" :options="jobOptions" :placeholder="t('workbench.chooseRun')" @update:value="session.selectedTaskId = ''" />
      <n-button type="primary" size="small" :loading="submitting" @click="emit('run')">{{ dirty ? t('workbench.saveAndRun') : t('workflows.runWorkflowAction') }}</n-button>
      <n-button v-if="active" type="error" secondary size="small" @click="emit('cancel')">{{ t('tasks.cancelAction') }}</n-button>
    </div>
    <p class="run-hint">{{ viewMode === 'execution' ? t('workbench.snapshotHint') : t('workbench.editHint') }}</p>
    <div v-if="currentTask" class="run-summary">
      <n-select v-model:value="session.selectedTaskId" :options="taskOptions" size="small" class="run-file-select" />
      <n-progress type="line" :percentage="Math.round(currentJob?.progress || currentTask.progress)" :show-indicator="true" class="run-progress" />
      <n-button size="tiny" quaternary @click="expanded = !expanded">{{ t('workbench.details') }}</n-button>
    </div>
    <div v-if="currentTask && expanded" class="run-details">
      <n-alert v-if="currentTask.error" type="error" :show-icon="true">{{ currentTask.error }}</n-alert>
      <div class="run-message">{{ currentTask.message }}</div>
      <div class="binding-actions">
        <n-button v-for="directory in currentTask.outputDirectories" :key="directory" size="tiny" :title="directory" @click="task.revealPath(directory)">{{ t('separate.openOutput') }} · {{ directory.split(/[\\/]/).pop() || directory }}</n-button>
      </div>
      <div class="run-outputs">
        <div v-for="output in currentTask.outputs" :key="output.path" class="run-output">
          <span :title="output.path">{{ output.stem }} · {{ output.path }}</span>
          <audio controls preload="none" :src="audioSource(output.path)" />
          <n-button size="tiny" @click="task.revealPath(output.path)">{{ t('common.open') }}</n-button>
        </div>
      </div>
      <n-button v-if="['failed', 'cancelled'].includes(currentTask.status)" size="small" @click="retry">{{ t('common.retry') }}</n-button>
      <pre v-if="currentTask.logs.length" class="run-logs">{{ currentTask.logs.slice(-160).join('\n') }}</pre>
    </div>
  </section>
</template>

<style scoped>
.workflow-run-panel { flex: 0 0 auto; border: 1px solid var(--outline); border-radius: 12px; background: var(--surface); padding: 10px 14px; }
.run-toolbar, .run-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.run-job-select { flex: 1; min-width: 180px; }
.run-hint { color: var(--on-surface-muted); font-size: 12px; margin: 6px 0; }
.run-file-select { width: 240px; }
.run-progress { flex: 1; min-width: 180px; }
.run-details { display: grid; gap: 8px; margin-top: 10px; max-height: 260px; overflow: auto; }
.run-output { display: flex; gap: 8px; align-items: center; }
.run-output span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.run-output audio { width: 220px; height: 32px; }
.run-logs { margin: 0; padding: 10px; font-size: 11px; white-space: pre-wrap; background: var(--surface-container); border-radius: 8px; }
</style>
