/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/*
 * The OCS API of TeamsLogic for Nextcloud (the teamslogic server app): Google and Microsoft 365 accounts whose
 * calendars and contacts sync two ways with Nextcloud, and whose mail is set up in Nextcloud Mail.
 */

import axios from '@nextcloud/axios'
import { t } from '@nextcloud/l10n'
import { generateOcsUrl } from '@nextcloud/router'

export type Provider = 'google' | 'microsoft'

export type Features = {
	mail: boolean
	calendar: boolean
	contacts: boolean
}

export type Connection = Features & {
	id: number
	provider: Provider
	email: string
	mailAccountId: number | null
	/** Unix seconds */
	lastSync: number | null
	lastError: string | null
}

/** Server path of the app's OAuth callback, where the sign-in window may close */
const CALLBACK_PATH = '/apps/teamslogic/oauth/'

const url = (path: string, params = {}) => generateOcsUrl(`apps/teamslogic/api/v1${path}`, params)

/**
 * The connected accounts, or null when the server app is not installed
 */
export async function listConnections(): Promise<Connection[] | null> {
	try {
		return (await axios.get(url('/connections'))).data.ocs.data
	} catch (error) {
		const status = (error as { response?: { status?: number } }).response?.status
		if (status === 404 || status === 998) {
			return null
		}
		throw error
	}
}

/**
 * Connect a Google or Microsoft account: sign in in an app window, then wait for the server to store it
 *
 * @param provider - google or microsoft
 * @param features - What to connect
 * @return The new connection, or null when the sign-in was cancelled
 * @throws {Error} With the server's message when the admin has not set the provider up
 */
export async function connect(provider: Provider, features: Partial<Features>): Promise<Connection | null> {
	let authorizeUrl: string
	try {
		authorizeUrl = (await axios.post(url('/connect/{provider}', { provider }), features)).data.ocs.data.url
	} catch (error) {
		const response = (error as { response?: { status?: number, data?: { ocs?: { data?: { message?: string } } } } }).response
		const message = response?.status === 412
			? (provider === 'google'
					? t('talk_desktop', 'Connecting Google accounts is not set up on your server yet. Your administrator can add it in Nextcloud\'s Groupware settings (TeamsLogic).')
					: t('talk_desktop', 'Connecting Microsoft 365 accounts is not set up on your server yet. Your administrator can add it in Nextcloud\'s Groupware settings (TeamsLogic).'))
			: response?.data?.ocs?.data?.message || t('talk_desktop', 'Could not start the sign-in')
		throw new Error(message, { cause: error })
	}

	const before = new Set(((await listConnections()) ?? []).map((connection) => connection.id))
	const completed = await window.TALK_DESKTOP.openOAuthWindow(authorizeUrl, [CALLBACK_PATH])
	if (!completed) {
		return null
	}
	// The callback stores the connection
	let connections: Connection[] = []
	for (let attempt = 0; attempt < 10; attempt++) {
		connections = (await listConnections()) ?? []
		const added = connections.find((connection) => !before.has(connection.id))
		if (added) {
			return added
		}
		await new Promise((resolve) => setTimeout(resolve, 1000))
	}
	// Signing in again to an account already connected renews it in place
	return connections.find((connection) => connection.provider === provider) ?? null
}

/**
 * Switch mail, calendar or contacts of a connection
 *
 * @param id - Connection
 * @param features - What to change
 */
export async function updateConnection(id: number, features: Partial<Features>): Promise<Connection> {
	return (await axios.patch(url('/connections/{id}', { id }), features)).data.ocs.data
}

/**
 * Sync a connection now
 *
 * @param id - Connection
 */
export async function syncNow(id: number): Promise<Connection> {
	return (await axios.post(url('/connections/{id}/sync', { id }))).data.ocs.data
}

/**
 * Disconnect an account
 *
 * @param id - Connection
 * @param keepData - Keep the synced calendars and address books as ordinary ones
 */
export async function disconnect(id: number, keepData: boolean) {
	await axios.delete(url('/connections/{id}', { id }), { params: { keepData: keepData ? 1 : 0 } })
}
