<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import AccountsDialog from './AccountsDialog.vue'
import FolderPane from './FolderPane.vue'
import MailComposer from './MailComposer.vue'
import MessageList from './MessageList.vue'
import ReadingPane from './ReadingPane.vue'
import { useAppShown } from '../useAppShown.ts'
import { useMailStore } from './mail.store.ts'

const mailStore = useMailStore()
const accountsOpen = ref(false)

if (mailStore.available === null) {
	mailStore.init()
}

// Showing Mail fetches new mail right away
useAppShown('mail', () => mailStore.poll())

/**
 * Outlook's keyboard shortcuts for the open message
 *
 * @param event - Key
 */
function onKeydown(event: KeyboardEvent) {
	const target = event.target as HTMLElement
	if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || mailStore.compose) {
		return
	}
	const message = mailStore.selectedMessage
	if (!message) {
		return
	}
	const key = event.key.toLowerCase()
	if (event.ctrlKey && event.shiftKey && key === 'r') {
		mailStore.startCompose('replyAll')
	} else if (event.ctrlKey && event.shiftKey && key === 'f') {
		mailStore.startCompose('forward')
	} else if (event.ctrlKey && key === 'r') {
		mailStore.startCompose('reply')
	} else if (event.ctrlKey && key === 'q') {
		mailStore.markRead(message, true)
	} else if (event.ctrlKey && key === 'u') {
		mailStore.markRead(message, false)
	} else if (event.key === 'Delete') {
		mailStore.moveToRole(message, 'trash')
	} else {
		return
	}
	event.preventDefault()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
	<div class="mail-app">
		<NcEmptyContent v-if="mailStore.available === null" class="mail-app__empty" :name="t('talk_desktop', 'Loading your mail…')">
			<template #icon>
				<NcLoadingIcon :size="48" />
			</template>
		</NcEmptyContent>

		<NcEmptyContent
			v-else-if="!mailStore.available"
			class="mail-app__empty"
			:name="t('talk_desktop', 'Mail isn\'t set up on your server')"
			:description="t('talk_desktop', 'TeamsLogic reads and sends email through the Nextcloud Mail app. Ask your administrator to install it (Apps, Mail), then come back here.')">
			<template #icon>
				<FluentIcon name="mail" :size="48" />
			</template>
		</NcEmptyContent>

		<NcEmptyContent
			v-else-if="!mailStore.accounts.length"
			class="mail-app__empty"
			:name="t('talk_desktop', 'Add your email')"
			:description="t('talk_desktop', 'Connect a Gmail, Microsoft 365, Outlook.com, Exchange or other email account to read and send mail here.')">
			<template #icon>
				<FluentIcon name="mail" :size="48" />
			</template>
			<template #action>
				<NcButton variant="primary" @click="accountsOpen = true">
					<template #icon>
						<FluentIcon name="add" :size="20" />
					</template>
					{{ t('talk_desktop', 'Add account') }}
				</NcButton>
			</template>
		</NcEmptyContent>

		<template v-else>
			<FolderPane @accounts="accountsOpen = true" />
			<MessageList />
			<MailComposer v-if="mailStore.compose" :key="`${mailStore.compose.mode}-${mailStore.compose.source?.databaseId ?? 'new'}`" />
			<ReadingPane v-else />
		</template>

		<div v-if="mailStore.pendingSend" class="mail-app__undo" role="status">
			<span>{{ t('talk_desktop', 'Sending "{subject}"…', { subject: mailStore.pendingSend.subject || t('talk_desktop', '(No subject)') }, undefined, { escape: false, sanitize: false }) }}</span>
			<NcButton variant="tertiary" @click="mailStore.undoSend()">
				{{ t('talk_desktop', 'Undo') }}
			</NcButton>
		</div>

		<AccountsDialog v-if="accountsOpen" :startAdding="!mailStore.accounts.length" @close="accountsOpen = false" />
	</div>
</template>

<style scoped>
.mail-app {
	position: relative;
	display: flex;
	flex: 1 1 auto;
	min-width: 0;
}

.mail-app__empty {
	flex: 1 1 auto;
	margin-block-start: 18vh;
}

.mail-app__undo {
	position: absolute;
	inset-block-end: 16px;
	inset-inline-start: 50%;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 6px 6px 6px 16px;
	transform: translateX(-50%);
	border-radius: var(--border-radius-element);
	background-color: var(--teamslogic-foreground-1);
	box-shadow: var(--teamslogic-shadow-4);
	color: var(--teamslogic-surface);
	font-size: 14px;

	:deep(.button-vue) {
		color: var(--teamslogic-surface) !important;
	}
}
</style>
