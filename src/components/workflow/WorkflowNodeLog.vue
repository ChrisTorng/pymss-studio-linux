<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import TaskLogConsole from '@/components/TaskLogConsole.vue'
import { WORKFLOW_NODE_STATUS_KEYS, type WorkflowNodeState } from '@/workflows/workbench'

defineProps<{ nodeId: string; state?: WorkflowNodeState; logs?: readonly string[]; pending?: boolean }>()
const { t } = useI18n()
function guardLogKeys(event: KeyboardEvent) {
  if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation()
}
</script>

<template>
  <details v-if="state || logs?.length || pending" class="workflow-node-log" :data-node-log="nodeId" :data-node-status="state?.status || 'queued'" @pointerdown.stop @click.stop @dblclick.stop @contextmenu.stop @keydown="guardLogKeys" @wheel.stop>
    <summary>
      <span class="workflow-node-log__status">{{ t(state ? WORKFLOW_NODE_STATUS_KEYS[state.status] : 'tasks.statusQueued') }}<span v-if="state"> · {{ Math.round(state.progress) }}%</span></span>
      <span class="workflow-node-log__label">{{ t('tasks.logs') }}<small v-if="logs?.length">{{ logs.length }}</small><span class="workflow-node-log__chevron">⌄</span></span>
    </summary>
    <div v-if="state" class="workflow-node-log__progress" role="progressbar" :aria-label="t('workbench.nodeProgress')" :aria-valuenow="Math.round(state.progress)" :aria-valuemin="0" :aria-valuemax="100"><i :style="{ width: Math.min(100, Math.max(0, state.progress)) + '%' }" /></div>
    <TaskLogConsole :lines="logs || []" compact />
  </details>
</template>

<style scoped>
.workflow-node-log { margin-top: 10px; border-top: 1px solid var(--outline); min-width: 0; color: var(--on-surface-muted); }
.workflow-node-log summary { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 28px; cursor: pointer; font-size: 10px; list-style: none; }
.workflow-node-log summary::-webkit-details-marker { display: none; }
.workflow-node-log__status { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workflow-node-log__label { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }
.workflow-node-log__label small { font-size: 9px; padding: 1px 4px; background: var(--surface-2); border-radius: 4px; }
.workflow-node-log__chevron { display: inline-block; transition: transform 120ms; }
.workflow-node-log[open] .workflow-node-log__chevron { transform: rotate(180deg); }
.workflow-node-log__progress { height: 3px; border-radius: 3px; background: var(--surface-2); overflow: hidden; margin-bottom: 6px; }
.workflow-node-log__progress i { display: block; height: 100%; background: var(--primary); }
.workflow-node-log:not([open]) .workflow-node-log__progress { margin-bottom: 0; }
.workflow-node-log[data-node-status="done"] .workflow-node-log__status { color: var(--success, #44936b); }
.workflow-node-log[data-node-status="failed"] .workflow-node-log__status { color: var(--danger); }
.workflow-node-log[data-node-status="failed"] .workflow-node-log__progress i { background: var(--danger); }
</style>
