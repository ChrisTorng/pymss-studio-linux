import { visibleWorkflowNodeId } from './workbench.ts'

export type WorkflowNodeLogs = Record<string, string[]>

export function appendWorkflowNodeLogs(target: { nodeLogs?: WorkflowNodeLogs }, nodeId: string | undefined, lines: string | string[]) {
  if (!nodeId) return
  const values = (Array.isArray(lines) ? lines : [lines]).flatMap(line => line.split(/\r?\n/)).filter(Boolean)
  if (!values.length) return
  const previous = target.nodeLogs || {}
  const logs = { ...previous, [nodeId]: [...(Object.hasOwn(previous, nodeId) ? previous[nodeId] : []), ...values].slice(-120) }
  let total = Object.values(logs).reduce((sum, items) => sum + items.length, 0)
  for (const key of Object.keys(logs)) {
    if (total <= 600) break
    if (key === nodeId) continue
    const remove = Math.min(total - 600, logs[key].length)
    logs[key] = logs[key].slice(remove)
    total -= remove
    if (!logs[key].length) delete logs[key]
  }
  target.nodeLogs = logs
}

export function visibleWorkflowNodeLogs(definition: Record<string, unknown>, logs: WorkflowNodeLogs = {}): WorkflowNodeLogs {
  const result: WorkflowNodeLogs = {}
  for (const [id, lines] of Object.entries(logs)) {
    const visible = visibleWorkflowNodeId(id, definition)
    if (!visible) continue
    Object.defineProperty(result, visible, { value: [...(Object.hasOwn(result, visible) ? result[visible] : []), ...lines].slice(-120), enumerable: true, configurable: true, writable: true })
  }
  return result
}
