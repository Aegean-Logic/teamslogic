<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { Address, MessageAttachment } from './mail.service.ts'

import { showError, showSuccess } from '@nextcloud/dialogs'
import { getCanonicalLocale, t } from '@nextcloud/l10n'
import { computed, ref, useTemplateRef } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import { formatFileSize } from '../apps.utils.ts'
import { createFolder, uploadFile } from '../Files/files.service.ts'
import { getHtmlUrl } from './mail.service.ts'
import { folderRole, useMailStore } from './mail.store.ts'

const mailStore = useMailStore()
const locale = getCanonicalLocale()
const frame = useTemplateRef('frame')
const frameHeight = ref(200)

const body = computed(() => mailStore.selectedBody)
const item = computed(() => mailStore.selectedMessage)

const moveTargets = computed(() => {
	const account = item.value && mailStore.accountOf(item.value.mailboxId)
	return account ? mailStore.foldersOf(account.id).filter((mailbox) => mailbox.databaseId !== item.value!.mailboxId) : []
})

/**
 * People as "Name <email>"
 *
 * @param people - Addresses
 */
function names(people: Address[]) {
	return people.map((person) => person.label && person.label !== person.email ? `${person.label} <${person.email}>` : person.email).join('; ')
}

/**
 * Fit the frame to the message, which is same-origin (scripts stay off)
 */
function fitFrame() {
	const document = frame.value?.contentDocument
	if (!document?.documentElement) {
		return
	}
	// Links open in the browser, outside the sandbox
	for (const link of document.querySelectorAll('a[href]')) {
		link.setAttribute('target', '_blank')
	}
	document.body.style.margin = '0'
	document.body.style.fontFamily = 'Segoe UI, system-ui, sans-serif'
	document.body.style.fontSize = '14px'
	document.body.style.color = '#242424'
	frameHeight.value = document.documentElement.scrollHeight + 16
	new ResizeObserver(() => {
		frameHeight.value = document.documentElement.scrollHeight + 16
	}).observe(document.body)
}

/**
 * Save an attachment to the computer
 *
 * @param attachment - Attachment
 */
function download(attachment: MessageAttachment) {
	window.TALK_DESKTOP.downloadURL(attachment.downloadUrl, attachment.fileName)
}

/**
 * Save an attachment into Files, in "Mail attachments"
 *
 * @param attachment - Attachment
 */
async function saveToFiles(attachment: MessageAttachment) {
	try {
		const content = await (await fetch(attachment.downloadUrl, { headers: { 'OCS-APIRequest': 'true' } })).blob()
		await createFolder('/Mail attachments').catch(() => {})
		const name = await uploadFile('/Mail attachments', new File([content], attachment.fileName, { type: attachment.mime }), () => {})
		showSuccess(t('talk_desktop', 'Saved to Files as Mail attachments/{file}', { file: name }, undefined, { escape: false, sanitize: false }))
	} catch (error) {
		console.error('Could not save the attachment', error)
		showError(t('talk_desktop', 'Could not save {file} to Files', { file: attachment.fileName }, undefined, { escape: false, sanitize: false }))
	}
}
</script>

<template>
	<section class="reading-pane">
		<template v-if="item">
			<header class="reading-pane__toolbar">
				<NcButton variant="tertiary" @click="mailStore.startCompose('reply')">
					<template #icon>
						<FluentIcon name="reply" :size="20" />
					</template>
					{{ t('talk_desktop', 'Reply') }}
				</NcButton>
				<NcButton variant="tertiary" @click="mailStore.startCompose('replyAll')">
					<template #icon>
						<FluentIcon name="replyAll" :size="20" />
					</template>
					{{ t('talk_desktop', 'Reply all') }}
				</NcButton>
				<NcButton variant="tertiary" @click="mailStore.startCompose('forward')">
					<template #icon>
						<FluentIcon name="forward" :size="20" />
					</template>
					{{ t('talk_desktop', 'Forward') }}
				</NcButton>
				<span class="reading-pane__spacer" />
				<NcButton
					v-if="item && mailStore.folderByRole(mailStore.accountOf(item.mailboxId)?.id ?? -1, 'archive')"
					variant="tertiary"
					:aria-label="t('talk_desktop', 'Archive')"
					:title="t('talk_desktop', 'Archive')"
					@click="mailStore.moveToRole(item, 'archive')">
					<template #icon>
						<FluentIcon name="archive" :size="20" />
					</template>
				</NcButton>
				<NcButton
					variant="tertiary"
					:aria-label="t('talk_desktop', 'Delete')"
					:title="t('talk_desktop', 'Delete')"
					@click="mailStore.moveToRole(item, 'trash')">
					<template #icon>
						<FluentIcon name="trash" :size="20" />
					</template>
				</NcButton>
				<NcButton
					variant="tertiary"
					:aria-label="item.flags.flagged ? t('talk_desktop', 'Clear flag') : t('talk_desktop', 'Flag')"
					:title="item.flags.flagged ? t('talk_desktop', 'Clear flag') : t('talk_desktop', 'Flag')"
					@click="mailStore.toggleFlag(item)">
					<template #icon>
						<FluentIcon name="flag" :size="20" :filled="item.flags.flagged" />
					</template>
				</NcButton>
				<NcActions :aria-label="t('talk_desktop', 'More actions')" variant="tertiary" forceMenu>
					<template #icon>
						<FluentIcon name="more" :size="20" />
					</template>
					<NcActionButton closeAfterClick @click="mailStore.markRead(item, false)">
						<template #icon>
							<FluentIcon name="mailUnread" :size="20" />
						</template>
						{{ t('talk_desktop', 'Mark as unread') }}
					</NcActionButton>
					<NcActionButton v-if="mailStore.folderByRole(mailStore.accountOf(item.mailboxId)?.id ?? -1, 'junk')" closeAfterClick @click="mailStore.moveToRole(item, 'junk')">
						<template #icon>
							<FluentIcon name="junk" :size="20" />
						</template>
						{{ t('talk_desktop', 'Move to Junk') }}
					</NcActionButton>
					<NcActionButton
						v-for="mailbox in moveTargets"
						:key="mailbox.databaseId"
						closeAfterClick
						@click="mailStore.move(item, mailbox.databaseId)">
						<template #icon>
							<FluentIcon name="moveTo" :size="20" />
						</template>
						{{ t('talk_desktop', 'Move to {folder}', { folder: folderRole(mailbox) === 'inbox' ? t('talk_desktop', 'Inbox') : mailbox.displayName }, undefined, { escape: false, sanitize: false }) }}
					</NcActionButton>
				</NcActions>
			</header>

			<div class="reading-pane__scroll">
				<h2 class="reading-pane__subject">
					{{ item.subject || t('talk_desktop', '(No subject)') }}
				</h2>

				<div class="reading-pane__card">
					<div class="reading-pane__from">
						<NcAvatar
							:displayName="item.from[0]?.label || item.from[0]?.email || '?'"
							:size="40"
							isNoUser
							disableMenu
							disableTooltip />
						<div class="reading-pane__people">
							<strong>{{ item.from[0]?.label || item.from[0]?.email }}</strong>
							<span v-if="item.from[0]?.label" class="reading-pane__muted"> &lt;{{ item.from[0]?.email }}&gt;</span>
							<div class="reading-pane__muted">
								{{ t('talk_desktop', 'To: {people}', { people: names(item.to) }, undefined, { escape: false, sanitize: false }) }}
							</div>
							<div v-if="item.cc.length" class="reading-pane__muted">
								{{ t('talk_desktop', 'Cc: {people}', { people: names(item.cc) }, undefined, { escape: false, sanitize: false }) }}
							</div>
						</div>
						<span class="reading-pane__muted reading-pane__date">
							{{ new Date(item.dateInt * 1000).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }}
						</span>
					</div>

					<ul v-if="body?.attachments.length" class="reading-pane__attachments">
						<li v-for="attachment in body.attachments" :key="attachment.id" class="reading-pane__attachment">
							<img :src="attachment.mimeUrl" alt="">
							<span class="reading-pane__attachment-name">
								{{ attachment.fileName }}
								<span v-if="attachment.size" class="reading-pane__muted">{{ formatFileSize(attachment.size) }}</span>
							</span>
							<NcActions :aria-label="t('talk_desktop', 'Attachment actions')" variant="tertiary" forceMenu>
								<template #icon>
									<FluentIcon name="more" :size="16" />
								</template>
								<NcActionButton closeAfterClick @click="download(attachment)">
									<template #icon>
										<FluentIcon name="download" :size="20" />
									</template>
									{{ t('talk_desktop', 'Download') }}
								</NcActionButton>
								<NcActionButton closeAfterClick @click="saveToFiles(attachment)">
									<template #icon>
										<FluentIcon name="folder" :size="20" />
									</template>
									{{ t('talk_desktop', 'Save to Files') }}
								</NcActionButton>
							</NcActions>
						</li>
					</ul>

					<p v-if="mailStore.bodyFailed" class="reading-pane__muted">
						{{ t('talk_desktop', 'This message couldn\'t be opened. The mail server did not return it.') }}
					</p>
					<div v-else-if="!body" class="reading-pane__loading">
						<NcLoadingIcon :size="32" />
					</div>
					<iframe
						v-else-if="body.hasHtmlBody"
						ref="frame"
						:key="body.databaseId"
						class="reading-pane__frame"
						:style="{ height: `${frameHeight}px` }"
						:src="getHtmlUrl(body.databaseId)"
						sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
						:title="t('talk_desktop', 'Message')"
						@load="fitFrame" />
					<div v-else class="reading-pane__plain">
						{{ body.body }}
					</div>
				</div>
			</div>
		</template>

		<NcEmptyContent
			v-else
			class="reading-pane__empty"
			:name="t('talk_desktop', 'Select an item to read')"
			:description="t('talk_desktop', 'Nothing is selected')">
			<template #icon>
				<FluentIcon name="mail" :size="48" />
			</template>
		</NcEmptyContent>
	</section>
</template>

<style scoped>
.reading-pane {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
}

.reading-pane__toolbar {
	display: flex;
	align-items: center;
	gap: 2px;
	min-height: 48px;
	padding: 0 12px;
	background-color: var(--teamslogic-surface);
	border-block-end: 1px solid var(--teamslogic-stroke);
}

.reading-pane__spacer {
	flex: 1 1 auto;
}

.reading-pane__scroll {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	padding: 16px 20px 24px;
}

.reading-pane__subject {
	margin: 0 0 12px;
	font-size: 20px;
	font-weight: 600;
	overflow-wrap: anywhere;
}

.reading-pane__card {
	padding: 16px 20px;
	border-radius: var(--border-radius-element);
	background-color: var(--teamslogic-surface);
	box-shadow: var(--teamslogic-shadow-2);
}

.reading-pane__from {
	display: flex;
	align-items: flex-start;
	gap: 12px;
	margin-block-end: 16px;
}

.reading-pane__people {
	flex: 1 1 auto;
	min-width: 0;
	overflow-wrap: anywhere;
}

.reading-pane__muted {
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}

.reading-pane__date {
	flex: 0 0 auto;
}

.reading-pane__attachments {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin: 0 0 16px;
	padding: 0;
	list-style: none;
}

.reading-pane__attachment {
	display: flex;
	align-items: center;
	gap: 8px;
	max-width: 280px;
	padding: 4px 4px 4px 8px;
	border: 1px solid var(--teamslogic-stroke-strong);
	border-radius: var(--border-radius-element);

	img {
		width: 24px;
		height: 24px;
	}
}

.reading-pane__attachment-name {
	display: flex;
	flex-direction: column;
	min-width: 0;
	overflow: hidden;
	font-size: 13px;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.reading-pane__frame {
	display: block;
	width: 100%;
	border: none;
	/* Messages are written for white paper, also in dark mode */
	background-color: #FFFFFF;
	border-radius: 2px;
}

.reading-pane__plain {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.reading-pane__loading {
	display: flex;
	justify-content: center;
	padding: 24px;
}

.reading-pane__empty {
	margin-block-start: 20vh;
}
</style>
