<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SeparationJob, SeparationTask } from '@/stores/task'

const props = defineProps<{ job?: SeparationJob | null; task?: SeparationTask | null }>()
const { t } = useI18n()
const completed = computed(() => props.job?.tasks.filter(item => item.status === 'done').length || 0)
const failed = computed(() => props.job?.tasks.filter(item => item.status === 'failed').length || 0)
const percentage = computed(() => Math.min(100, Math.max(0, Math.round(props.job?.progress || 0))))
</script>

<template>
  <section v-if="job && task" class="workflow-execution-progress" data-workflow-progress>
    <div class="workflow-execution-progress__row">
      <strong>{{ t('workbench.flowProgress') }}</strong>
      <span class="workflow-execution-progress__file" :title="task.input || task.model">{{ task.input.split(/[\\/]/).pop() || task.model }}</span>
      <span>{{ t('workbench.completedFiles', { done: completed, total: job.tasks.length }) }}</span>
      <span v-if="failed" class="workflow-execution-progress__failure">{{ t('workbench.failedFiles', { count: failed }) }}</span>
      <b>{{ percentage }}%</b>
    </div>
    <n-progress type="line" :percentage="percentage" :show-indicator="false" :height="4" :status="failed ? 'error' : job.status === 'done' ? 'success' : 'default'" />
  </section>
</template>

<style scoped>
.workflow-execution-progress { width: 100%; min-width: 0; }
.workflow-execution-progress__row { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; font-size: 11px; color: var(--on-surface-muted); }
.workflow-execution-progress__row strong { color: var(--on-surface); font-weight: 600; }
.workflow-execution-progress__file { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workflow-execution-progress__row b { color: var(--on-surface); font-variant-numeric: tabular-nums; }
.workflow-execution-progress__failure { color: var(--danger); }
</style>
