<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { useWorkbenchStore } from '@/stores/workbench'
import { useSettingsStore } from '@/stores/settings'
import { workbenchOutputDirectory, workflowInputNodes, workflowOutputNodes } from '@/workflows/workbench'

const props = withDefaults(defineProps<{
  workflowKey: string; definition: Record<string, unknown>
  mode?: 'inputs' | 'outputs' | 'all'; nodeId?: string; action?: string
}>(), { mode: 'all', nodeId: '', action: '' })
const store = useWorkbenchStore()
const settings = useSettingsStore()
const { t } = useI18n()
const message = useMessage()
const busy = ref(false)
const session = computed(() => store.session(props.workflowKey))
const inputs = computed(() => props.mode === 'outputs' ? [] : workflowInputNodes(props.definition).filter(node => !props.nodeId || node.id === props.nodeId))
const outputs = computed(() => props.mode === 'inputs' ? [] : workflowOutputNodes(props.definition).filter(node => !props.nodeId || node.id === props.nodeId))
function files(id: string) {
  return session.value.bindings.inputs[id]?.files || (inputs.value.find(node => node.id === id)?.embeddedPath ? [inputs.value.find(node => node.id === id)!.embeddedPath!] : [])
}
function setFiles(id: string, paths: string[], folder?: string) {
  session.value.bindings.inputs[id] = { files: [...new Set(paths)], ...(folder ? { folder } : {}) }
  if (!session.value.bindings.primaryInput) session.value.bindings.primaryInput = id
}
async function safely(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  try { await action() } catch (error) { message.error(error instanceof Error ? error.message : String(error)) }
  finally { busy.value = false }
}
function pickFiles(id: string) { return safely(async () => {
  const selected = await invoke<string[]>('pick_media_files')
  if (selected?.length) setFiles(id, [...files(id), ...selected])
}) }
function pickFolder(id: string) { return safely(async () => {
  const folder = await invoke<string | null>('pick_input_folder')
  if (!folder) return
  const scanned = await invoke<{ files: string[]; warnings: string[] }>('scan_media_paths', { paths: [folder] })
  setFiles(id, scanned.files, folder)
  if (!scanned.files.length) message.warning(t('workbench.emptyFolder'))
}) }
function pickOutput(id: string) { return safely(async () => {
  const folder = await settings.pickFolder()
  if (folder) session.value.bindings.outputs[id] = folder
}) }
watch(() => [props.nodeId, props.action], () => {
  if (!props.nodeId) return
  if (props.action === 'files') void pickFiles(props.nodeId)
  if (props.action === 'folder') void pickFolder(props.nodeId)
  if (props.action === 'output') void pickOutput(props.nodeId)
}, { immediate: true })
</script>

<template>
  <section class="node-bindings" @pointerdown.stop @dblclick.stop @wheel.stop>
    <div v-for="node in inputs" :key="node.id" class="binding-group" :data-workbench-input="node.id">
      <strong v-if="inputs.length > 1 || mode === 'all'">{{ node.label }}</strong>
      <div class="binding-actions">
        <n-button size="tiny" :disabled="busy" @click="pickFiles(node.id)">{{ t('workbench.addFiles') }}</n-button>
        <n-button size="tiny" :disabled="busy" @click="pickFolder(node.id)">{{ t('workbench.chooseFolder') }}</n-button>
        <n-button v-if="files(node.id).length" size="tiny" quaternary @click="setFiles(node.id, [])">{{ t('workbench.clear') }}</n-button>
      </div>
      <small>{{ t('workbench.inputCount', { count: files(node.id).length }) }}</small>
      <div class="binding-files">
        <div v-for="path in files(node.id)" :key="path" class="binding-file">
          <span :title="path">{{ path.split(/[\\/]/).pop() }}</span>
          <button type="button" :aria-label="t('separate.remove')" @click="setFiles(node.id, files(node.id).filter(file => file !== path))">×</button>
        </div>
      </div>
      <n-button v-if="workflowInputNodes(definition).length > 1" size="tiny" :type="session.bindings.primaryInput === node.id ? 'primary' : 'default'" @click="session.bindings.primaryInput = node.id">{{ t('workbench.primaryInput') }}</n-button>
    </div>
    <div v-for="node in outputs" :key="node.id" class="binding-group" :data-workbench-output="node.id">
      <strong>{{ node.label }}</strong>
      <n-input size="tiny" readonly :value="workbenchOutputDirectory(node, session.bindings.outputs[node.id], settings.outputDir)" :title="workbenchOutputDirectory(node, session.bindings.outputs[node.id], settings.outputDir)" />
      <div class="binding-actions">
        <n-button size="tiny" :disabled="busy" @click="pickOutput(node.id)">{{ t('workbench.chooseOutput') }}</n-button>
        <n-button size="tiny" :type="!session.bindings.outputs[node.id] ? 'primary' : 'default'" @click="delete session.bindings.outputs[node.id]">{{ t('workbench.defaultOutput') }}</n-button>
      </div>
    </div>
    <label v-if="outputs.length" class="binding-layout">
      <span>{{ t('separate.saveMode') }}</span>
      <n-select size="tiny" v-model:value="session.bindings.outputLayout" :options="[{ label: t('separate.saveModeFlatName'), value: 'flat' }, { label: t('separate.saveModeFolderName'), value: 'folders' }]" />
    </label>
  </section>
</template>

<style scoped>
.node-bindings { display: grid; gap: 12px; padding: 10px; font-size: 12px; }
.binding-group { display: grid; gap: 6px; min-width: 0; }
.binding-actions { display: flex; gap: 5px; flex-wrap: wrap; }
.binding-files { max-height: 132px; overflow: auto; }
.binding-file { display: flex; align-items: center; gap: 6px; }
.binding-file span { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.binding-file button { background: transparent; border: 0; color: var(--on-surface-muted); cursor: pointer; font-size: 18px; }
.binding-layout { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 8px; }
small { color: var(--on-surface-muted); }
</style>
