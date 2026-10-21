/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** The part of `@nextcloud/cdav-library` (which ships no types) the People and To Do apps use */
declare module '@nextcloud/cdav-library' {
	export default class DavClient {
		constructor(options: { rootUrl: string, defaultHeaders?: Record<string, string> })
		connect(options: { enableCalDAV?: boolean, enableCardDAV?: boolean }): Promise<DavClient>
		addressBookHomes: { findAllAddressBooks(): Promise<unknown[]> }[]
		calendarHomes: {
			findAllCalendars(): Promise<unknown[]>
			createCalendarCollection(displayname: string, color: string, supportedComponentSet?: string[] | null): Promise<unknown>
		}[]
	}
}
