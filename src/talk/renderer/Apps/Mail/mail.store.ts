/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Address, MailAccount, Mailbox, MessageAttachment, MessageBody, MessageItem, OutgoingMessage } from './mail.service.ts'

import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { useUserStatusStore } from '../../UserStatus/userStatus.store.ts'
import {
	createMailbox,
	deleteMessage,
	deleteOutboxMessage,
	getMessageBody,
	isMailAvailable,
	listAccounts,
	listMailboxes,
	listMessages,
	moveMessage,
	queueMessage,
	sendOutboxMessage,
	setAccountFolders,
	setFlags,
	syncMailbox,
} from './mail.service.ts'

/** "All inboxes", or a folder id */
export type FolderSelection = 'unified' | number

export type MailFilter = 'all' | 'unread' | 'flagged' | 'mentions'

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward'

/** What the composer holds, kept to reopen it after an undone send */
export type ComposeDraft = {
	accountId: number
	to: Address[]
	cc: Address[]
	bcc: Address[]
	subject: string
	html: string
	attachments: { id: number, fileName: string }[]
	forwarded: MessageAttachment[]
	draftId: number | null
}

export type ComposeState = {
	mode: ComposeMode
	source: MessageBody | null
	draft?: ComposeDraft
}

/** Seconds to undo a send, as Outlook offers */
const UNDO_SECONDS = 5

const FILTERS: Record<MailFilter, string> = {
	all: '',
	unread: 'is:unread',
	flagged: 'is:starred',
	mentions: 'mentions:true',
}

const PAGE_SIZE = 40
const POLL_INTERVAL = 30000

/** Folder order of Outlook */
const ROLE_ORDER = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash']

/**
 * The special role of a folder
 *
 * @param mailbox - Folder
 */
export function folderRole(mailbox: Mailbox): string | null {
	return (mailbox.specialRole || mailbox.specialUse?.[0] || null) as string | null
}

export const useMailStore = defineStore('mail', () => {
	/** null until checked */
	const available = ref<boolean | null>(null)
	const accounts = ref<MailAccount[]>([])
	const mailboxes = ref<Record<number, Mailbox[]>>({})
	const selectedFolder = ref<FolderSelection>('unified')
	const filter = ref<MailFilter>('all')
	const search = ref('')
	const messages = shallowRef<MessageItem[]>([])
	const hasMore = ref(true)
	const loading = ref(false)
	const selectedId = ref<number | null>(null)
	const selectedBody = shallowRef<MessageBody | null>(null)
	/** The open message could not be loaded */
	const bodyFailed = ref(false)
	const compose = ref<ComposeState | null>(null)
	/** A sent message still in the outbox while the user can undo */
	const pendingSend = ref<{ outboxId: number, subject: string } | null>(null)
	let pendingTimer: number | undefined
	let pendingRestore: ComposeState | null = null
	/** New mail that arrived while the app runs, for Activity */
	const arrivals = shallowRef<{ message: MessageItem, receivedAt: Date }[]>([])

	let pollTimer: number | undefined
	const knownInboxIds = new Map<number, Set<number>>()

	const inboxes = computed(() => Object.values(mailboxes.value).flat().filter((mailbox) => folderRole(mailbox) === 'inbox'))

	const unreadCount = computed(() => inboxes.value.reduce((count, mailbox) => count + (mailbox.unread || 0), 0))

	const currentFolders = computed(() => selectedFolder.value === 'unified'
		? inboxes.value
		: Object.values(mailboxes.value).flat().filter((mailbox) => mailbox.databaseId === selectedFolder.value))

	const selectedMessage = computed(() => messages.value.find((message) => message.databaseId === selectedId.value) ?? null)

	/**
	 * Folders of an account in Outlook's order
	 *
	 * @param accountId - Account
	 */
	function foldersOf(accountId: number) {
		return [...(mailboxes.value[accountId] ?? [])].sort((a, b) => {
			const roleA = ROLE_ORDER.indexOf(folderRole(a) ?? '')
			const roleB = ROLE_ORDER.indexOf(folderRole(b) ?? '')
			return (roleA === -1 ? 99 : roleA) - (roleB === -1 ? 99 : roleB) || a.displayName.localeCompare(b.displayName)
		})
	}

	/**
	 * The account of a folder
	 *
	 * @param mailboxId - Folder
	 */
	function accountOf(mailboxId: number) {
		const accountId = Object.values(mailboxes.value).flat().find((mailbox) => mailbox.databaseId === mailboxId)?.accountId
		return accounts.value.find((account) => account.id === accountId) ?? null
	}

	/**
	 * A folder of an account by role
	 *
	 * @param accountId - Account
	 * @param role - Role, e.g. archive
	 */
	function folderByRole(accountId: number, role: string) {
		const account = accounts.value.find((item) => item.id === accountId)
		const configured = account && (account as unknown as Record<string, number | null>)[`${role}MailboxId`]
		return (mailboxes.value[accountId] ?? []).find((mailbox) => configured ? mailbox.databaseId === configured : folderRole(mailbox) === role) ?? null
	}

	/**
	 * Load accounts and folders
	 */
	async function loadAccounts() {
		accounts.value = await listAccounts()
		const entries = await Promise.all(accounts.value.map(async (account) => [account.id, await listMailboxes(account.id).catch(() => [])] as const))
		mailboxes.value = Object.fromEntries(entries)
	}

	/**
	 * Start: check Nextcloud Mail, load everything and poll for new mail
	 */
	async function init() {
		available.value = await isMailAvailable()
		if (!available.value) {
			return
		}
		await loadAccounts()
		await loadMessages()
		window.clearInterval(pollTimer)
		pollTimer = window.setInterval(poll, POLL_INTERVAL)
		poll()
	}

	/**
	 * The filter string for Mail
	 */
	function filterString() {
		const query = search.value.trim()
		// A bare word searches subject and sender, like Outlook's box
		const searchFilter = query && !/\w+:/.test(query) ? `match:anyof subject:${query} from:${query}` : query
		return [FILTERS[filter.value], searchFilter].filter(Boolean).join(' ')
	}

	/**
	 * Load the first page of the selected folder(s)
	 */
	async function loadMessages() {
		loading.value = true
		selectedId.value = null
		selectedBody.value = null
		try {
			const lists = await Promise.all(currentFolders.value.map((mailbox) => listMessages(mailbox.databaseId, { filter: filterString(), limit: PAGE_SIZE })))
			messages.value = lists.flat().sort((a, b) => b.dateInt - a.dateInt)
			hasMore.value = lists.some((list) => list.length === PAGE_SIZE)
		} catch (error) {
			console.error('Could not load messages', error)
			messages.value = []
		} finally {
			loading.value = false
		}
	}

	/**
	 * Load the next page
	 */
	async function loadMore() {
		if (loading.value || !hasMore.value || !messages.value.length) {
			return
		}
		loading.value = true
		try {
			const cursor = messages.value[messages.value.length - 1]!.dateInt
			const lists = await Promise.all(currentFolders.value.map((mailbox) => listMessages(mailbox.databaseId, { filter: filterString(), cursor, limit: PAGE_SIZE })))
			const known = new Set(messages.value.map((message) => message.databaseId))
			messages.value = [...messages.value, ...lists.flat().filter((message) => !known.has(message.databaseId))].sort((a, b) => b.dateInt - a.dateInt)
			hasMore.value = lists.some((list) => list.length === PAGE_SIZE)
		} finally {
			loading.value = false
		}
	}

	/**
	 * Show a folder
	 *
	 * @param folder - Folder, or all inboxes
	 */
	function selectFolder(folder: FolderSelection) {
		selectedFolder.value = folder
		compose.value = null
		loadMessages()
	}

	/**
	 * Change the quick filter
	 *
	 * @param value - Filter
	 */
	function setFilter(value: MailFilter) {
		filter.value = value
		loadMessages()
	}

	/**
	 * Search the selected folder(s)
	 *
	 * @param query - Text, or Mail filter syntax
	 */
	function setSearch(query: string) {
		search.value = query
		loadMessages()
	}

	/**
	 * Replace a message in the list with changes
	 *
	 * @param id - Message
	 * @param change - Changes
	 */
	function patchMessage(id: number, change: (message: MessageItem) => MessageItem) {
		messages.value = messages.value.map((message) => message.databaseId === id ? change(message) : message)
	}

	/**
	 * Change the unread count of a folder locally
	 *
	 * @param mailboxId - Folder
	 * @param delta - Change
	 */
	function adjustUnread(mailboxId: number, delta: number) {
		mailboxes.value = Object.fromEntries(Object.entries(mailboxes.value).map(([accountId, list]) => [accountId, list.map((mailbox) => mailbox.databaseId === mailboxId
			? { ...mailbox, unread: Math.max(0, (mailbox.unread || 0) + delta) }
			: mailbox)]))
	}

	/**
	 * Open a message in the reading pane and mark it read
	 *
	 * @param id - Message
	 */
	async function openMessage(id: number) {
		selectedId.value = id
		compose.value = null
		selectedBody.value = null
		bodyFailed.value = false
		try {
			const body = await getMessageBody(id)
			if (selectedId.value === id) {
				selectedBody.value = body
			}
			const item = messages.value.find((message) => message.databaseId === id)
			if (item && !item.flags.seen) {
				await markRead(item, true)
			}
		} catch (error) {
			console.error('Could not open the message', error)
			if (selectedId.value === id) {
				bodyFailed.value = true
			}
		}
	}

	/**
	 * Mark a message read or unread
	 *
	 * @param message - Message
	 * @param seen - Read
	 */
	async function markRead(message: MessageItem, seen: boolean) {
		patchMessage(message.databaseId, (item) => ({ ...item, flags: { ...item.flags, seen } }))
		adjustUnread(message.mailboxId, seen ? -1 : 1)
		await setFlags(message.databaseId, { seen })
	}

	/**
	 * Flag or unflag a message
	 *
	 * @param message - Message
	 */
	async function toggleFlag(message: MessageItem) {
		const flagged = !message.flags.flagged
		patchMessage(message.databaseId, (item) => ({ ...item, flags: { ...item.flags, flagged } }))
		await setFlags(message.databaseId, { flagged })
	}

	/**
	 * Take a message out of the list (after a move or delete) and select the next one
	 *
	 * @param message - Message
	 */
	function removeFromList(message: MessageItem) {
		const index = messages.value.findIndex((item) => item.databaseId === message.databaseId)
		messages.value = messages.value.filter((item) => item.databaseId !== message.databaseId)
		if (!message.flags.seen) {
			adjustUnread(message.mailboxId, -1)
		}
		if (selectedId.value === message.databaseId) {
			const next = messages.value[Math.min(index, messages.value.length - 1)]
			if (next) {
				openMessage(next.databaseId)
			} else {
				selectedId.value = null
				selectedBody.value = null
			}
		}
	}

	/**
	 * Move a message to a folder
	 *
	 * @param message - Message
	 * @param mailboxId - Folder
	 */
	async function move(message: MessageItem, mailboxId: number) {
		removeFromList(message)
		try {
			await moveMessage(message.databaseId, mailboxId)
		} catch (error) {
			console.error('Could not move the message', error)
			showError(t('talk_desktop', 'Could not move the message'))
			loadMessages()
		}
	}

	/**
	 * Move a message to the archive, junk or trash folder of its account
	 *
	 * @param message - Message
	 * @param role - archive, junk or trash
	 */
	async function moveToRole(message: MessageItem, role: 'archive' | 'junk' | 'trash') {
		const account = accountOf(message.mailboxId)
		const target = account && folderByRole(account.id, role)
		if (role === 'trash' && (!target || target.databaseId === message.mailboxId)) {
			// No trash, or already in it: Mail deletes for good
			removeFromList(message)
			await deleteMessage(message.databaseId)
			return
		}
		if (!target) {
			showError(role === 'archive' ? t('talk_desktop', 'This account has no archive folder') : t('talk_desktop', 'This account has no junk folder'))
			return
		}
		if (role === 'junk') {
			await setFlags(message.databaseId, { $junk: true }).catch(() => {})
		}
		await move(message, target.databaseId)
	}

	/**
	 * Start writing
	 *
	 * @param mode - New, reply, reply all or forward
	 */
	function startCompose(mode: ComposeMode) {
		compose.value = { mode, source: mode === 'new' ? null : selectedBody.value }
	}

	/**
	 * Put a message in the outbox and send it after a few seconds, unless the user undoes it
	 *
	 * @param message - The message
	 * @param restore - The composer to reopen on undo
	 */
	async function sendWithUndo(message: OutgoingMessage, restore: ComposeState) {
		await flushPendingSend()
		await ensureSentFolder(message.accountId)
		const outboxId = await queueMessage(message)
		compose.value = null
		pendingRestore = restore
		pendingSend.value = { outboxId, subject: message.subject }
		pendingTimer = window.setTimeout(flushPendingSend, UNDO_SECONDS * 1000)
	}

	/**
	 * Mail only sends from accounts with a Sent folder (its web UI asks for one): use the server's, or create it
	 *
	 * @param accountId - Account
	 */
	async function ensureSentFolder(accountId: number) {
		if (folderByRole(accountId, 'sent')) {
			return
		}
		const existing = (mailboxes.value[accountId] ?? []).find((mailbox) => /^(sent|sent items|sent messages)$/i.test(mailbox.displayName))
		const sent = existing ?? await createMailbox(accountId, 'Sent')
		await setAccountFolders(accountId, { sentMailboxId: sent.databaseId })
		await loadAccounts()
	}

	/**
	 * Send the message waiting for undo now
	 */
	async function flushPendingSend() {
		window.clearTimeout(pendingTimer)
		const pending = pendingSend.value
		if (!pending) {
			return
		}
		pendingSend.value = null
		pendingRestore = null
		try {
			await sendOutboxMessage(pending.outboxId)
			showSuccess(t('talk_desktop', 'Message sent'))
			// The sent copy appears in Sent Items
			loadAccounts().then(() => {
				if (selectedFolder.value !== 'unified') {
					loadMessages()
				}
			})
		} catch (error) {
			console.error('Could not send the message', error)
			showError(t('talk_desktop', '"{subject}" could not be sent. It is still in the outbox.', { subject: pending.subject }, undefined, { escape: false, sanitize: false }))
		}
	}

	/**
	 * Take the message back and reopen it
	 */
	async function undoSend() {
		window.clearTimeout(pendingTimer)
		const pending = pendingSend.value
		const restore = pendingRestore
		pendingSend.value = null
		pendingRestore = null
		if (!pending) {
			return
		}
		await deleteOutboxMessage(pending.outboxId).catch(() => {})
		compose.value = restore
	}

	/**
	 * Fetch new mail of the inboxes and the open folder
	 */
	async function poll() {
		if (!available.value) {
			return
		}
		const folders = new Map([...inboxes.value, ...currentFolders.value].map((mailbox) => [mailbox.databaseId, mailbox]))
		for (const mailbox of folders.values()) {
			const isInbox = folderRole(mailbox) === 'inbox'
			const isShown = currentFolders.value.some((item) => item.databaseId === mailbox.databaseId)
			const known = knownInboxIds.get(mailbox.databaseId)
			const listedIds = messages.value.filter((message) => message.mailboxId === mailbox.databaseId).map((message) => message.databaseId)
			let result
			try {
				result = await syncMailbox(mailbox.databaseId, [...new Set([...(known ?? []), ...listedIds])], !known)
			} catch (error) {
				console.debug('Mail sync failed', mailbox.displayName, error)
				continue
			}
			if (!result) {
				continue
			}
			if (isInbox) {
				if (known) {
					const fresh = result.newMessages.filter((message) => !known.has(message.databaseId) && !message.flags.seen)
					announce(fresh)
				}
				knownInboxIds.set(mailbox.databaseId, new Set([...(known ?? []), ...listedIds, ...result.newMessages.map((message) => message.databaseId)]))
			}
			if (isShown && !search.value && filter.value === 'all') {
				const listed = new Set(listedIds)
				const added = result.newMessages.filter((message) => !listed.has(message.databaseId))
				const changed = new Map(result.changedMessages.map((message) => [message.databaseId, message]))
				const vanished = new Set(result.vanishedMessages)
				messages.value = [...added, ...messages.value]
					.filter((message) => message.mailboxId !== mailbox.databaseId || !vanished.has(message.databaseId))
					.map((message) => changed.get(message.databaseId) ?? message)
					.sort((a, b) => b.dateInt - a.dateInt)
			}
			adjustUnread(mailbox.databaseId, (result.stats?.unread ?? mailbox.unread) - mailbox.unread)
		}
	}

	/**
	 * Tell the user about new mail: a native notification and an Activity item, like Outlook's
	 *
	 * @param fresh - New messages
	 */
	function announce(fresh: MessageItem[]) {
		if (!fresh.length) {
			return
		}
		arrivals.value = [...fresh.map((message) => ({ message, receivedAt: new Date() })), ...arrivals.value].slice(0, 50)
		if (useUserStatusStore().isDnd) {
			return
		}
		for (const message of fresh.slice(0, 3)) {
			const sender = message.from[0]?.label || message.from[0]?.email || t('talk_desktop', 'Unknown sender')
			const notification = new Notification(sender, { body: message.subject || t('talk_desktop', 'No subject'), silent: false })
			notification.addEventListener('click', () => {
				window.TALK_DESKTOP.focusTalk()
				window.dispatchEvent(new CustomEvent('teamslogic:mail:open', { detail: message }))
			})
		}
	}

	/**
	 * Show a message (from a notification or Activity): its folder, then the message
	 *
	 * @param message - Message
	 */
	async function reveal(message: MessageItem) {
		if (selectedFolder.value !== 'unified' && selectedFolder.value !== message.mailboxId) {
			selectedFolder.value = message.mailboxId
		}
		filter.value = 'all'
		search.value = ''
		await loadMessages()
		await openMessage(message.databaseId)
	}

	return {
		available,
		accounts,
		mailboxes,
		selectedFolder,
		filter,
		search,
		messages,
		hasMore,
		loading,
		selectedId,
		selectedBody,
		bodyFailed,
		selectedMessage,
		compose,
		pendingSend,
		arrivals,
		inboxes,
		unreadCount,
		foldersOf,
		accountOf,
		folderByRole,
		init,
		loadAccounts,
		loadMessages,
		loadMore,
		selectFolder,
		setFilter,
		setSearch,
		openMessage,
		markRead,
		toggleFlag,
		move,
		moveToRole,
		startCompose,
		sendWithUndo,
		undoSend,
		poll,
		reveal,
	}
})
