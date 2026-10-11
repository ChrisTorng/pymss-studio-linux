<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getLogLineLevels } from '@/utils/taskLog'

const props = withDefaults(defineProps<{ lines: readonly string[]; compact?: boolean }>(), { compact: false })
const { t } = useI18n()
const levels = computed(() => getLogLineLevels(props.lines))
function guardLogKeys(event: KeyboardEvent) {
  if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation()
}
</script>

<template>
  <div v-if="lines.length" class="log-console" :class="{ 'log-console--compact': compact }" role="region" :aria-label="t('tasks.logs')" tabindex="0" @wheel.stop @pointerdown.stop @dblclick.stop @contextmenu.stop @keydown="guardLogKeys">
    <div v-for="(line, index) in lines" :key="index" class="log-line" :class="'log-line--' + levels[index]">
      <span class="log-line-number">{{ String(index + 1).padStart(3, '0') }}</span>
      <span class="log-line-level" aria-hidden="true">{{ levels[index].toUpperCase() }}</span>
      <span class="log-line-text">{{ line }}</span>
    </div>
  </div>
  <div v-else class="log-empty">{{ t('tasks.noLogs') }}</div>
</template>

<style scoped>
.log-console {
  max-height: min(62vh, 520px);
  overflow: auto;
  display: grid;
  gap: 2px;
  padding: 12px;
  border-radius: 12px;
  background: #0b1020;
  color: #c9d6ec;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, #94a3b8 46%, transparent) transparent;
}

.log-console::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.log-console::-webkit-scrollbar-track {
  background: transparent;
}

.log-console::-webkit-scrollbar-thumb {
  border: 2px solid #0b1020;
  border-radius: 999px;
  background: color-mix(in srgb, #94a3b8 44%, transparent);
  background-clip: padding-box;
}

.log-console::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, #94a3b8 64%, transparent);
  background-clip: padding-box;
}

.log-console::-webkit-scrollbar-corner {
  background: transparent;
}

.log-line {
  display: grid;
  grid-template-columns: 28px 46px minmax(0, 1fr);
  gap: 9px;
  padding: 3px 6px;
  border-radius: 4px;
  color: var(--log-level-color, #c9d6ec);
}

.log-line--debug {
  --log-level-color: #b8aed3;
}

.log-line--info {
  --log-level-color: #9dceff;
}

.log-line--warn {
  --log-level-color: #f4d08b;
  background: color-mix(in srgb, var(--log-level-color) 8%, transparent);
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--log-level-color) 65%, transparent);
}

.log-line--error {
  --log-level-color: #f3aab8;
  background: color-mix(in srgb, var(--log-level-color) 9%, transparent);
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--log-level-color) 70%, transparent);
}

.log-line-number {
  color: #73839c;
  text-align: right;
  user-select: none;
}

.log-line-level {
  align-self: start;
  margin-top: 1px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--log-level-color) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--log-level-color) 25%, transparent);
  font-size: 10px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  user-select: none;
}

.log-line-text {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.log-empty {
  padding: 18px;
  color: var(--on-surface-muted);
  text-align: center;
}

.log-console--compact { max-height: 180px; padding: 6px; border-radius: 6px; font-size: 10px; }
.log-console--compact .log-line { grid-template-columns: 22px 34px minmax(0, 1fr); gap: 5px; padding: 2px; }
.log-console--compact .log-line-level { font-size: 8px; line-height: 15px; }
</style>
