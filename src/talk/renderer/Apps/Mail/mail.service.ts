/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/*
 * Nextcloud Mail's HTTP API (the routes its own web UI uses, under /apps/mail/api).
 * The app's requests carry the app password and OCS-APIRequest, which these routes accept without a CSRF token.
 */

import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'

export type Address = {
	label: string
	email: string
}

export type MailAccount = {
	id: number
	name: string
	emailAddress: string
	authMethod: 'password' | 'xoauth2'
	imapHost: string
	signature: string | null
	draftsMailboxId: number | null
	sentMailboxId: number | null
	trashMailboxId: number | null
	archiveMailboxId: number | null
	junkMailboxId: number | null
	aliases: { id: number, alias: string, name: string }[]
}

export type Mailbox = {
	databaseId: number
	id: string
	name: string
	displayName: string
	accountId: number
	attributes: string[]
	delimiter: string
	specialUse: string[]
	specialRole: string | 0 | null
	unread: number
	cacheBuster: string
}

export type MessageFlags = {
	seen: boolean
	flagged: boolean
	answered: boolean
	forwarded: boolean
	draft: boolean
	hasAttachments: boolean
	important: boolean
}

export type MessageAttachment = {
	id: string
	fileName: string
	mime: string
	size?: number
	downloadUrl: string
	mimeUrl: string
	isImage?: boolean
}

export type MessageItem = {
	databaseId: number
	uid: number
	subject: string
	dateInt: number
	flags: MessageFlags
	from: Address[]
	to: Address[]
	cc: Address[]
	bcc: Address[]
	mailboxId: number
	messageId: string
	inReplyTo: string | null
	references: string[]
	threadRootId: string
	previewText: string
	mentionsMe: boolean | number
	attachments: MessageAttachment[]
	/** Messages of the thread when listed threaded */
	thread?: MessageItem[]
}

export type MessageBody = MessageItem & {
	body: string
	hasHtmlBody: boolean
	replyTo: Address[]
	attachments: MessageAttachment[]
	accountId: number
}

export type SyncResult = {
	newMessages: MessageItem[]
	changedMessages: MessageItem[]
	/** Database ids of known messages that left the folder */
	vanishedMessages: number[]
	stats: { total: number, unread: number }
}

export type OutgoingMessage = {
	accountId: number
	subject: string
	bodyPlain: string
	bodyHtml: string
	to: Address[]
	cc: Address[]
	bcc: Address[]
	/** Uploaded files ({ id, type: 'local' }) and attachments of a forwarded message ({ type: 'message-attachment' }) */
	attachments: Record<string, unknown>[]
	inReplyToMessageId?: string | null
	draftId?: number | null
}

const url = (path: string) => generateUrl('/apps/mail/api' + path)

/**
 * The JSend envelope some routes use ({ status, data })
 *
 * @param data - Response data
 */
function unwrap<T>(data: unknown): T {
	if (data && typeof data === 'object' && 'status' in data && 'data' in data) {
		return (data as { data: T }).data
	}
	return data as T
}

/**
 * Whether Nextcloud Mail is installed for the user
 */
export async function isMailAvailable(): Promise<boolean> {
	try {
		const response = await axios.get(url('/accounts'))
		return Array.isArray(unwrap(response.data))
	} catch {
		return false
	}
}

/**
 * The user's mail accounts
 */
export async function listAccounts(): Promise<MailAccount[]> {
	return unwrap<MailAccount[]>((await axios.get(url('/accounts'))).data)
}

/**
 * The folders of an account
 *
 * @param accountId - Account
 */
export async function listMailboxes(accountId: number): Promise<Mailbox[]> {
	const data = unwrap<{ mailboxes: Mailbox[] }>((await axios.get(url('/mailboxes'), { params: { accountId } })).data)
	return data.mailboxes
}

/**
 * Create a folder
 *
 * @param accountId - Account
 * @param name - Folder name
 */
export async function createMailbox(accountId: number, name: string): Promise<Mailbox> {
	return unwrap<Mailbox>((await axios.post(url('/mailboxes'), { accountId, name })).data)
}

/**
 * Tell Mail which folders an account uses for sent mail, drafts, archive, junk and trash
 *
 * @param accountId - Account
 * @param folders - Folder ids by role
 */
export async function setAccountFolders(accountId: number, folders: Partial<Record<'sentMailboxId' | 'draftsMailboxId' | 'archiveMailboxId' | 'junkMailboxId' | 'trashMailboxId', number>>) {
	await axios.patch(url(`/accounts/${accountId}`), folders)
}

/**
 * Messages of a folder, newest first, threads collapsed
 *
 * @param mailboxId - Folder
 * @param options - Options
 * @param options.filter - Mail filter, e.g. "is:unread subject:budget"
 * @param options.cursor - dateInt of the last message already listed, for the next page
 * @param options.limit - Page size (1–100)
 */
export async function listMessages(mailboxId: number, { filter = '', cursor, limit = 40 }: { filter?: string, cursor?: number, limit?: number } = {}): Promise<MessageItem[]> {
	const list = async () => unwrap<MessageItem[]>((await axios.get(url('/messages'), { params: { mailboxId, filter, cursor, limit, view: 'threaded' } })).data)
	try {
		return await list()
	} catch (error) {
		// 400: Mail has not cached the folder yet (MailboxNotCachedException), so fetch it from the server first
		if ((error as { response?: { status?: number } }).response?.status !== 400) {
			throw error
		}
		await syncMailbox(mailboxId, [], true)
		return await list()
	}
}

/**
 * Fetch new and changed messages of a folder from the mail server
 *
 * @param mailboxId - Folder
 * @param knownIds - Message ids already listed
 * @param init - First sync of the folder
 */
export async function syncMailbox(mailboxId: number, knownIds: number[], init = false): Promise<SyncResult | null> {
	const response = await axios.post(url(`/mailboxes/${mailboxId}/sync`), { ids: knownIds, lastMessageTimestamp: null, init, sortOrder: 'newest', query: null }, {
		// 202: the server is still syncing, the caller tries again later
		validateStatus: (status) => status === 200 || status === 202,
	})
	return response.status === 200 ? unwrap<SyncResult>(response.data) : null
}

/**
 * A message with its body
 *
 * @param id - Message
 */
export async function getMessageBody(id: number): Promise<MessageBody> {
	return unwrap<MessageBody>((await axios.get(url(`/messages/${id}/body`))).data)
}

/**
 * The messages of a thread
 *
 * @param id - A message of the thread
 */
export async function getThread(id: number): Promise<MessageItem[]> {
	return unwrap<MessageItem[]>((await axios.get(url(`/messages/${id}/thread`))).data)
}

/**
 * URL of the sanitized HTML of a message, for a sandboxed frame
 *
 * @param id - Message
 */
export function getHtmlUrl(id: number): string {
	return url(`/messages/${id}/html`)
}

/**
 * Change flags of a message
 *
 * @param id - Message
 * @param flags - Flags to set
 */
export async function setFlags(id: number, flags: Partial<Pick<MessageFlags, 'seen' | 'flagged'>> & { $junk?: boolean }) {
	await axios.put(url(`/messages/${id}/flags`), { flags })
}

/**
 * Move a message to another folder
 *
 * @param id - Message
 * @param destFolderId - Folder
 */
export async function moveMessage(id: number, destFolderId: number) {
	await axios.post(url(`/messages/${id}/move`), { destFolderId })
}

/**
 * Delete a message (into the trash, or for good when it is in the trash)
 *
 * @param id - Message
 */
export async function deleteMessage(id: number) {
	await axios.delete(url(`/messages/${id}`))
}

/**
 * Upload a file to attach to an outgoing message
 *
 * @param file - The file
 */
export async function uploadAttachment(file: File): Promise<{ id: number, fileName: string }> {
	const form = new FormData()
	form.append('attachment', file)
	return unwrap((await axios.post(url('/attachments'), form)).data)
}

/** Fields Mail's draft and outbox routes require: HTML mail, no S/MIME or PGP */
const MESSAGE_DEFAULTS = {
	isHtml: true,
	smimeSign: false,
	smimeEncrypt: false,
	requestMdn: false,
	isPgpMime: false,
}

/**
 * Save or update a draft
 *
 * @param message - The message
 * @param draftId - The draft to update
 */
export async function saveDraft(message: OutgoingMessage, draftId?: number | null): Promise<number> {
	const body = { ...message, ...MESSAGE_DEFAULTS, editorBody: message.bodyHtml }
	if (draftId) {
		await axios.put(url(`/drafts/${draftId}`), body)
		return draftId
	}
	return unwrap<{ id: number }>((await axios.post(url('/drafts'), body)).data).id
}

/**
 * Delete a draft
 *
 * @param draftId - The draft
 */
export async function deleteDraft(draftId: number) {
	await axios.delete(url(`/drafts/${draftId}`))
}

/**
 * Put a message in the outbox, to send with sendOutboxMessage
 *
 * @param message - The message
 */
export async function queueMessage(message: OutgoingMessage): Promise<number> {
	const body = { ...message, ...MESSAGE_DEFAULTS, editorBody: message.bodyHtml, sendAt: null }
	return unwrap<{ id: number }>((await axios.post(url('/outbox'), body)).data).id
}

/**
 * Send a message of the outbox now
 *
 * @param outboxId - Outbox message
 */
export async function sendOutboxMessage(outboxId: number) {
	await axios.post(url(`/outbox/${outboxId}`))
}

/**
 * Remove a message from the outbox (undo send)
 *
 * @param outboxId - Outbox message
 */
export async function deleteOutboxMessage(outboxId: number) {
	await axios.delete(url(`/outbox/${outboxId}`))
}

export type ServerSettings = {
	host: string
	port: number
	sslMode: 'none' | 'ssl' | 'tls'
	user: string
	password: string
}

/**
 * Find the IMAP and SMTP servers of an address the way Nextcloud Mail's setup does (ISPDB, then MX)
 *
 * @param email - Email address
 */
export async function discoverServers(email: string): Promise<{ imap?: Omit<ServerSettings, 'password'>, smtp?: Omit<ServerSettings, 'password'> } | null> {
	const domain = email.split('@')[1]
	if (!domain) {
		return null
	}
	type IspdbServer = { hostname: string, port: number, socketType: string, username: string }
	const fromIspdb = async (host: string) => {
		try {
			const data = unwrap<{ imapConfig?: IspdbServer[], smtpConfig?: IspdbServer[] }>((await axios.get(url(`/autoconfig/ispdb/${encodeURIComponent(host)}/${encodeURIComponent(email)}`))).data)
			const toSettings = (server?: IspdbServer) => server && {
				host: server.hostname,
				port: Number(server.port),
				sslMode: (server.socketType === 'SSL' ? 'ssl' : server.socketType === 'STARTTLS' ? 'tls' : 'none') as ServerSettings['sslMode'],
				user: server.username.replace('%EMAILADDRESS%', email).replace('%EMAILLOCALPART%', email.split('@')[0]!),
			}
			const imap = toSettings(data.imapConfig?.[0])
			return imap ? { imap, smtp: toSettings(data.smtpConfig?.[0]) } : null
		} catch {
			return null
		}
	}
	const direct = await fromIspdb(domain)
	if (direct) {
		return direct
	}
	try {
		const mxHosts = unwrap<string[]>((await axios.get(url(`/autoconfig/mx/${encodeURIComponent(email)}`))).data)
		for (const mx of mxHosts ?? []) {
			const viaMx = await fromIspdb(mx.split('.').slice(-2).join('.'))
			if (viaMx) {
				return viaMx
			}
		}
	} catch {
		// No MX lookup
	}
	return null
}

/**
 * Add an IMAP/SMTP account
 *
 * @param account - Account
 * @param account.name - Display name
 * @param account.email - Email address
 * @param account.imap - IMAP server
 * @param account.smtp - SMTP server
 */
export async function createAccount({ name, email, imap, smtp }: { name: string, email: string, imap: ServerSettings, smtp: ServerSettings }): Promise<MailAccount> {
	const response = await axios.post(url('/accounts'), {
		accountName: name,
		emailAddress: email,
		imapHost: imap.host,
		imapPort: imap.port,
		imapSslMode: imap.sslMode,
		imapUser: imap.user,
		imapPassword: imap.password,
		smtpHost: smtp.host,
		smtpPort: smtp.port,
		smtpSslMode: smtp.sslMode,
		smtpUser: smtp.user,
		smtpPassword: smtp.password,
		authMethod: 'password',
	})
	return unwrap<MailAccount>(response.data)
}

/**
 * Remove an account from Nextcloud Mail (the mailbox itself is untouched)
 *
 * @param accountId - Account
 */
export async function deleteAccount(accountId: number) {
	await axios.delete(url(`/accounts/${accountId}`))
}

/**
 * Change account settings, e.g. the signature
 *
 * @param accountId - Account
 * @param signature - Signature (HTML)
 */
export async function setSignature(accountId: number, signature: string) {
	await axios.put(url(`/accounts/${accountId}/signature`), { signature })
}

const OAUTH_PROVIDERS = {
	google: { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com', stateKey: 'google-oauth-url' },
	microsoft: { imap: 'outlook.office365.com', smtp: 'smtp.office365.com', stateKey: 'microsoft-oauth-url' },
} as const

export type OAuthProvider = keyof typeof OAUTH_PROVIDERS

/**
 * The provider sign-in URLs the admin configured in Nextcloud Mail (Groupware settings),
 * which Mail only hands to its page as initial state
 */
export async function getOAuthUrls(): Promise<Partial<Record<OAuthProvider, string>>> {
	const html = (await axios.get(generateUrl('/apps/mail/'), { responseType: 'text' })).data as string
	const urls: Partial<Record<OAuthProvider, string>> = {}
	for (const [provider, { stateKey }] of Object.entries(OAUTH_PROVIDERS) as [OAuthProvider, typeof OAUTH_PROVIDERS[OAuthProvider]][]) {
		const match = html.match(new RegExp(`id="initial-state-mail-${stateKey}" value="([^"]*)"`))
		if (match?.[1]) {
			const value = JSON.parse(atob(match[1]))
			if (typeof value === 'string' && value) {
				urls[provider] = value
			}
		}
	}
	return urls
}

/**
 * Connect a Gmail or Microsoft account through Nextcloud Mail's OAuth: create the account, sign in at the
 * provider in an app window, then wait for Mail to set it up
 *
 * @param provider - google or microsoft
 * @param email - Email address
 * @param name - Display name
 * @param authorizeUrl - The provider URL from getOAuthUrls
 */
export async function connectOAuthAccount(provider: OAuthProvider, email: string, name: string, authorizeUrl: string): Promise<MailAccount | null> {
	const { imap, smtp } = OAUTH_PROVIDERS[provider]
	const account = unwrap<MailAccount>((await axios.post(url('/accounts'), {
		accountName: name,
		emailAddress: email,
		imapHost: imap,
		imapPort: 993,
		imapSslMode: 'ssl',
		imapUser: email,
		smtpHost: smtp,
		smtpPort: provider === 'google' ? 465 : 587,
		smtpSslMode: provider === 'google' ? 'ssl' : 'tls',
		smtpUser: email,
		authMethod: 'xoauth2',
	})).data)
	const { state } = unwrap<{ state: string }>((await axios.post(url('/oauth/state'), { accountId: account.id })).data)
	const providerUrl = authorizeUrl.replace('_state_', encodeURIComponent(state)).replace('_email_', encodeURIComponent(email))

	const completed = await window.TALK_DESKTOP.openOAuthWindow(providerUrl, ['/apps/mail/integration/'])
	if (completed) {
		// Mail fetches the folders after the callback
		for (let attempt = 0; attempt < 20; attempt++) {
			const mailboxes = await listMailboxes(account.id).catch(() => [])
			if (mailboxes.length) {
				return account
			}
			await new Promise((resolve) => setTimeout(resolve, 1500))
		}
	}
	// Sign-in cancelled or failed: remove the half-made account, as Mail's own setup does
	await deleteAccount(account.id).catch(() => {})
	return null
}
