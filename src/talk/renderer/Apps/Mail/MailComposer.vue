<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { Address, MessageAttachment, OutgoingMessage } from './mail.service.ts'
import type { ComposeDraft } from './mail.store.ts'

import { showError } from '@nextcloud/dialogs'
import { getCanonicalLocale, t } from '@nextcloud/l10n'
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import RecipientInput from './RecipientInput.vue'
import { deleteDraft, saveDraft, uploadAttachment } from './mail.service.ts'
import { useMailStore } from './mail.store.ts'

const mailStore = useMailStore()
const locale = getCanonicalLocale()
const editor = useTemplateRef('editor')
const fileInput = useTemplateRef('fileInput')

const compose = mailStore.compose!
const source = compose.source

const ownAddresses = computed(() => new Set(mailStore.accounts.flatMap((account) => [account.emailAddress, ...account.aliases.map((alias) => alias.alias)]).map((email) => email.toLowerCase())))

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!)

/**
 * The account the message goes from: the one it answers, else the open folder's, else the first
 */
function defaultAccountId() {
	const folder = source ? source.mailboxId : (mailStore.selectedFolder === 'unified' ? null : mailStore.selectedFolder)
	return (folder && mailStore.accountOf(folder)?.id) || mailStore.accounts[0]?.id || 0
}

/**
 * Start values from the mode, as Outlook fills them
 */
function initialDraft(): ComposeDraft {
	if (compose.draft) {
		return compose.draft
	}
	const accountId = defaultAccountId()
	const signature = mailStore.accounts.find((account) => account.id === accountId)?.signature
	const signatureHtml = signature ? `<p><br></p><div class="signature">-- <br>${signature}</div>` : ''
	if (!source) {
		return { accountId, to: [], cc: [], bcc: [], subject: '', html: `<p><br></p>${signatureHtml}`, attachments: [], forwarded: [], draftId: null }
	}

	const notMe = (address: Address) => !ownAddresses.value.has(address.email.toLowerCase())
	const sender = (source.replyTo?.length ? source.replyTo : source.from)
	const original = source.hasHtmlBody ? source.body : escapeHtml(source.body).replace(/\n/g, '<br>')
	const when = new Date(source.dateInt * 1000).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
	const from = source.from.map((person) => person.label || person.email).join(', ')

	if (compose.mode === 'forward') {
		const header = `<p><b>${t('talk_desktop', 'From:')}</b> ${escapeHtml(from)}<br><b>${t('talk_desktop', 'Sent:')}</b> ${escapeHtml(when)}<br><b>${t('talk_desktop', 'To:')}</b> ${escapeHtml(source.to.map((person) => person.label || person.email).join('; '))}<br><b>${t('talk_desktop', 'Subject:')}</b> ${escapeHtml(source.subject)}</p>`
		return {
			accountId,
			to: [],
			cc: [],
			bcc: [],
			subject: /^fw(d)?:/i.test(source.subject) ? source.subject : `FW: ${source.subject}`,
			html: `<p><br></p>${signatureHtml}<hr>${header}${original}`,
			attachments: [],
			forwarded: source.attachments,
			draftId: null,
		}
	}

	const quote = `<p><br></p>${signatureHtml}<p>${escapeHtml(t('talk_desktop', 'On {date}, {sender} wrote:', { date: when, sender: from }, undefined, { escape: false, sanitize: false }))}</p><blockquote style="margin:0 0 0 8px;padding-left:8px;border-left:2px solid #c8c8c8">${original}</blockquote>`
	return {
		accountId,
		to: compose.mode === 'replyAll' ? [...sender, ...source.to.filter(notMe)].filter((address, index, all) => all.findIndex((item) => item.email === address.email) === index) : sender,
		cc: compose.mode === 'replyAll' ? source.cc.filter(notMe) : [],
		bcc: [],
		subject: /^re:/i.test(source.subject) ? source.subject : `RE: ${source.subject}`,
		html: quote,
		attachments: [],
		forwarded: [],
		draftId: null,
	}
}

const startDraft = initialDraft()
const draft = ref<ComposeDraft>(startDraft)
const showCc = ref(startDraft.cc.length > 0 || startDraft.bcc.length > 0)
const uploading = ref(0)
const sending = ref(false)
let saveTimer: number | undefined

const title = computed(() => ({
	new: t('talk_desktop', 'New message'),
	reply: t('talk_desktop', 'Reply'),
	replyAll: t('talk_desktop', 'Reply all'),
	forward: t('talk_desktop', 'Forward'),
})[compose.mode])

const canSend = computed(() => draft.value.to.length + draft.value.cc.length + draft.value.bcc.length > 0 && !uploading.value && !sending.value)

/**
 * The message as Nextcloud Mail takes it
 */
function toOutgoing(): OutgoingMessage {
	const html = editor.value?.innerHTML ?? draft.value.html
	return {
		accountId: draft.value.accountId,
		subject: draft.value.subject,
		bodyHtml: html,
		bodyPlain: editor.value?.innerText ?? '',
		to: draft.value.to,
		cc: draft.value.cc,
		bcc: draft.value.bcc,
		attachments: [
			...draft.value.attachments.map((attachment) => ({ id: attachment.id, type: 'local' as const, fileName: attachment.fileName })),
			// Mail copies these from the original message on the IMAP server
			...draft.value.forwarded.map((attachment) => ({ id: attachment.id, type: 'message-attachment', fileName: attachment.fileName, mime: attachment.mime, uid: source?.uid, mailboxId: source?.mailboxId, messageId: source?.databaseId })),
		] as OutgoingMessage['attachments'],
		inReplyToMessageId: compose.mode === 'reply' || compose.mode === 'replyAll' ? source?.messageId ?? null : null,
		draftId: draft.value.draftId,
	}
}

/**
 * Keep a draft on the server a moment after each change, like Outlook
 */
function scheduleSave() {
	window.clearTimeout(saveTimer)
	saveTimer = window.setTimeout(async () => {
		if (sending.value) {
			return
		}
		try {
			draft.value.draftId = await saveDraft(toOutgoing(), draft.value.draftId)
		} catch (error) {
			console.debug('Could not save the draft', error)
		}
	}, 3000)
}

watch(() => [draft.value.to, draft.value.cc, draft.value.bcc, draft.value.subject, draft.value.attachments], scheduleSave, { deep: true })

/**
 * Apply a text format to the selection
 *
 * @param command - execCommand name
 */
function format(command: string) {
	editor.value?.focus()
	document.execCommand(command)
	scheduleSave()
}

/**
 * Attach files from the computer
 *
 * @param files - Files
 */
async function attach(files: FileList | null) {
	for (const file of files ?? []) {
		uploading.value++
		try {
			const uploaded = await uploadAttachment(file)
			draft.value.attachments = [...draft.value.attachments, { id: uploaded.id, fileName: uploaded.fileName || file.name }]
		} catch (error) {
			console.error('Could not attach the file', error)
			showError(t('talk_desktop', 'Could not attach {file}', { file: file.name }, undefined, { escape: false, sanitize: false }))
		} finally {
			uploading.value--
		}
	}
}

/**
 * Send, with a few seconds to undo
 */
async function send() {
	if (!canSend.value) {
		return
	}
	sending.value = true
	window.clearTimeout(saveTimer)
	draft.value.html = editor.value?.innerHTML ?? draft.value.html
	try {
		await mailStore.sendWithUndo(toOutgoing(), { mode: compose.mode, source, draft: { ...draft.value } })
	} catch (error) {
		console.error('Could not send', error)
		showError(t('talk_desktop', 'The message could not be sent'))
		sending.value = false
	}
}

/**
 * Throw the message away
 */
async function discard() {
	window.clearTimeout(saveTimer)
	if (draft.value.draftId) {
		await deleteDraft(draft.value.draftId).catch(() => {})
	}
	mailStore.compose = null
}

onMounted(() => {
	if (editor.value) {
		editor.value.innerHTML = draft.value.html
	}
	// Replies start in the body, new mail in To
	if (compose.mode === 'reply' || compose.mode === 'replyAll') {
		editor.value?.focus()
	}
})

onBeforeUnmount(() => window.clearTimeout(saveTimer))
</script>

<template>
	<section class="composer" @keydown.ctrl.enter="send">
		<header class="composer__toolbar">
			<NcButton variant="primary" :disabled="!canSend" @click="send">
				<template #icon>
					<FluentIcon name="send" :size="20" />
				</template>
				{{ t('talk_desktop', 'Send') }}
			</NcButton>
			<span class="composer__title">{{ title }}</span>
			<span class="composer__spacer" />
			<button class="composer__tool" :title="t('talk_desktop', 'Bold')" @mousedown.prevent="format('bold')">
				<FluentIcon name="bold" :size="20" />
			</button>
			<button class="composer__tool" :title="t('talk_desktop', 'Italic')" @mousedown.prevent="format('italic')">
				<FluentIcon name="italic" :size="20" />
			</button>
			<button class="composer__tool" :title="t('talk_desktop', 'Underline')" @mousedown.prevent="format('underline')">
				<FluentIcon name="underline" :size="20" />
			</button>
			<button class="composer__tool" :title="t('talk_desktop', 'Bullets')" @mousedown.prevent="format('insertUnorderedList')">
				<FluentIcon name="bulletList" :size="20" />
			</button>
			<button class="composer__tool" :title="t('talk_desktop', 'Numbering')" @mousedown.prevent="format('insertOrderedList')">
				<FluentIcon name="numberList" :size="20" />
			</button>
			<button class="composer__tool" :title="t('talk_desktop', 'Attach file')" @click="fileInput?.click()">
				<FluentIcon name="attach" :size="20" />
			</button>
			<input
				ref="fileInput"
				class="hidden-visually"
				type="file"
				multiple
				@change="attach(($event.target as HTMLInputElement).files); ($event.target as HTMLInputElement).value = ''">
			<button class="composer__tool" :title="t('talk_desktop', 'Discard')" @click="discard">
				<FluentIcon name="trash" :size="20" />
			</button>
		</header>

		<div class="composer__fields">
			<label v-if="mailStore.accounts.length > 1" class="composer__from">
				<span>{{ t('talk_desktop', 'From') }}</span>
				<select v-model="draft.accountId">
					<option v-for="account in mailStore.accounts" :key="account.id" :value="account.id">
						{{ account.name }} &lt;{{ account.emailAddress }}&gt;
					</option>
				</select>
			</label>
			<div class="composer__row">
				<RecipientInput v-model="draft.to" class="composer__recipients" :label="t('talk_desktop', 'To')" />
				<button v-if="!showCc" class="composer__cc-toggle" @click="showCc = true">
					{{ t('talk_desktop', 'Cc & Bcc') }}
				</button>
			</div>
			<template v-if="showCc">
				<RecipientInput v-model="draft.cc" :label="t('talk_desktop', 'Cc')" />
				<RecipientInput v-model="draft.bcc" :label="t('talk_desktop', 'Bcc')" />
			</template>
			<input
				v-model="draft.subject"
				class="composer__subject"
				type="text"
				:placeholder="t('talk_desktop', 'Add a subject')">
		</div>

		<ul v-if="draft.attachments.length || draft.forwarded.length || uploading" class="composer__attachments">
			<li v-for="attachment in draft.attachments" :key="`local-${attachment.id}`">
				<FluentIcon name="attach" :size="16" />
				{{ attachment.fileName }}
				<button :aria-label="t('talk_desktop', 'Remove {file}', { file: attachment.fileName }, undefined, { escape: false, sanitize: false })" @click="draft.attachments = draft.attachments.filter((item) => item !== attachment)">
					<FluentIcon name="dismiss" :size="12" />
				</button>
			</li>
			<li v-for="attachment in draft.forwarded" :key="`forwarded-${attachment.id}`">
				<FluentIcon name="attach" :size="16" />
				{{ attachment.fileName }}
				<button :aria-label="t('talk_desktop', 'Remove {file}', { file: attachment.fileName }, undefined, { escape: false, sanitize: false })" @click="draft.forwarded = draft.forwarded.filter((item: MessageAttachment) => item !== attachment)">
					<FluentIcon name="dismiss" :size="12" />
				</button>
			</li>
			<li v-if="uploading" class="composer__uploading">
				{{ t('talk_desktop', 'Attaching…') }}
			</li>
		</ul>

		<div
			ref="editor"
			class="composer__editor"
			contenteditable="true"
			role="textbox"
			aria-multiline="true"
			:aria-label="t('talk_desktop', 'Message body')"
			@input="scheduleSave" />
	</section>
</template>

<style scoped>
.composer {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	background-color: var(--teamslogic-surface);
}

.composer__toolbar {
	display: flex;
	align-items: center;
	gap: 4px;
	min-height: 48px;
	padding: 0 12px;
	border-block-end: 1px solid var(--teamslogic-stroke);
}

.composer__title {
	margin-inline-start: 8px;
	color: var(--teamslogic-foreground-3);
	font-size: 13px;
}

.composer__spacer {
	flex: 1 1 auto;
}

.composer__tool {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	min-height: 0;
	margin: 0;
	padding: 0;
	border: none;
	border-radius: var(--border-radius-element);
	background: none;
	color: var(--teamslogic-foreground-2);
	cursor: pointer;

	&:hover {
		background-color: var(--color-background-hover);
		color: var(--teamslogic-brand-foreground);
	}
}

.composer__fields {
	display: flex;
	flex-direction: column;
	padding: 4px 20px 0;
}

.composer__from {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 36px;
	border-block-end: 1px solid var(--teamslogic-stroke);

	span {
		width: 48px;
		color: var(--teamslogic-foreground-3);
		font-size: 13px;
	}

	select {
		min-height: 0;
		height: 30px;
		margin: 0;
		border: none;
		background: none;
		font-size: 14px;
	}
}

.composer__row {
	display: flex;
	align-items: center;
}

.composer__recipients {
	flex: 1 1 auto;
}

.composer__cc-toggle {
	min-height: 0;
	margin: 0;
	padding: 4px 8px;
	border: none;
	background: none;
	color: var(--teamslogic-brand-foreground);
	font-size: 13px;
	font-weight: 400;
	cursor: pointer;
}

.composer__subject {
	width: 100%;
	height: 40px;
	min-height: 0;
	margin: 0;
	padding: 0;
	border: none !important;
	border-block-end: 1px solid var(--teamslogic-stroke) !important;
	border-radius: 0;
	background: none;
	box-shadow: none !important;
	font-size: 16px;
	font-weight: 600;
	outline: none;
}

.composer__attachments {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin: 0;
	padding: 8px 20px 0;
	list-style: none;

	li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 6px 4px 8px;
		border: 1px solid var(--teamslogic-stroke-strong);
		border-radius: var(--border-radius-element);
		font-size: 13px;
	}

	button {
		display: flex;
		width: 18px;
		height: 18px;
		min-height: 0;
		align-items: center;
		justify-content: center;
		margin: 0;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
	}
}

.composer__uploading {
	color: var(--teamslogic-foreground-3);
}

.composer__editor {
	flex: 1 1 auto;
	align-self: stretch;
	/* Nextcloud's server styles size and frame [contenteditable] boxes; this is the page */
	width: auto !important;
	min-height: 160px;
	margin: 0 !important;
	border: none !important;
	border-radius: 0 !important;
	background: none !important;
	overflow-y: auto;
	padding: 12px 20px 20px;
	font-size: 14px;
	line-height: 1.5;
	outline: none;

	:deep(blockquote) {
		color: var(--teamslogic-foreground-2);
	}
}
</style>
