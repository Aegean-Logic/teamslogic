<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
defineProps<{
	title: string
}>()
</script>

<template>
	<aside class="app-pane">
		<header class="app-pane__header">
			<h2 class="app-pane__title">
				{{ title }}
			</h2>
			<div class="app-pane__actions">
				<slot name="actions" />
			</div>
		</header>
		<div v-if="$slots.toolbar" class="app-pane__toolbar">
			<slot name="toolbar" />
		</div>
		<div class="app-pane__body">
			<slot />
		</div>
		<footer v-if="$slots.footer" class="app-pane__footer">
			<slot name="footer" />
		</footer>
	</aside>
</template>

<style scoped>
/* The Teams list pane, styled like the Chat pane in teamslogic.theme.css */
.app-pane {
	display: flex;
	flex-direction: column;
	flex: 0 0 var(--navigation-width);
	width: var(--navigation-width);
	min-height: 0;
	background-color: var(--teamslogic-pane);
	border-inline-end: 1px solid var(--teamslogic-stroke);
}

.app-pane__header {
	display: flex;
	align-items: center;
	gap: 4px;
	min-height: 56px;
	padding: 12px 12px 8px 20px;
}

.app-pane__title {
	flex: 1 1 auto;
	margin: 0;
	color: var(--teamslogic-foreground-1);
	font-size: 18px;
	font-weight: 700;
	line-height: 32px;
}

.app-pane__actions {
	display: flex;
	gap: 4px;
}

.app-pane__toolbar {
	padding: 0 12px 8px;
}

.app-pane__body {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	padding: 0 8px 8px;
}

.app-pane__footer {
	padding: 8px 12px 12px;
	border-block-start: 1px solid var(--teamslogic-stroke);
}
</style>
