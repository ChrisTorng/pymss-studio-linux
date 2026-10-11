import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { MessageApiInjection } from 'naive-ui/es/message/src/MessageProvider'
import type { ComposerTranslation } from 'vue-i18n'
import type { useEditorStore } from '@/stores/editor'

type EditorStore = ReturnType<typeof useEditorStore>

type UseEditorProjectBridgeOptions = {
  routeProjectId: Ref<string>
  hasTauriApis: boolean
  editor: EditorStore
  assetPanelEl: Ref<HTMLElement | null>
  message: MessageApiInjection
  t: ComposerTranslation
}

export function useEditorProjectBridge(options: UseEditorProjectBridgeOptions) {
  const { routeProjectId, hasTauriApis, editor, assetPanelEl, message, t } = options

  const isDraggingExternal = ref(false)

  let unlistenDrop: UnlistenFn | null = null
  let unlistenOpenProject: UnlistenFn | null = null
  let disposed = false
  let projectLoadQueue: Promise<void> = Promise.resolve()

  function loadProject(projectId: string) {
    const operation = projectLoadQueue.catch(() => undefined).then(async () => {
      if (disposed || !projectId || editor.session?.id === projectId) return
      if (editor.session) await editor.saveProject()
      if (!disposed) await editor.loadProject(projectId)
    })
    projectLoadQueue = operation
    return operation
  }

  function isPointInAssetPanel(position: { x: number; y: number } | null | undefined) {
    const element = assetPanelEl.value
    if (!element || !position) return false

    const rect = element.getBoundingClientRect()
    const scale = window.devicePixelRatio || 1
    const x = position.x / scale
    const y = position.y / scale

    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  async function handleProjectLoad(projectId: string) {
    try {
      await loadProject(projectId)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      message.error(t('editor.loadFailed', { detail }))
    }
  }

  async function handleExternalDrop(paths: string[]) {
    try {
      const result = await editor.scanAssets(paths)
      if (result.files.length) message.success(t('editor.importSuccess', { count: result.files.length }))
      else message.warning(t('editor.importEmpty'))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      message.error(detail || t('editor.importEmpty'))
    }
  }

  onMounted(async () => {
    if (!hasTauriApis) return

    try {
      const removeDrop = await getCurrentWebview().onDragDropEvent(async (event) => {
        if (disposed) return
        const type = event.payload.type
        if (type === 'over' || type === 'enter') {
          isDraggingExternal.value = isPointInAssetPanel(event.payload.position)
          return
        }

        if (type === 'drop') {
          const isDropInAssetPanel = isPointInAssetPanel(event.payload.position)
          isDraggingExternal.value = false
          if (!isDropInAssetPanel) return
          const paths = (event.payload as { paths?: string[] }).paths || []
          await handleExternalDrop(paths)
          return
        }

        isDraggingExternal.value = false
      })
      if (disposed) removeDrop()
      else unlistenDrop = removeDrop
    } catch {
      // browser preview fallback
    }

    if (disposed) return
    const removeOpenProject = await listen<{ projectId: string }>('pymss://editor-open-project', (event) => {
      if (disposed) return
      void handleProjectLoad(event.payload.projectId)
    })
    if (disposed) removeOpenProject()
    else unlistenOpenProject = removeOpenProject
  })

  watch(routeProjectId, (projectId, previousProjectId) => {
    if (!hasTauriApis) return
    if (!projectId || projectId === previousProjectId) return
    void handleProjectLoad(projectId)
  }, { immediate: true })

  onBeforeUnmount(() => {
    disposed = true
    unlistenDrop?.()
    unlistenOpenProject?.()
  })

  return {
    isDraggingExternal,
    loadProject,
  }
}
