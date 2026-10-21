<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { FluentIconName } from './fluentIcons.ts'

import { computed } from 'vue'
import { FLUENT_ICONS } from './fluentIcons.ts'

const props = withDefaults(defineProps<{
	name: FluentIconName
	filled?: boolean
	size?: number
}>(), {
	filled: false,
	size: 24,
})

const icon = computed(() => FLUENT_ICONS[props.name])
</script>

<template>
	<svg
		class="fluent-icon"
		:width="size"
		:height="size"
		:viewBox="`0 0 ${icon.box} ${icon.box}`"
		fill="currentColor"
		aria-hidden="true">
		<path :d="filled ? icon.filled : icon.regular" />
	</svg>
</template>

<style scoped>
.fluent-icon {
	flex: 0 0 auto;
}
</style>
