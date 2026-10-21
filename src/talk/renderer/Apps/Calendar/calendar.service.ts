/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import axios from '@nextcloud/axios'
import { emit } from '@nextcloud/event-bus'
import { generateOcsUrl } from '@nextcloud/router'
import { getDefaultCalendarUri, getPersonalCalendars, initializeCalDavClient } from '@talk/src/services/CalDavClient.ts'
import ICAL from 'ical.js'

type CalendarObject = { url: string, data: string, update: () => Promise<void> }

type DavCalendar = Awaited<ReturnType<typeof getPersonalCalendars>>[number] & {
	findByTypeInTimeRange: (type: string, from: Date, to: Date) => Promise<CalendarObject[]>
	createVObject: (data: string) => Promise<CalendarObject>
}

/** A calendar synced with Google or Microsoft 365 by the TeamsLogic server app */
export type SyncedCalendar = {
	connectionId: number
	provider: 'google' | 'microsoft'
	/** The connected account, the organiser of meetings made in this calendar */
	email: string
	calendarUri: string
	name: string
	readOnly: boolean
	/** The online meeting the provider adds to an event that asks for one */
	onlineMeeting: 'teams' | 'meet' | null
}

export type CalendarInfo = {
	url: string
	uri: string
	name: string
	color: string
	writable: boolean
	synced: SyncedCalendar | null
}

/** How a meeting is held */
export type MeetingKind = 'talk' | 'teams' | 'meet' | 'link'

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
	/** A Talk meeting made as an audio call: Join starts without the camera */
	talkAudio: boolean
	/** How to join an online meeting, if it is one */
	meeting: MeetingKind | null
	/** The meeting's link (Teams, Meet or any other), when it isn't a Talk meeting */
	joinUrl: string | null
}

const TALK_LINK_RE = /\/call\/([a-z0-9]{4,})/i

/** Properties the TeamsLogic server app reads and writes (see its README) */
const ONLINE_MEETING_PROP = 'x-teamslogic-online-meeting'
const JOIN_URL_PROP = 'x-teamslogic-join-url'
/** A Talk meeting made as an audio call */
const TALK_MEDIA_PROP = 'x-teamslogic-talk-media'

/** Links of the common meeting services, for events made elsewhere */
const MEETING_LINKS: [RegExp, MeetingKind][] = [
	[/https:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/\S+/i, 'teams'],
	[/https:\/\/meet\.google\.com\/[a-z0-9-]+/i, 'meet'],
	[/https:\/\/(?:[\w-]+\.)?(?:zoom\.us|zoomgov\.com)\/[jw]\/\S+/i, 'link'],
	[/https:\/\/[\w.-]+\.webex\.com\/\S+/i, 'link'],
]

let calendars: DavCalendar[] = []
let syncedCalendars: SyncedCalendar[] = []

declare module '@nextcloud/event-bus' {
	interface NextcloudEvents {
		/** Talk's device preview, with its Join call button */
		'talk:media-settings:show': undefined
	}
}

/**
 * Open Talk's device preview for the conversation shown (Teams' pre-join screen)
 */
export function showTalkMediaSettings() {
	emit('talk:media-settings:show')
}

/**
 * Connect to the user's calendars (CalDAV, through Talk's client)
 */
export async function loadCalendars(): Promise<CalendarInfo[]> {
	await initializeCalDavClient()
	const [davCalendars, synced] = await Promise.all([getPersonalCalendars() as Promise<DavCalendar[]>, getSyncedCalendars()])
	syncedCalendars = synced
	calendars = davCalendars
		.filter((calendar) => calendar.components.includes('VEVENT') && calendar.enabled !== false)
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
	return calendars.map(toCalendarInfo)
}

/**
 * The calendars the TeamsLogic server app syncs with Google or Microsoft 365 (none without the app)
 */
async function getSyncedCalendars(): Promise<SyncedCalendar[]> {
	try {
		const response = await axios.get(generateOcsUrl('apps/teamslogic/api/v1/calendars'))
		return response.data.ocs.data as SyncedCalendar[]
	} catch {
		return []
	}
}

/**
 * Send a synced calendar's changes to Google or Microsoft now, so a new meeting gets its Teams or Meet link
 *
 * @param calendar - A synced calendar
 */
export async function syncNow(calendar: SyncedCalendar) {
	await axios.post(generateOcsUrl('apps/teamslogic/api/v1/connections/{id}/sync', { id: calendar.connectionId }))
}

/**
 * The signed-in user's email address, the organiser of meetings in their own calendars
 */
export async function getOwnEmail(): Promise<string> {
	const response = await axios.get(generateOcsUrl('cloud/user'))
	return (response.data.ocs.data.email as string | null) ?? ''
}

export type NewEvent = {
	title: string
	start: Date
	end: Date
	description: string
	location: string
	organizer: { email: string, name: string } | null
	attendees: { email: string, name: string }[]
	/** Ask Google or Microsoft for a Meet or Teams meeting when the event syncs */
	onlineMeeting: 'teams' | 'meet' | null
	/** A meeting link from anywhere else */
	joinUrl: string | null
	/** Google or Microsoft sends the invitations, not Nextcloud */
	providerSchedules: boolean
}

/**
 * Write a new event to a calendar
 *
 * @param calendarUri - The calendar
 * @param event - The event
 */
export async function createEvent(calendarUri: string, event: NewEvent) {
	const calendar = calendars.find((item) => toCalendarInfo(item).uri === calendarUri)
	if (!calendar) {
		throw new Error(`No calendar ${calendarUri}`)
	}
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
	const root = new ICAL.Component(['vcalendar', [], []])
	root.addPropertyWithValue('prodid', '-//Aegean Logic//TeamsLogic//EN')
	root.addPropertyWithValue('version', '2.0')
	const vevent = new ICAL.Component('vevent')
	vevent.addPropertyWithValue('uid', crypto.randomUUID())
	vevent.addPropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true))
	for (const [name, date] of [['dtstart', event.start], ['dtend', event.end]] as const) {
		const property = vevent.addPropertyWithValue(name, localTime(date))
		if (zone !== 'UTC') {
			property.setParameter('tzid', zone)
		}
	}
	vevent.addPropertyWithValue('summary', event.title)
	if (event.description) {
		vevent.addPropertyWithValue('description', event.description)
	}
	if (event.location) {
		vevent.addPropertyWithValue('location', event.location)
	}
	if (event.organizer) {
		const organizer = vevent.addPropertyWithValue('organizer', `mailto:${event.organizer.email}`)
		if (event.organizer.name) {
			organizer.setParameter('cn', event.organizer.name)
		}
	}
	for (const attendee of event.attendees) {
		const property = vevent.addPropertyWithValue('attendee', `mailto:${attendee.email}`)
		if (attendee.name) {
			property.setParameter('cn', attendee.name)
		}
		property.setParameter('partstat', 'NEEDS-ACTION')
		property.setParameter('role', 'REQ-PARTICIPANT')
		property.setParameter('rsvp', 'TRUE')
		if (event.providerSchedules) {
			property.setParameter('schedule-agent', 'CLIENT')
		}
	}
	if (event.onlineMeeting) {
		vevent.addPropertyWithValue(ONLINE_MEETING_PROP, event.onlineMeeting)
	}
	if (event.joinUrl) {
		vevent.addPropertyWithValue(JOIN_URL_PROP, event.joinUrl)
	}
	root.addSubcomponent(vevent)
	await calendar.createVObject(root.toString())
}

/**
 * Mark the event Talk wrote for a meeting as an audio call, so Join starts it without the camera
 *
 * @param calendarUri - The calendar Talk wrote to
 * @param token - The meeting's conversation
 * @param start - Meeting start
 * @param end - Meeting end
 */
export async function markTalkAudio(calendarUri: string, token: string, start: Date, end: Date) {
	const calendar = calendars.find((item) => toCalendarInfo(item).uri === calendarUri)
	const objects: CalendarObject[] = await calendar?.findByTypeInTimeRange('VEVENT', new Date(start.getTime() - 60000), new Date(end.getTime() + 60000)) ?? []
	const object = objects.find((item) => item.data.includes(`/call/${token}`))
	if (!object) {
		return
	}
	const root = new ICAL.Component(ICAL.parse(object.data))
	root.getFirstSubcomponent('vevent')?.updatePropertyWithValue(TALK_MEDIA_PROP, 'audio')
	object.data = root.toString()
	await object.update()
}

/**
 * A wall-clock time in the system's time zone, for DTSTART;TZID=…
 *
 * @param date - The moment
 */
function localTime(date: Date): ICAL.Time {
	return ICAL.Time.fromData({
		year: date.getFullYear(),
		month: date.getMonth() + 1,
		day: date.getDate(),
		hour: date.getHours(),
		minute: date.getMinutes(),
		second: 0,
		isDate: false,
	})
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
	const uri = calendar.url.replace(/\/$/, '').split('/').pop()!
	return {
		url: calendar.url,
		uri,
		name: calendar.displayname,
		color: calendar.color?.slice(0, 7) || '#12718C',
		writable: calendar.isWriteable(),
		synced: syncedCalendars.find((synced) => synced.calendarUri === uri) ?? null,
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
	const talkToken = (location.match(TALK_LINK_RE) ?? description.match(TALK_LINK_RE))?.[1] ?? null
	const { meeting, joinUrl } = talkToken ? { meeting: 'talk' as const, joinUrl: null } : findMeeting(event.component, location, description)

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
		talkToken,
		talkAudio: String(event.component.getFirstPropertyValue(TALK_MEDIA_PROP) ?? '').toLowerCase() === 'audio',
		meeting,
		joinUrl,
	}
}

/**
 * The online meeting of an event that isn't a Talk one: the link the server app recorded, or a known meeting
 * service's link in the location or description, or any link that is the whole location
 *
 * @param vevent - The event
 * @param location - Its location
 * @param description - Its description
 */
function findMeeting(vevent: ICAL.Component, location: string, description: string): { meeting: MeetingKind | null, joinUrl: string | null } {
	const recorded = String(vevent.getFirstPropertyValue(JOIN_URL_PROP) ?? '')
	const marked = String(vevent.getFirstPropertyValue(ONLINE_MEETING_PROP) ?? '').toLowerCase()
	if (recorded) {
		const kind = marked === 'teams' || marked === 'meet' ? marked : (MEETING_LINKS.find(([pattern]) => pattern.test(recorded))?.[1] ?? 'link')
		return { meeting: kind, joinUrl: recorded }
	}
	for (const [pattern, kind] of MEETING_LINKS) {
		const match = location.match(pattern) ?? description.match(pattern)
		if (match) {
			return { meeting: kind, joinUrl: match[0].replace(/[>)\].,]+$/, '') }
		}
	}
	if (/^https:\/\/\S+$/.test(location.trim())) {
		return { meeting: 'link', joinUrl: location.trim() }
	}
	// Asked for, not made yet (the calendar hasn't synced since)
	return { meeting: marked === 'teams' || marked === 'meet' ? marked : null, joinUrl: null }
}
