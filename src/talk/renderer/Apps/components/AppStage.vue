<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
defineProps<{
	title?: string
}>()
</script>

<template>
	<section class="app-stage">
		<header v-if="title || $slots.header || $slots.actions" class="app-stage__header">
			<slot name="header">
				<h2 class="app-stage__title">
					{{ title }}
				</h2>
			</slot>
			<div class="app-stage__actions">
				<slot name="actions" />
			</div>
		</header>
		<div class="app-stage__body">
			<slot />
		</div>
	</section>
</template>

<style scoped>
/* The main area of an app: a white header like the conversation header, the grey stage below */
.app-stage {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
}

.app-stage__header {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 56px;
	padding-inline: 20px 12px;
	background-color: var(--teamslogic-surface);
	border-block-end: 1px solid var(--teamslogic-stroke);
}

.app-stage__title {
	flex: 1 1 auto;
	min-width: 0;
	margin: 0;
	overflow: hidden;
	font-size: 18px;
	font-weight: 700;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.app-stage__actions {
	display: flex;
	flex: 0 0 auto;
	align-items: center;
	gap: 4px;
}

.app-stage__body {
	position: relative;
	flex: 1 1 auto;
	min-height: 0;
	overflow: auto;
}
</style>
