/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getDefaultCalendarUri, getPersonalCalendars, initializeCalDavClient } from '@talk/src/services/CalDavClient.ts'
import ICAL from 'ical.js'

type CalendarObject = { url: string, data: string }

type DavCalendar = Awaited<ReturnType<typeof getPersonalCalendars>>[number] & {
	findByTypeInTimeRange: (type: string, from: Date, to: Date) => Promise<CalendarObject[]>
}

export type CalendarInfo = {
	url: string
	uri: string
	name: string
	color: string
	writable: boolean
}

export type Attendee = {
	name: string
	email: string
	status: string
}

export type CalendarEvent = {
	id: string
	title: string
	start: Date
	end: Date
	allDay: boolean
	location: string
	description: string
	organizer: string
	attendees: Attendee[]
	calendar: CalendarInfo
	/** Talk conversation of a meeting created from Talk (its link in the location or description) */
	talkToken: string | null
}

const TALK_LINK_RE = /\/call\/([a-z0-9]{4,})/i

let calendars: DavCalendar[] = []

/**
 * Connect to the user's calendars (CalDAV, through Talk's client)
 */
export async function loadCalendars(): Promise<CalendarInfo[]> {
	await initializeCalDavClient()
	calendars = (await getPersonalCalendars() as DavCalendar[])
		.filter((calendar) => calendar.components.includes('VEVENT') && calendar.enabled !== false)
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
	return calendars.map(toCalendarInfo)
}

/**
 * The calendar new meetings go to by default
 */
export function getDefaultCalendar(): string {
	return getDefaultCalendarUri()
}

/**
 * Describe a CalDAV calendar
 *
 * @param calendar - The calendar
 */
function toCalendarInfo(calendar: DavCalendar): CalendarInfo {
	return {
		url: calendar.url,
		uri: calendar.url.replace(/\/$/, '').split('/').pop()!,
		name: calendar.displayname,
		color: calendar.color?.slice(0, 7) || '#12718C',
		writable: calendar.isWriteable(),
	}
}

/**
 * Get the events of all calendars in a time range, recurring events expanded
 *
 * @param from - Range start
 * @param to - Range end
 */
export async function getEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
	const results = await Promise.allSettled(calendars.map(async (calendar) => {
		const objects = await calendar.findByTypeInTimeRange('VEVENT', from, to)
		return objects.flatMap((object: CalendarObject) => parseObject(object.url, object.data, toCalendarInfo(calendar), from, to))
	}))
	return results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
}

/**
 * Parse one calendar object into its event occurrences in the range
 *
 * @param url - Object URL
 * @param data - iCalendar data
 * @param calendar - Its calendar
 * @param from - Range start
 * @param to - Range end
 */
function parseObject(url: string, data: string, calendar: CalendarInfo, from: Date, to: Date): CalendarEvent[] {
	try {
		const root = new ICAL.Component(ICAL.parse(data))
		for (const timezone of root.getAllSubcomponents('vtimezone')) {
			const tzid = timezone.getFirstPropertyValue('tzid') as string
			if (!ICAL.TimezoneService.has(tzid)) {
				ICAL.TimezoneService.register(timezone)
			}
		}

		const vevents = root.getAllSubcomponents('vevent')
		const master = vevents.find((vevent) => !vevent.hasProperty('recurrence-id')) ?? vevents[0]
		if (!master) {
			return []
		}
		const event = new ICAL.Event(master, { exceptions: vevents.filter((vevent) => vevent !== master) })

		if (!event.isRecurring()) {
			return [toEvent(url, event, event.startDate, event.endDate, calendar)]
		}

		const occurrences: CalendarEvent[] = []
		const iterator = event.iterator()
		// Occurrences can last a while, so start looking a week before the range
		const lookFrom = from.getTime() - 7 * 86400000
		let next: ICAL.Time | null
		// Guard against endless rules: a daily event over 25 years
		for (let i = 0; (next = iterator.next()) && i < 10000; i++) {
			const nextTime = next.toJSDate().getTime()
			if (nextTime >= to.getTime()) {
				break
			}
			if (nextTime < lookFrom) {
				continue
			}
			const details = event.getOccurrenceDetails(next)
			if (details.endDate.toJSDate() > from) {
				occurrences.push(toEvent(url, details.item, details.startDate, details.endDate, calendar))
			}
		}
		return occurrences
	} catch (error) {
		console.warn('Could not read a calendar event', url, error)
		return []
	}
}

/**
 * Build an event occurrence
 *
 * @param url - Object URL
 * @param event - The event (or its exception for this occurrence)
 * @param start - Occurrence start
 * @param end - Occurrence end
 * @param calendar - Its calendar
 */
function toEvent(url: string, event: ICAL.Event, start: ICAL.Time, end: ICAL.Time, calendar: CalendarInfo): CalendarEvent {
	const location = event.location ?? ''
	const description = event.description ?? ''
	const organizer = event.organizer ? String(event.organizer).replace(/^mailto:/i, '') : ''
	const organizerName = event.component.getFirstProperty('organizer')?.getParameter('cn') as string | undefined

	return {
		id: `${url}#${start.toString()}`,
		title: event.summary || '',
		start: start.toJSDate(),
		end: (end ?? start).toJSDate(),
		allDay: start.isDate,
		location,
		description,
		organizer: organizerName || organizer,
		attendees: event.attendees.map((attendee) => ({
			name: (attendee.getParameter('cn') as string) || String(attendee.getFirstValue()).replace(/^mailto:/i, ''),
			email: String(attendee.getFirstValue()).replace(/^mailto:/i, ''),
			status: (attendee.getParameter('partstat') as string) || 'NEEDS-ACTION',
		})),
		calendar,
		talkToken: (location.match(TALK_LINK_RE) ?? description.match(TALK_LINK_RE))?.[1] ?? null,
	}
}
