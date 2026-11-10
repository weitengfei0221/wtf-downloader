<script setup lang="ts">
defineProps<{ label: string; helper?: string }>();
</script>

<template>
  <div class="row">
    <div class="left">
      <span class="label">{{ label }}</span>
      <span v-if="helper" class="helper">{{ helper }}</span>
    </div>
    <div class="controls">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 48px;
  padding: var(--space-2) var(--space-4);
}

.row + .row {
  border-top: 1px solid var(--border-soft);
}

.left {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.label {
  font-size: var(--text-base);
  color: var(--fg);
}

.helper {
  font-size: var(--text-xs);
  color: var(--muted);
}

.controls {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
}
</style>
