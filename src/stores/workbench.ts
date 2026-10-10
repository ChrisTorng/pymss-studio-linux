import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { createWorkflowBindings, type WorkflowRuntimeBindings } from '../workflows/workbench.ts'

export type WorkflowWorkbenchSession = {
  bindings: WorkflowRuntimeBindings
  viewMode: 'edit' | 'execution'
  selectedJobId: string
  selectedTaskId: string
}
export const useWorkbenchStore = defineStore('workbench', () => {
  const sessions = reactive<Record<string, WorkflowWorkbenchSession>>({})
  function session(key: string) {
    if (!sessions[key]) sessions[key] = { bindings: createWorkflowBindings(), viewMode: 'edit', selectedJobId: '', selectedTaskId: '' }
    return sessions[key]
  }
  function adopt(from: string, to: string) {
    if (from !== to && sessions[from]) {
      sessions[to] = sessions[from]
      delete sessions[from]
    }
  }
  return { sessions, session, adopt }
})
