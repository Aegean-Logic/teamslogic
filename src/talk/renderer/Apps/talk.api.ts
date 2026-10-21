/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/*
 * The few Talk and Nextcloud endpoints the TeamsLogic apps call. Talk's own services are not imported for these
 * because they pull Talk's capability store in when loaded.
 */

import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import { appData } from '../../../app/AppData.js'

/** Talk conversation types */
export const CONVERSATION_TYPE = {
	ONE_TO_ONE: 1,
	GROUP: 2,
	PUBLIC: 3,
	CHANGELOG: 4,
	ONE_TO_ONE_FORMER: 5,
	NOTE_TO_SELF: 6,
} as const

/** Nextcloud share types used by the autocomplete */
const SHARE_TYPE = {
	USER: 0,
	GROUP: 1,
	EMAIL: 4,
} as const

export type AutocompleteEntry = {
	id: string
	label: string
	source: 'users' | 'groups' | 'emails' | string
	subline?: string
	shareWithDisplayNameUnique?: string
	status?: { status?: string, message?: string, icon?: string } | string
}

export type Attendees = {
	users?: string[]
	groups?: string[]
	emails?: string[]
}

/**
 * Whether the server's Talk has a feature
 *
 * @param feature - Talk capability feature
 */
export function hasTalkFeature(feature: string): boolean {
	return (appData.capabilities?.spreed?.features ?? []).includes(feature)
}

/**
 * Search people (and groups) to invite or call
 *
 * @param search - Search text
 * @param options - Options
 * @param options.onlyUsers - Only registered users
 * @param options.withEmails - Also email addresses (guests)
 */
export async function searchPeople(search: string, { onlyUsers = false, withEmails = false } = {}): Promise<AutocompleteEntry[]> {
	const shareTypes = onlyUsers
		? [SHARE_TYPE.USER]
		: [SHARE_TYPE.USER, SHARE_TYPE.GROUP, ...(withEmails ? [SHARE_TYPE.EMAIL] : [])]
	const response = await axios.get(generateOcsUrl('core/autocomplete/get'), {
		params: { search, itemType: 'call', itemId: 'new', shareTypes, limit: 20 },
	})
	return response.data.ocs.data
}

/**
 * Create a Talk conversation; for a one-to-one with an existing chat, the server returns that chat
 *
 * @param params - Conversation
 * @param params.roomType - CONVERSATION_TYPE
 * @param params.roomName - Name of a group conversation
 * @param params.participants - People and groups to add
 */
export async function createConversation(params: { roomType: number, roomName?: string, participants?: Attendees }): Promise<{ token: string, displayName: string }> {
	const response = await axios.post(generateOcsUrl('apps/spreed/api/v4/room'), params)
	return response.data.ocs.data
}

/**
 * Delete a conversation for everyone
 *
 * @param token - Conversation token
 */
export async function deleteConversation(token: string) {
	await axios.delete(generateOcsUrl('apps/spreed/api/v4/room/{token}', { token }))
}

/**
 * Let Talk write a calendar event for a conversation, with its link, and invite its participants
 *
 * @param token - Conversation token
 * @param meeting - The meeting
 * @param meeting.calendarUri - URI of the calendar to write to
 * @param meeting.start - Start, unix seconds
 * @param meeting.end - End, unix seconds
 * @param meeting.title - Title
 * @param meeting.description - Description
 */
export async function scheduleMeeting(token: string, meeting: { calendarUri: string, start: number, end: number, title: string, description: string }) {
	await axios.post(generateOcsUrl('apps/spreed/api/v4/room/{token}/meeting', { token }), { ...meeting, attendeeIds: null })
}
