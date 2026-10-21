<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { Ref } from 'vue'

import { t } from '@nextcloud/l10n'
import { inject, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import { useShellStore } from '../../AppRail/shell.store.ts'

/*
 * Teams keeps its search in the title bar. TeamsLogic draws it there and drives the search box of the Talk
 * conversation list, which is hidden by the theme, so Talk still finds the conversations, people and messages.
 */

const TALK_SEARCH_INPUT = '#app-navigation-vue .conversations-search input'

const query = ref('')
const input = useTemplateRef('input')
const shellStore = useShellStore()

watch(query, (value) => {
	// The results are in the Chat list
	if (value) {
		shellStore.showApp('chat')
	}
	const talkInput = document.querySelector<HTMLInputElement>(TALK_SEARCH_INPUT)
	if (!talkInput || talkInput.value === value) {
		return
	}
	talkInput.value = value
	talkInput.dispatchEvent(new Event('input', { bubbles: true }))
})

// Talk ends its search when a result is opened, so follow it after each navigation
const isTalkInitialized = inject<Ref<boolean>>('talk:isInitialized')
watch(() => isTalkInitialized?.value, () => {
	window.OCA.Talk.instance.$router.afterEach(() => setTimeout(() => {
		query.value = document.querySelector<HTMLInputElement>(TALK_SEARCH_INPUT)?.value ?? ''
	}))
}, { once: true })

/**
 * Clear the search, also in Talk
 */
function clear() {
	query.value = ''
	input.value?.blur()
}

/**
 * Move Talk's own search focus (e.g. its Ctrl+F shortcut) and Teams' Ctrl+E to the title bar
 *
 * @param event - The event
 */
function redirectFocus(event: Event) {
	if (event instanceof KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
			event.preventDefault()
			input.value?.focus()
		}
	} else if ((event.target as HTMLElement).matches?.(TALK_SEARCH_INPUT)) {
		input.value?.focus()
	}
}

onMounted(() => {
	document.addEventListener('focusin', redirectFocus)
	document.addEventListener('keydown', redirectFocus)
})

onBeforeUnmount(() => {
	document.removeEventListener('focusin', redirectFocus)
	document.removeEventListener('keydown', redirectFocus)
})
</script>

<template>
	<form class="title-bar-search" role="search" @submit.prevent>
		<FluentIcon class="title-bar-search__icon" name="search" :size="20" />
		<input
			ref="input"
			v-model="query"
			class="title-bar-search__input"
			type="search"
			:placeholder="t('talk_desktop', 'Search')"
			:aria-label="t('talk_desktop', 'Search conversations, people and messages')"
			@keydown.esc="clear">
	</form>
</template>

<style scoped>
.title-bar-search {
	position: relative;
	display: flex;
	align-items: center;
	width: 100%;
	height: 32px;
	margin: 0;
	-webkit-app-region: no-drag;
}

.title-bar-search__icon {
	position: absolute;
	inset-inline-start: 10px;
	color: var(--teamslogic-foreground-3);
	pointer-events: none;
}

.title-bar-search__input {
	width: 100%;
	height: 100%;
	min-height: 0;
	margin: 0;
	padding-block: 0;
	padding-inline: 36px 10px;
	border: 1px solid transparent;
	border-radius: 4px;
	background-color: var(--teamslogic-surface);
	color: var(--teamslogic-foreground-1);
	font-size: 14px;
	box-shadow: none;
	cursor: text;

	&::placeholder {
		color: var(--teamslogic-foreground-3);
	}

	&:hover {
		border-color: var(--teamslogic-stroke-strong);
	}

	&:focus,
	&:focus-visible {
		border-color: var(--teamslogic-stroke-strong);
		border-block-end: 2px solid var(--teamslogic-brand-foreground);
		outline: none;
		box-shadow: none;
	}
}
</style>
