/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { MessageItem } from '../Mail/mail.service.ts'

import axios from '@nextcloud/axios'
import { t } from '@nextcloud/l10n'
import { generateOcsUrl } from '@nextcloud/router'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { appData } from '../../../../app/AppData.js'
import { allNotifications } from '../../notifications/notifications.store.js'
import { readStored, writeStored } from '../apps.utils.ts'
import { useMailStore } from '../Mail/mail.store.ts'

export type RichParameter = {
	type: string
	id: string
	name: string
	link?: string
	path?: string
	'call-type'?: string
	[key: string]: unknown
}

export type NotificationAction = {
	label: string
	link: string
	type: string
	primary: boolean
}

export type ServerNotification = {
	notificationId: number
	app: string
	user: string
	datetime: string
	objectType: string
	objectId: string
	subject: string
	subjectRich: string
	subjectRichParameters: Record<string, RichParameter>
	message: string
	messageRich: string
	messageRichParameters: Record<string, RichParameter>
	link: string
	icon: string
	actions: NotificationAction[]
}

export type ActivityCategory = 'mention' | 'reply' | 'reaction' | 'call' | 'share' | 'mail' | 'other'

export type ActivityFilter = 'all' | 'unread' | 'mention' | 'reaction' | 'call'

const READ_KEY = 'teamslogic:activity:read'
const SEEN_KEY = 'teamslogic:activity:seen'

/** App name of the activity items TeamsLogic makes for new mail */
const MAIL_APP = 'teamslogic-mail'

/**
 * An Activity item for a new message, shaped like a server notification (negative ids keep them apart)
 *
 * @param message - The message
 * @param receivedAt - When TeamsLogic saw it
 */
function mailToNotification(message: MessageItem, receivedAt: Date): ServerNotification {
	const sender = message.from[0]
	return {
		notificationId: -message.databaseId,
		app: MAIL_APP,
		user: '',
		datetime: receivedAt.toISOString(),
		objectType: 'mail',
		objectId: String(message.databaseId),
		subject: '',
		subjectRich: t('talk_desktop', '{sender} sent you an email'),
		subjectRichParameters: { sender: { type: 'email', id: sender?.email ?? '', name: sender?.label || sender?.email || t('talk_desktop', 'Someone') } },
		message: message.subject,
		messageRich: '',
		messageRichParameters: {},
		link: '',
		icon: '',
		actions: [],
	}
}

/**
 * Sort a notification into a Teams activity category
 *
 * @param notification - Notification
 */
export function getCategory(notification: ServerNotification): ActivityCategory {
	if (notification.app === 'spreed') {
		if (notification.objectType === 'call') {
			return 'call'
		}
		if (notification.subjectRichParameters?.reaction) {
			return 'reaction'
		}
		const userId = (appData.userMetadata as { id?: string } | null)?.id
		const mentionsMe = Object.values(notification.messageRichParameters ?? {}).some((parameter) => {
			return (parameter.type === 'user' && parameter.id === userId) || parameter.type === 'call'
		})
		return mentionsMe ? 'mention' : 'reply'
	}
	if (notification.app === MAIL_APP) {
		return 'mail'
	}
	if (notification.app === 'files_sharing' || notification.objectType === 'share' || notification.objectType === 'remote_share') {
		return 'share'
	}
	// The Aegean Office editors notify @mentions in documents
	if (/mention/i.test(notification.objectType)) {
		return 'mention'
	}
	return 'other'
}

/**
 * Get the Talk conversation and message of a Talk notification
 *
 * @param notification - Notification
 */
export function getTalkTarget(notification: ServerNotification): { token: string, messageId?: string } | null {
	if (notification.app !== 'spreed') {
		return null
	}
	const [token, messageId] = notification.objectId.split('/')
	return { token: notification.subjectRichParameters?.call?.id ?? token!, messageId }
}

export const useActivityStore = defineStore('activity', () => {
	/** Notifications opened in TeamsLogic: the server has no read state, only dismissing */
	const readIds = ref(new Set<number>(readStored<number[]>(READ_KEY, [])))
	/** The newest notification the user has seen in Activity, for the rail badge */
	const seenId = ref(readStored<number>(SEEN_KEY, 0))
	const dismissedIds = ref(new Set<number>())

	const mailStore = useMailStore()

	const notifications = computed(() => [
		...(allNotifications.value as ServerNotification[]),
		...mailStore.arrivals.map(({ message, receivedAt }) => mailToNotification(message, receivedAt)),
	]
		.filter((notification) => !dismissedIds.value.has(notification.notificationId))
		.sort((a, b) => Date.parse(b.datetime) - Date.parse(a.datetime) || b.notificationId - a.notificationId))

	/**
	 * The message of a new-mail item
	 *
	 * @param notification - Activity item
	 */
	function getMailMessage(notification: ServerNotification) {
		return mailStore.arrivals.find(({ message }) => -message.databaseId === notification.notificationId)?.message ?? null
	}

	const unseenCount = computed(() => notifications.value.filter((notification) => notification.notificationId > seenId.value).length)

	/**
	 * Whether a notification was opened
	 *
	 * @param notification - Notification
	 */
	function isRead(notification: ServerNotification) {
		return readIds.value.has(notification.notificationId)
	}

	/**
	 * Mark a notification as opened
	 *
	 * @param notification - Notification
	 */
	function markRead(notification: ServerNotification) {
		readIds.value = new Set([...readIds.value, notification.notificationId])
		// Keep only ids that still exist
		const existing = new Set(notifications.value.map((item) => item.notificationId))
		writeStored(READ_KEY, [...readIds.value].filter((id) => existing.has(id)))
	}

	/**
	 * The user looked at Activity: clear the rail badge
	 */
	function markAllSeen() {
		seenId.value = Math.max(seenId.value, ...notifications.value.map((notification) => notification.notificationId))
		writeStored(SEEN_KEY, seenId.value)
	}

	/**
	 * Dismiss a notification on the server
	 *
	 * @param notification - Notification
	 */
	async function dismiss(notification: ServerNotification) {
		dismissedIds.value = new Set([...dismissedIds.value, notification.notificationId])
		if (notification.app === MAIL_APP) {
			return
		}
		await axios.delete(generateOcsUrl('apps/notifications/api/v2/notifications/{id}', { id: notification.notificationId }))
	}

	/**
	 * Dismiss all notifications on the server
	 */
	async function dismissAll() {
		dismissedIds.value = new Set(notifications.value.map((notification) => notification.notificationId))
		await axios.delete(generateOcsUrl('apps/notifications/api/v2/notifications'))
	}

	/**
	 * Run a notification action (e.g. accept a share); web links open in the browser
	 *
	 * @param notification - Notification
	 * @param action - The action
	 */
	async function runAction(notification: ServerNotification, action: NotificationAction) {
		if (action.type === 'WEB') {
			window.open(action.link, '_blank')
			return
		}
		await axios({ method: action.type, url: action.link })
		await dismiss(notification)
	}

	return {
		notifications,
		getMailMessage,
		unseenCount,
		isRead,
		markRead,
		markAllSeen,
		dismiss,
		dismissAll,
		runAction,
	}
})
