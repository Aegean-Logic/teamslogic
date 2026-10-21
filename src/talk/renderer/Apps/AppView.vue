<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { MessageItem } from './Mail/mail.service.ts'

import { defineAsyncComponent, onBeforeUnmount, reactive, watchEffect } from 'vue'
import { useShellStore } from '../AppRail/shell.store.ts'
import { useMailStore } from './Mail/mail.store.ts'

const APPS = {
	activity: defineAsyncComponent(() => import('./Activity/ActivityApp.vue')),
	mail: defineAsyncComponent(() => import('./Mail/MailApp.vue')),
	calendar: defineAsyncComponent(() => import('./Calendar/CalendarApp.vue')),
	calls: defineAsyncComponent(() => import('./Calls/CallsApp.vue')),
	files: defineAsyncComponent(() => import('./Files/FilesApp.vue')),
}

type AppId = keyof typeof APPS

const shellStore = useShellStore()

// Apps mount when first shown and stay mounted, hidden, to keep their state like Teams does
const visited = reactive(new Set<AppId>())
watchEffect(() => {
	if (shellStore.currentApp !== 'chat') {
		visited.add(shellStore.currentApp)
	}
})

// A new-mail notification or Activity item opens the message in Mail
const mailStore = useMailStore()
/**
 * Show a message in Mail
 *
 * @param event - teamslogic:mail:open with the message
 */
function openMail(event: Event) {
	shellStore.showApp('mail')
	mailStore.reveal((event as CustomEvent<MessageItem>).detail)
}
window.addEventListener('teamslogic:mail:open', openMail)
onBeforeUnmount(() => window.removeEventListener('teamslogic:mail:open', openMail))
</script>

<template>
	<main v-show="shellStore.currentApp !== 'chat'" class="app-view">
		<template v-for="(component, id) in APPS" :key="id">
			<component :is="component" v-if="visited.has(id)" v-show="shellStore.currentApp === id" />
		</template>
	</main>
</template>

<style scoped>
/* Placed like Talk's #content-vue in teamslogic.theme.css: a card on the chrome beside the rail */
.app-view {
	position: fixed;
	inset-block: var(--header-height) 0;
	inset-inline: var(--teamslogic-rail-width) 0;
	display: flex;
	overflow: hidden;
	border-start-start-radius: var(--border-radius-container);
	background-color: var(--teamslogic-stage);
	box-shadow: var(--teamslogic-shadow-2);
	color: var(--teamslogic-foreground-1);
}
</style>
