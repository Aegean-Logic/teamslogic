<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { MessageItem } from './mail.service.ts'
import type { MailFilter } from './mail.store.ts'

import { t } from '@nextcloud/l10n'
import { computed, ref, watch } from 'vue'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import { formatListTime } from '../apps.utils.ts'
import { folderRole, useMailStore } from './mail.store.ts'

const mailStore = useMailStore()

const FILTERS: { id: MailFilter, label: string }[] = [
	{ id: 'all', label: t('talk_desktop', 'All') },
	{ id: 'unread', label: t('talk_desktop', 'Unread') },
	{ id: 'flagged', label: t('talk_desktop', 'Flagged') },
	{ id: 'mentions', label: t('talk_desktop', '@Mentions') },
]

const query = ref(mailStore.search)
let searchTimer: number | undefined
watch(query, (value) => {
	window.clearTimeout(searchTimer)
	searchTimer = window.setTimeout(() => mailStore.setSearch(value), 400)
})

const title = computed(() => {
	if (mailStore.selectedFolder === 'unified') {
		return mailStore.accounts.length > 1 ? t('talk_desktop', 'All inboxes') : t('talk_desktop', 'Inbox')
	}
	const mailbox = Object.values(mailStore.mailboxes).flat().find((item) => item.databaseId === mailStore.selectedFolder)
	return mailbox ? (folderRole(mailbox) === 'inbox' ? t('talk_desktop', 'Inbox') : mailbox.displayName.split(mailbox.delimiter).pop()) : ''
})

/** In Sent and Drafts the list shows who it went to, like Outlook */
const showRecipients = computed(() => {
	const mailbox = Object.values(mailStore.mailboxes).flat().find((item) => item.databaseId === mailStore.selectedFolder)
	return mailbox ? ['sent', 'drafts'].includes(folderRole(mailbox) ?? '') : false
})

/**
 * Who a row names
 *
 * @param message - Message
 */
function correspondent(message: MessageItem) {
	const people = showRecipients.value ? message.to : message.from
	return people.map((person) => person.label || person.email).join(', ') || t('talk_desktop', '(No sender)')
}

/**
 * Load more when scrolled near the end
 *
 * @param event - Scroll
 */
function onScroll(event: Event) {
	const list = event.target as HTMLElement
	if (list.scrollTop + list.clientHeight > list.scrollHeight - 200) {
		mailStore.loadMore()
	}
}
</script>

<template>
	<section class="message-list">
		<header class="message-list__header">
			<h2 class="message-list__title">
				{{ title }}
			</h2>
			<div class="message-list__search">
				<FluentIcon name="search" :size="16" class="message-list__search-icon" />
				<input
					v-model="query"
					type="search"
					:placeholder="t('talk_desktop', 'Search mail')"
					:aria-label="t('talk_desktop', 'Search mail')">
			</div>
			<div class="message-list__filters" role="radiogroup" :aria-label="t('talk_desktop', 'Filter')">
				<button
					v-for="item in FILTERS"
					:key="item.id"
					class="message-list__filter"
					:class="{ 'message-list__filter--active': mailStore.filter === item.id }"
					role="radio"
					:aria-checked="mailStore.filter === item.id"
					@click="mailStore.setFilter(item.id)">
					{{ item.label }}
				</button>
			</div>
		</header>

		<ul v-if="mailStore.messages.length" class="message-list__items" @scroll="onScroll">
			<li
				v-for="message in mailStore.messages"
				:key="message.databaseId"
				class="message-list__item"
				:class="{
					'message-list__item--unread': !message.flags.seen,
					'message-list__item--selected': message.databaseId === mailStore.selectedId,
				}">
				<button class="message-list__open" @click="mailStore.openMessage(message.databaseId)">
					<NcAvatar
						class="message-list__avatar"
						:displayName="(showRecipients ? message.to[0] : message.from[0])?.label || (showRecipients ? message.to[0] : message.from[0])?.email || '?'"
						:size="32"
						isNoUser
						disableMenu
						disableTooltip />
					<span class="message-list__main">
						<span class="message-list__line">
							<span class="message-list__from">{{ correspondent(message) }}</span>
							<span class="message-list__time">{{ formatListTime(new Date(message.dateInt * 1000)) }}</span>
						</span>
						<span class="message-list__line">
							<span class="message-list__subject">{{ message.subject || t('talk_desktop', '(No subject)') }}</span>
							<span v-if="message.thread && message.thread.length > 1" class="message-list__thread-count">{{ message.thread.length }}</span>
							<FluentIcon
								v-if="message.flags.hasAttachments"
								name="attach"
								:size="16"
								class="message-list__icon" />
							<FluentIcon
								v-if="message.flags.flagged"
								name="flag"
								:size="16"
								filled
								class="message-list__icon message-list__icon--flag" />
						</span>
						<span class="message-list__preview">{{ message.previewText }}</span>
					</span>
				</button>
				<span class="message-list__actions">
					<button :title="message.flags.seen ? t('talk_desktop', 'Mark as unread') : t('talk_desktop', 'Mark as read')" @click="mailStore.markRead(message, !message.flags.seen)">
						<FluentIcon :name="message.flags.seen ? 'mailUnread' : 'mailRead'" :size="16" />
					</button>
					<button :title="message.flags.flagged ? t('talk_desktop', 'Clear flag') : t('talk_desktop', 'Flag')" @click="mailStore.toggleFlag(message)">
						<FluentIcon name="flag" :size="16" :filled="message.flags.flagged" />
					</button>
					<button :title="t('talk_desktop', 'Delete')" @click="mailStore.moveToRole(message, 'trash')">
						<FluentIcon name="trash" :size="16" />
					</button>
				</span>
			</li>
			<li v-if="mailStore.loading" class="message-list__more">
				<NcLoadingIcon :size="20" />
			</li>
		</ul>
		<NcEmptyContent
			v-else-if="!mailStore.loading"
			class="message-list__empty"
			:name="mailStore.search || mailStore.filter !== 'all' ? t('talk_desktop', 'No matching messages') : t('talk_desktop', 'All caught up')"
			:description="mailStore.search || mailStore.filter !== 'all' ? '' : t('talk_desktop', 'There\'s nothing in this folder.')">
			<template #icon>
				<FluentIcon name="mail" :size="48" />
			</template>
		</NcEmptyContent>
		<div v-else class="message-list__more">
			<NcLoadingIcon :size="32" />
		</div>
	</section>
</template>

<style scoped>
.message-list {
	display: flex;
	flex: 0 0 360px;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	background-color: var(--teamslogic-surface);
	border-inline-end: 1px solid var(--teamslogic-stroke);
}

.message-list__header {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px 12px 8px;
	border-block-end: 1px solid var(--teamslogic-stroke);
}

.message-list__title {
	margin: 0;
	padding-inline: 4px;
	font-size: 18px;
	font-weight: 700;
	line-height: 32px;
}

.message-list__search {
	position: relative;
	display: flex;
	align-items: center;

	input {
		width: 100%;
		height: 32px;
		min-height: 0;
		margin: 0;
		padding-inline: 32px 8px;
		border: 1px solid var(--teamslogic-stroke-strong);
		border-radius: var(--border-radius-element);
		background-color: var(--teamslogic-surface);
		font-size: 14px;
	}
}

.message-list__search-icon {
	position: absolute;
	inset-inline-start: 10px;
	color: var(--teamslogic-foreground-3);
	pointer-events: none;
}

.message-list__filters {
	display: flex;
	gap: 4px;
}

.message-list__filter {
	min-height: 0;
	height: 26px;
	margin: 0;
	padding: 0 10px;
	border: none;
	border-radius: 13px;
	background: none;
	color: var(--teamslogic-foreground-2);
	font-size: 12px;
	font-weight: 400;
	cursor: pointer;

	&:hover {
		background-color: var(--color-background-hover);
	}
}

.message-list__filter--active {
	background-color: var(--teamslogic-brand-tint);
	color: var(--teamslogic-brand-foreground);
	font-weight: 600;
}

.message-list__items {
	flex: 1 1 auto;
	min-height: 0;
	margin: 0;
	padding: 0;
	overflow-y: auto;
	list-style: none;
}

.message-list__item {
	position: relative;
	border-block-end: 1px solid var(--teamslogic-stroke);

	&:hover {
		background-color: var(--color-background-hover);

		.message-list__actions {
			display: flex;
		}

		.message-list__time {
			visibility: hidden;
		}
	}
}

/* Outlook's unread bar */
.message-list__item--unread::before {
	content: '';
	position: absolute;
	inset-block: 0;
	inset-inline-start: 0;
	width: 3px;
	background-color: var(--teamslogic-brand-foreground);
}

.message-list__item--selected {
	background-color: var(--teamslogic-brand-tint) !important;
}

.message-list__open {
	display: flex;
	gap: 10px;
	width: 100%;
	min-height: 0;
	margin: 0;
	padding: 10px 12px 10px 14px;
	border: none;
	border-radius: 0;
	background: none;
	color: var(--teamslogic-foreground-1);
	font-size: 14px;
	font-weight: 400;
	text-align: start;
	cursor: pointer;
}

.message-list__avatar {
	flex: 0 0 auto;
}

.message-list__main {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	gap: 1px;
	min-width: 0;
}

.message-list__line {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}

.message-list__from,
.message-list__subject,
.message-list__preview {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.message-list__from {
	flex: 1 1 auto;
}

.message-list__subject {
	flex: 1 1 auto;
	font-size: 13px;
}

.message-list__item--unread {
	.message-list__from,
	.message-list__subject {
		font-weight: 600;
	}

	.message-list__subject {
		color: var(--teamslogic-brand-foreground);
	}
}

.message-list__preview,
.message-list__time {
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}

.message-list__time {
	flex: 0 0 auto;
}

.message-list__thread-count {
	padding: 0 6px;
	border-radius: 8px;
	background-color: var(--color-background-dark);
	font-size: 11px;
}

.message-list__icon {
	flex: 0 0 auto;
	color: var(--teamslogic-foreground-3);
}

.message-list__icon--flag {
	color: var(--teamslogic-badge);
}

.message-list__actions {
	position: absolute;
	top: 6px;
	inset-inline-end: 8px;
	display: none;
	gap: 2px;

	button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		min-height: 0;
		margin: 0;
		padding: 0;
		border: none;
		border-radius: var(--border-radius-element);
		background-color: var(--teamslogic-surface);
		color: var(--teamslogic-foreground-2);
		cursor: pointer;

		&:hover {
			color: var(--teamslogic-brand-foreground);
		}
	}
}

.message-list__more {
	display: flex;
	justify-content: center;
	padding: 12px;
}

.message-list__empty {
	margin-block-start: 12vh;
}
</style>
