<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { FluentIconName } from './fluentIcons.ts'
import type { ShellApp } from './shell.store.ts'

import { t } from '@nextcloud/l10n'
import { computed } from 'vue'
import FluentIcon from './FluentIcon.vue'
import { useActivityStore } from '../Apps/Activity/activity.store.ts'
import { useMailStore } from '../Apps/Mail/mail.store.ts'
import { unreadConversationsCount } from '../TalkWrapper/useBadgeCountIntegration.ts'
import { useShellStore } from './shell.store.ts'

const shellStore = useShellStore()
const activityStore = useActivityStore()
const mailStore = useMailStore()

/** The Teams apps, in Teams order */
const RAIL_APPS: { id: ShellApp, icon: FluentIconName, label: string }[] = [
	{ id: 'activity', icon: 'activity', label: t('talk_desktop', 'Activity') },
	{ id: 'chat', icon: 'chat', label: t('talk_desktop', 'Chat') },
	{ id: 'mail', icon: 'mail', label: t('talk_desktop', 'Mail') },
	{ id: 'calendar', icon: 'calendar', label: t('talk_desktop', 'Calendar') },
	{ id: 'todo', icon: 'taskList', label: t('talk_desktop', 'To Do') },
	{ id: 'people', icon: 'people', label: t('talk_desktop', 'People') },
	{ id: 'calls', icon: 'call', label: t('talk_desktop', 'Calls') },
	{ id: 'files', icon: 'files', label: t('talk_desktop', 'Files') },
]

const badges = computed<Partial<Record<ShellApp, number>>>(() => ({
	activity: shellStore.currentApp === 'activity' ? 0 : activityStore.unseenCount,
	chat: unreadConversationsCount.value,
	mail: mailStore.unreadCount,
}))

/**
 * Format a badge count like Teams
 *
 * @param count - The count
 */
function formatBadge(count: number) {
	return count > 99 ? '99+' : String(count)
}

// The conversation list header is drawn in CSS, so give it a translated title
document.documentElement.style.setProperty('--teamslogic-list-title', JSON.stringify(t('talk_desktop', 'Chat')))
</script>

<template>
	<nav class="app-rail" :aria-label="t('talk_desktop', 'Apps')">
		<button
			v-for="app in RAIL_APPS"
			:key="app.id"
			class="app-rail__item"
			:class="{ 'app-rail__item--active': shellStore.currentApp === app.id }"
			:aria-current="shellStore.currentApp === app.id ? 'page' : undefined"
			@click="shellStore.showApp(app.id)">
			<span class="app-rail__icon">
				<FluentIcon class="app-rail__icon-regular" :name="app.icon" />
				<FluentIcon class="app-rail__icon-filled" :name="app.icon" filled />
				<span v-if="badges[app.id]" class="app-rail__badge">{{ formatBadge(badges[app.id]!) }}</span>
				<span
					v-else-if="app.id === 'chat' && shellStore.callToken"
					class="app-rail__call-dot"
					:title="t('talk_desktop', 'Call in progress')" />
			</span>
			<span class="app-rail__label">{{ app.label }}</span>
		</button>
	</nav>
</template>

<style scoped>
.app-rail {
	position: fixed;
	/* Nextcloud fixes Talk's #content to the full window width, after the rail: stay above it, below the title bar (2000) */
	z-index: 1500;
	inset-block: var(--header-height) 0;
	inset-inline-start: 0;
	width: var(--teamslogic-rail-width);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	padding-block: 4px;
	background-color: var(--teamslogic-chrome);
	user-select: none;
}

.app-rail__item {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 2px;
	width: 100%;
	height: 56px;
	margin: 0;
	padding: 0;
	border: none;
	border-radius: 0;
	background: none;
	color: var(--teamslogic-foreground-2);
	cursor: pointer;

	&:hover,
	&:focus-visible {
		color: var(--teamslogic-brand-foreground);
	}

	&:focus-visible {
		outline: 2px solid var(--teamslogic-foreground-1);
		outline-offset: -2px;
		border-radius: 4px;
	}
}

.app-rail__item:hover,
.app-rail__item:focus-visible,
.app-rail__item--active {
	.app-rail__icon-regular {
		display: none;
	}

	.app-rail__icon-filled {
		display: block;
	}
}

.app-rail__item--active {
	color: var(--teamslogic-brand-foreground);

	.app-rail__label {
		font-weight: 600;
	}

	/* The Teams selection pill at the rail edge */
	&::before {
		content: '';
		position: absolute;
		inset-inline-start: 0;
		inset-block: 18px;
		width: 3px;
		border-start-end-radius: 2px;
		border-end-end-radius: 2px;
		background-color: var(--teamslogic-brand-foreground);
	}
}

.app-rail__icon {
	position: relative;
	display: flex;
}

.app-rail__icon-filled {
	display: none;
}

.app-rail__label {
	font-size: 10px;
	line-height: 12px;
}

.app-rail__badge {
	position: absolute;
	inset-block-start: -6px;
	inset-inline-start: 14px;
	min-width: 16px;
	height: 16px;
	padding-inline: 4px;
	border: 1px solid var(--teamslogic-chrome);
	border-radius: 8px;
	background-color: var(--teamslogic-badge);
	color: #FFFFFF;
	font-size: 10px;
	font-weight: 600;
	line-height: 14px;
	text-align: center;
	box-sizing: content-box;
}

.app-rail__call-dot {
	position: absolute;
	inset-block-start: -2px;
	inset-inline-end: -4px;
	width: 10px;
	height: 10px;
	border: 2px solid var(--teamslogic-chrome);
	border-radius: 50%;
	background-color: #13A10E;
}
</style>
