<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { FluentIconName } from '../../AppRail/fluentIcons.ts'
import type { ActivityCategory, ActivityFilter, ServerNotification } from './activity.store.ts'

import { t } from '@nextcloud/l10n'
import { computed, ref, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import AppListItem from '../components/AppListItem.vue'
import AppPane from '../components/AppPane.vue'
import AppStage from '../components/AppStage.vue'
import { useShellStore } from '../../AppRail/shell.store.ts'
import { formatDateTime, formatListTime, openInBrowser } from '../apps.utils.ts'
import { useFilesStore } from '../Files/files.store.ts'
import { useAppShown } from '../useAppShown.ts'
import { getCategory, getTalkTarget, useActivityStore } from './activity.store.ts'

const activityStore = useActivityStore()
const shellStore = useShellStore()
const filesStore = useFilesStore()

const FILTERS: { id: ActivityFilter, label: string }[] = [
	{ id: 'all', label: t('talk_desktop', 'All') },
	{ id: 'unread', label: t('talk_desktop', 'Unread') },
	{ id: 'mention', label: t('talk_desktop', '@Mentions') },
	{ id: 'reaction', label: t('talk_desktop', 'Reactions') },
	{ id: 'call', label: t('talk_desktop', 'Calls') },
]

const CATEGORY_ICONS: Partial<Record<ActivityCategory, FluentIconName>> = {
	mention: 'mention',
	reply: 'chatSmall',
	call: 'callMissed',
	share: 'share',
}

const filter = ref<ActivityFilter>('all')
const selectedId = ref<number | null>(null)

const items = computed(() => activityStore.notifications.filter((notification) => {
	switch (filter.value) {
		case 'all':
			return true
		case 'unread':
			return !activityStore.isRead(notification)
		default:
			return getCategory(notification) === filter.value
	}
}))

const selected = computed(() => activityStore.notifications.find((notification) => notification.notificationId === selectedId.value) ?? null)

// Looking at Activity clears the rail badge, also for what arrives while it is open
activityStore.markAllSeen()
useAppShown('activity', () => activityStore.markAllSeen())
watch(() => activityStore.notifications, () => {
	if (shellStore.currentApp === 'activity') {
		activityStore.markAllSeen()
	}
})

/**
 * Split a rich string ("{user} mentioned you in {call}") into text and bold parameter parts
 *
 * @param rich - Rich string
 * @param parameters - Its parameters
 * @param fallback - Plain text when there is no rich string
 */
function richParts(rich: string, parameters: ServerNotification['subjectRichParameters'], fallback: string) {
	if (!rich) {
		return [{ text: fallback, bold: false }]
	}
	return rich.split(/(\{[^}]+\})/).filter(Boolean).map((part) => {
		const parameter = part.startsWith('{') ? parameters?.[part.slice(1, -1)] : undefined
		return parameter ? { text: parameter.name, bold: parameter.type !== 'highlight' } : { text: part, bold: false }
	})
}

/**
 * The user who caused a notification, for its avatar
 *
 * @param notification - Notification
 */
function getActor(notification: ServerNotification) {
	return Object.values(notification.subjectRichParameters ?? {}).find((parameter) => parameter.type === 'user')
}

/**
 * Plain message text of a notification
 *
 * @param notification - Notification
 */
function getMessage(notification: ServerNotification) {
	return richParts(notification.messageRich, notification.messageRichParameters, notification.message).map((part) => part.text).join('')
}

/**
 * Open a notification: Talk items in Chat, shares in Files, anything else in its detail pane
 *
 * @param notification - Notification
 */
function open(notification: ServerNotification) {
	activityStore.markRead(notification)

	const talkTarget = getTalkTarget(notification)
	if (talkTarget) {
		shellStore.openChat(talkTarget.token, { messageId: talkTarget.messageId })
		return
	}

	selectedId.value = notification.notificationId
}

/**
 * Go to what a notification is about
 *
 * @param notification - Notification
 */
function goTo(notification: ServerNotification) {
	if (getCategory(notification) === 'share') {
		filesStore.openView('shared')
		shellStore.showApp('files')
		return
	}
	openInBrowser(notification.link)
}
</script>

<template>
	<div class="activity-app">
		<AppPane :title="t('talk_desktop', 'Activity')">
			<template #actions>
				<NcActions :aria-label="t('talk_desktop', 'More options')" variant="tertiary" forceMenu>
					<template #icon>
						<FluentIcon name="more" :size="20" />
					</template>
					<NcActionButton :disabled="!activityStore.notifications.length" closeAfterClick @click="activityStore.dismissAll()">
						<template #icon>
							<FluentIcon name="dismiss" :size="20" />
						</template>
						{{ t('talk_desktop', 'Dismiss all') }}
					</NcActionButton>
				</NcActions>
			</template>

			<template #toolbar>
				<div class="activity-app__filters" role="radiogroup" :aria-label="t('talk_desktop', 'Filter activity')">
					<button
						v-for="item in FILTERS"
						:key="item.id"
						class="activity-app__filter"
						:class="{ 'activity-app__filter--active': filter === item.id }"
						role="radio"
						:aria-checked="filter === item.id"
						@click="filter = item.id">
						{{ item.label }}
					</button>
				</div>
			</template>

			<ul v-if="items.length" class="activity-app__list">
				<AppListItem
					v-for="notification in items"
					:key="notification.notificationId"
					:active="notification.notificationId === selectedId"
					:unread="!activityStore.isRead(notification)"
					@click="open(notification)">
					<template #icon>
						<span class="activity-app__avatar">
							<NcAvatar
								v-if="getActor(notification)"
								:user="getActor(notification)!.id"
								:displayName="getActor(notification)!.name"
								:size="32"
								disableMenu
								disableTooltip />
							<img
								v-else
								class="activity-app__app-icon"
								:src="notification.icon"
								alt="">
							<span v-if="getCategory(notification) === 'reaction'" class="activity-app__badge">
								{{ notification.subjectRichParameters.reaction?.name }}
							</span>
							<span v-else-if="CATEGORY_ICONS[getCategory(notification)]" class="activity-app__badge" :class="`activity-app__badge--${getCategory(notification)}`">
								<FluentIcon :name="CATEGORY_ICONS[getCategory(notification)]!" :size="12" filled />
							</span>
						</span>
					</template>
					<template #title>
						<template v-for="(part, index) in richParts(notification.subjectRich, notification.subjectRichParameters, notification.subject)" :key="index">
							<strong v-if="part.bold">{{ part.text }}</strong>
							<template v-else>
								{{ part.text }}
							</template>
						</template>
					</template>
					<template v-if="getMessage(notification)" #subtitle>
						{{ getMessage(notification) }}
					</template>
					<template #details>
						<span>{{ formatListTime(new Date(notification.datetime)) }}</span>
						<span v-if="!activityStore.isRead(notification)" class="activity-app__unread-dot" :aria-label="t('talk_desktop', 'Unread')" />
					</template>
					<template #actions>
						<NcButton
							variant="tertiary"
							size="small"
							:aria-label="t('talk_desktop', 'Dismiss')"
							:title="t('talk_desktop', 'Dismiss')"
							@click.stop="activityStore.dismiss(notification)">
							<template #icon>
								<FluentIcon name="dismiss" :size="16" />
							</template>
						</NcButton>
					</template>
				</AppListItem>
			</ul>
			<NcEmptyContent
				v-else
				class="activity-app__empty"
				:name="filter === 'all' ? t('talk_desktop', 'No activity yet') : t('talk_desktop', 'Nothing here')"
				:description="t('talk_desktop', '@mentions, replies, reactions, missed calls and shares show up here.')">
				<template #icon>
					<FluentIcon name="activity" :size="48" />
				</template>
			</NcEmptyContent>
		</AppPane>

		<AppStage v-if="selected" :title="richParts(selected.subjectRich, selected.subjectRichParameters, selected.subject).map((part) => part.text).join('')">
			<template #actions>
				<NcButton variant="tertiary" @click="activityStore.dismiss(selected); selectedId = null">
					<template #icon>
						<FluentIcon name="dismiss" :size="20" />
					</template>
					{{ t('talk_desktop', 'Dismiss') }}
				</NcButton>
			</template>

			<article class="activity-app__detail">
				<p class="activity-app__detail-time">
					{{ formatDateTime(new Date(selected.datetime)) }}
				</p>
				<p v-if="getMessage(selected)" class="activity-app__detail-message">
					{{ getMessage(selected) }}
				</p>
				<div class="activity-app__detail-actions">
					<NcButton
						v-for="action in selected.actions"
						:key="action.label"
						:variant="action.primary ? 'primary' : 'secondary'"
						@click="activityStore.runAction(selected, action)">
						{{ action.label }}
					</NcButton>
					<NcButton v-if="selected.link || getCategory(selected) === 'share'" :variant="selected.actions.length ? 'secondary' : 'primary'" @click="goTo(selected)">
						<template #icon>
							<FluentIcon :name="getCategory(selected) === 'share' ? 'folder' : 'open'" :size="20" />
						</template>
						{{ getCategory(selected) === 'share' ? t('talk_desktop', 'Open in Files') : t('talk_desktop', 'Open') }}
					</NcButton>
				</div>
			</article>
		</AppStage>
		<AppStage v-else>
			<NcEmptyContent
				class="activity-app__empty"
				:name="t('talk_desktop', 'Stay on top of what\'s happening')"
				:description="t('talk_desktop', 'Select an activity to see it here. Chat activity opens the conversation.')">
				<template #icon>
					<FluentIcon name="activity" :size="48" />
				</template>
			</NcEmptyContent>
		</AppStage>
	</div>
</template>

<style scoped>
.activity-app {
	display: flex;
	flex: 1 1 auto;
	min-width: 0;
}

.activity-app__filters {
	display: flex;
	gap: 4px;
	overflow-x: auto;
	scrollbar-width: none;
}

.activity-app__filter {
	flex: 0 0 auto;
	min-height: 0;
	height: 28px;
	margin: 0;
	padding: 0 10px;
	border: 1px solid var(--teamslogic-stroke-strong);
	border-radius: 14px;
	background-color: var(--teamslogic-surface);
	color: var(--teamslogic-foreground-2);
	font-size: 12px;
	font-weight: 400;
	cursor: pointer;

	&:hover {
		border-color: var(--teamslogic-brand-foreground);
	}
}

.activity-app__filter--active {
	border-color: var(--teamslogic-brand-tint);
	background-color: var(--teamslogic-brand-tint);
	color: var(--teamslogic-brand-foreground);
	font-weight: 600;
}

.activity-app__list {
	margin: 0;
	padding: 0;
}

.activity-app__avatar {
	position: relative;
	display: flex;
	width: 32px;
	height: 32px;
}

.activity-app__app-icon {
	width: 32px;
	height: 32px;
	padding: 6px;
	border-radius: 50%;
	background-color: var(--teamslogic-surface);
	filter: var(--background-invert-if-dark);
}

.activity-app__badge {
	position: absolute;
	inset-block-end: -4px;
	inset-inline-end: -4px;
	display: flex;
	align-items: center;
	justify-content: center;
	min-width: 18px;
	height: 18px;
	border: 2px solid var(--teamslogic-pane);
	border-radius: 9px;
	background-color: var(--teamslogic-surface);
	color: var(--teamslogic-foreground-2);
	font-size: 10px;
	line-height: 1;
}

.activity-app__badge--mention,
.activity-app__badge--reply,
.activity-app__badge--share {
	background-color: var(--teamslogic-brand);
	color: #FFFFFF;
}

.activity-app__badge--call {
	background-color: var(--teamslogic-badge);
	color: #FFFFFF;
}

.activity-app__unread-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background-color: var(--teamslogic-brand-foreground);
}

.activity-app__empty {
	margin-block-start: 15vh;
	color: var(--teamslogic-foreground-3);
}

.activity-app__detail {
	max-width: 720px;
	margin: 20px;
	padding: 20px 24px;
	border-radius: var(--border-radius-element);
	background-color: var(--teamslogic-surface);
	box-shadow: var(--teamslogic-shadow-2);
}

.activity-app__detail-time {
	margin: 0 0 12px;
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}

.activity-app__detail-message {
	margin: 0 0 16px;
	white-space: pre-wrap;
}

.activity-app__detail-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
</style>
