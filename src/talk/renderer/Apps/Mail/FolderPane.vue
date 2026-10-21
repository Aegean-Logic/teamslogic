<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { FluentIconName } from '../../AppRail/fluentIcons.ts'
import type { Mailbox } from './mail.service.ts'

import { t } from '@nextcloud/l10n'
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import AppListItem from '../components/AppListItem.vue'
import AppPane from '../components/AppPane.vue'
import { folderRole, useMailStore } from './mail.store.ts'

defineEmits<{
	accounts: []
}>()

const mailStore = useMailStore()
const collapsed = ref(new Set<number>())

const ROLE_ICONS: Record<string, FluentIconName> = {
	inbox: 'inbox',
	drafts: 'drafts',
	sent: 'send',
	archive: 'archive',
	junk: 'junk',
	trash: 'trash',
}

const ROLE_NAMES: Record<string, string> = {
	inbox: t('talk_desktop', 'Inbox'),
	drafts: t('talk_desktop', 'Drafts'),
	sent: t('talk_desktop', 'Sent Items'),
	archive: t('talk_desktop', 'Archive'),
	junk: t('talk_desktop', 'Junk Email'),
	trash: t('talk_desktop', 'Deleted Items'),
}

/**
 * Display name of a folder, with Outlook's names for the special ones
 *
 * @param mailbox - Folder
 */
function folderName(mailbox: Mailbox) {
	const role = folderRole(mailbox)
	return (role && ROLE_NAMES[role]) || mailbox.displayName.split(mailbox.delimiter).pop()
}

/**
 * Nesting depth of a folder
 *
 * @param mailbox - Folder
 */
function depth(mailbox: Mailbox) {
	return mailbox.delimiter ? mailbox.name.split(mailbox.delimiter).length - 1 : 0
}

/**
 * Collapse or expand an account
 *
 * @param accountId - Account
 */
function toggle(accountId: number) {
	const next = new Set(collapsed.value)
	if (!next.delete(accountId)) {
		next.add(accountId)
	}
	collapsed.value = next
}
</script>

<template>
	<AppPane :title="t('talk_desktop', 'Mail')" class="folder-pane">
		<template #toolbar>
			<NcButton variant="primary" wide @click="mailStore.startCompose('new')">
				<template #icon>
					<FluentIcon name="compose" :size="20" />
				</template>
				{{ t('talk_desktop', 'New mail') }}
			</NcButton>
		</template>

		<ul class="folder-pane__list">
			<AppListItem
				v-if="mailStore.accounts.length > 1"
				:active="mailStore.selectedFolder === 'unified'"
				:unread="mailStore.unreadCount > 0"
				@click="mailStore.selectFolder('unified')">
				<template #icon>
					<FluentIcon name="inbox" :size="20" :filled="mailStore.selectedFolder === 'unified'" />
				</template>
				<template #title>
					{{ t('talk_desktop', 'All inboxes') }}
				</template>
				<template v-if="mailStore.unreadCount" #details>
					<span class="folder-pane__count">{{ mailStore.unreadCount }}</span>
				</template>
			</AppListItem>

			<li v-for="account in mailStore.accounts" :key="account.id" class="folder-pane__account">
				<button class="folder-pane__account-head" :aria-expanded="!collapsed.has(account.id)" @click="toggle(account.id)">
					<FluentIcon
						name="chevronDown"
						:size="16"
						class="folder-pane__chevron"
						:class="{ 'folder-pane__chevron--closed': collapsed.has(account.id) }" />
					<span class="folder-pane__account-name">{{ account.emailAddress }}</span>
				</button>
				<ul v-show="!collapsed.has(account.id)" class="folder-pane__list">
					<AppListItem
						v-for="mailbox in mailStore.foldersOf(account.id)"
						:key="mailbox.databaseId"
						:style="{ paddingInlineStart: `${depth(mailbox) * 16}px` }"
						:active="mailStore.selectedFolder === mailbox.databaseId || (mailStore.accounts.length === 1 && mailStore.selectedFolder === 'unified' && folderRole(mailbox) === 'inbox')"
						:unread="mailbox.unread > 0"
						@click="mailStore.selectFolder(mailbox.databaseId)">
						<template #icon>
							<FluentIcon :name="ROLE_ICONS[folderRole(mailbox) ?? ''] ?? 'folder'" :size="20" />
						</template>
						<template #title>
							{{ folderName(mailbox) }}
						</template>
						<template v-if="mailbox.unread && folderRole(mailbox) !== 'sent'" #details>
							<span class="folder-pane__count">{{ mailbox.unread }}</span>
						</template>
					</AppListItem>
				</ul>
			</li>
		</ul>

		<template #footer>
			<NcButton variant="tertiary" wide @click="$emit('accounts')">
				<template #icon>
					<FluentIcon name="settings" :size="20" />
				</template>
				{{ t('talk_desktop', 'Accounts') }}
			</NcButton>
		</template>
	</AppPane>
</template>

<style scoped>
.folder-pane {
	--navigation-width: 260px;
}

.folder-pane__list {
	margin: 0;
	padding: 0;

	:deep(.app-list-item__button) {
		min-height: 36px;
		padding-block: 4px;
	}
}

.folder-pane__account {
	list-style: none;
	margin-block-start: 8px;
}

.folder-pane__account-head {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	min-height: 0;
	height: 32px;
	margin: 0;
	padding: 0 8px;
	border: none;
	background: none;
	color: var(--teamslogic-foreground-1);
	font-size: 14px;
	font-weight: 600;
	text-align: start;
	cursor: pointer;
}

.folder-pane__account-name {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.folder-pane__chevron {
	transition: transform 0.1s;
}

.folder-pane__chevron--closed {
	transform: rotate(-90deg);
}

.folder-pane__count {
	color: var(--teamslogic-brand-foreground);
	font-size: 12px;
	font-weight: 600;
}
</style>
