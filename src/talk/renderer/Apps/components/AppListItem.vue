<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
defineProps<{
	active?: boolean
	unread?: boolean
}>()

defineEmits<{
	click: [event: MouseEvent]
}>()
</script>

<template>
	<li class="app-list-item" :class="{ 'app-list-item--active': active, 'app-list-item--unread': unread }">
		<button class="app-list-item__button" :aria-current="active ? 'true' : undefined" @click="$emit('click', $event)">
			<span v-if="$slots.icon" class="app-list-item__icon">
				<slot name="icon" />
			</span>
			<span class="app-list-item__main">
				<span class="app-list-item__title">
					<slot name="title" />
				</span>
				<span v-if="$slots.subtitle" class="app-list-item__subtitle">
					<slot name="subtitle" />
				</span>
			</span>
			<span v-if="$slots.details" class="app-list-item__details">
				<slot name="details" />
			</span>
		</button>
		<span v-if="$slots.actions" class="app-list-item__actions">
			<slot name="actions" />
		</span>
	</li>
</template>

<style scoped>
/* A Teams list row: the same look as the conversations in the Chat pane */
.app-list-item {
	position: relative;
	display: flex;
	align-items: center;
	padding-block: 1px;
	list-style: none;
}

.app-list-item__button {
	display: flex;
	align-items: center;
	gap: 12px;
	width: 100%;
	min-height: 48px;
	margin: 0;
	padding: 6px 8px;
	border: none;
	border-radius: var(--border-radius-element);
	background: none;
	color: var(--teamslogic-foreground-1);
	font-size: 14px;
	font-weight: 400;
	text-align: start;
	cursor: pointer;

	&:hover {
		background-color: var(--teamslogic-pane-hover);
	}

	&:focus-visible {
		outline: 2px solid var(--teamslogic-foreground-1);
		outline-offset: -2px;
	}
}

.app-list-item--active .app-list-item__button {
	background-color: var(--teamslogic-surface);
	box-shadow: var(--teamslogic-shadow-2);
}

.app-list-item__icon {
	display: flex;
	flex: 0 0 auto;
	align-items: center;
	justify-content: center;
}

.app-list-item__main {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	min-width: 0;
}

.app-list-item__title,
.app-list-item__subtitle {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.app-list-item__subtitle,
.app-list-item__details {
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}

.app-list-item--unread .app-list-item__title {
	font-weight: 600;
}

.app-list-item__details {
	display: flex;
	flex: 0 0 auto;
	flex-direction: column;
	align-items: flex-end;
	gap: 4px;
	align-self: flex-start;
}

/* Row actions appear on hover, as in Teams */
.app-list-item__actions {
	position: absolute;
	inset-inline-end: 8px;
	display: none;
}

.app-list-item:hover .app-list-item__actions,
.app-list-item:focus-within .app-list-item__actions {
	display: flex;
}
</style>
