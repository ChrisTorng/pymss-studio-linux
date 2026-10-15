import { loadAppStore, saveAppStore } from '@/utils/appStore'
import type { AudioToolKey } from './types'

export type StoredAudioToolsState = {
  activeTool?: AudioToolKey
  mergeSortBy?: 'name' | 'modified' | 'regex'
  mergeSortDirection?: 'asc' | 'desc'
  mergeRegex?: string
  midiModelPath?: string
  asrModelMode?: 'preset' | 'local'
  asrPreset?: string
  asrLanguage?: string
  asrModelPath?: string
  asrVadModelPath?: string
  asrPuncModelPath?: string
  loudnessMeasurement?: string
  loudnessTarget?: number
  loudnessTolerance?: number
  loudnessMaxTruePeak?: number
  loudnessUseLimiter?: boolean
  loudnessLookahead?: number
  loudnessRelease?: number
}

let queue: Promise<void> = Promise.resolve()

export function loadAudioToolsState() {
  return loadAppStore<StoredAudioToolsState>('audio-tools')
}

export function updateAudioToolsState(patch: Partial<StoredAudioToolsState>) {
  const run = queue.then(async () => {
    const current = await loadAudioToolsState() || {}
    await saveAppStore('audio-tools', { ...current, ...patch })
  })
  queue = run.catch(error => console.warn('[audio-tools] state save failed', error))
  return run
}
