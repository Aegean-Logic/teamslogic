/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/*
 * The user's tasks over CalDAV: task lists are calendars of VTODOs, as in the Nextcloud Tasks app and phones. The
 * TeamsLogic server app syncs some of them with Microsoft To Do and Google Tasks ("Outlook · Tasks").
 */

import axios from '@nextcloud/axios'
import DavClient from '@nextcloud/cdav-library'
import { generateOcsUrl, generateRemoteUrl } from '@nextcloud/router'
import ICAL from 'ical.js'

type DavObject = {
	url: string
	data: string
	update: () => Promise<void>
	delete: () => Promise<void>
}

type DavCalendar = {
	url: string
	displayname: string
	color?: string
	enabled?: boolean
	components: string[]
	isWriteable: () => boolean
	findByType: (type: string) => Promise<DavObject[]>
	createVObject: (data: string) => Promise<DavObject>
}

export type TaskList = {
	url: string
	name: string
	color: string
	writable: boolean
	/** The TeamsLogic connection it syncs with, if it does */
	connectionId: number | null
}

export type Task = {
	id: string
	uid: string
	list: TaskList
	title: string
	notes: string
	/** YYYY-MM-DD */
	due: string | null
	done: boolean
	completedAt: Date | null
	/** PRIORITY 1–4, To Do's "important" */
	important: boolean
	createdAt: Date | null
}

export type TaskChanges = Partial<Pick<Task, 'title' | 'notes' | 'due' | 'done' | 'important'>>

const PRODID = '-//Aegean Logic//TeamsLogic//EN'

let client: DavClient | null = null
let lists: DavCalendar[] = []
const objects = new Map<string, { object: DavObject, list: DavCalendar }>()

/**
 * Connect to the user's calendars (a client of its own: Talk's is shared with the Calendar)
 */
async function connect(): Promise<DavClient> {
	if (!client) {
		client = new DavClient({ rootUrl: generateRemoteUrl('dav') })
	}
	await client.connect({ enableCalDAV: true })
	return client
}

/**
 * Describe a task list
 *
 * @param list - The calendar
 */
function toTaskList(list: DavCalendar): TaskList {
	const uri = list.url.replace(/\/$/, '').split('/').pop() ?? ''
	const synced = uri.match(/^teamslogic-(\d+)-/)
	return {
		url: list.url,
		name: list.displayname || uri,
		color: list.color?.slice(0, 7) || '#12718C',
		writable: list.isWriteable(),
		connectionId: synced ? Number(synced[1]) : null,
	}
}

/**
 * All task lists and their tasks
 */
export async function loadTasks(): Promise<{ lists: TaskList[], tasks: Task[] }> {
	const dav = await connect()
	lists = ((await dav.calendarHomes[0]!.findAllCalendars()) as DavCalendar[])
		.filter((list) => list.components.includes('VTODO') && list.enabled !== false)
	objects.clear()
	const tasks: Task[] = []
	const results = await Promise.allSettled(lists.map(async (list) => ({ list, items: await list.findByType('VTODO') })))
	for (const result of results) {
		if (result.status !== 'fulfilled') {
			console.warn('Could not read a task list', result.reason)
			continue
		}
		const info = toTaskList(result.value.list)
		for (const object of result.value.items) {
			const task = parseTask(object.url, object.data, info)
			if (task) {
				objects.set(object.url, { object, list: result.value.list })
				tasks.push(task)
			}
		}
	}
	return { lists: lists.map(toTaskList), tasks }
}

/**
 * Read a task
 *
 * @param id - Its URL
 * @param data - The calendar object
 * @param list - Its list
 */
export function parseTask(id: string, data: string, list: TaskList): Task | null {
	try {
		const vtodo = new ICAL.Component(ICAL.parse(data)).getFirstSubcomponent('vtodo')
		if (!vtodo) {
			return null
		}
		const text = (name: string) => String(vtodo.getFirstPropertyValue(name) ?? '').trim()
		const time = (name: string) => {
			const value = vtodo.getFirstPropertyValue(name)
			return value instanceof ICAL.Time ? value : null
		}
		const due = time('due')
		const completed = time('completed')
		const created = time('created')
		const status = text('status').toUpperCase()
		const priority = Number(vtodo.getFirstPropertyValue('priority') ?? 0)
		return {
			id,
			uid: text('uid'),
			list,
			title: text('summary'),
			notes: text('description'),
			due: due ? `${due.year}-${String(due.month).padStart(2, '0')}-${String(due.day).padStart(2, '0')}` : null,
			done: status === 'COMPLETED' || completed !== null,
			completedAt: completed ? completed.toJSDate() : null,
			important: priority >= 1 && priority <= 4,
			createdAt: created ? created.toJSDate() : null,
		}
	} catch (error) {
		console.warn('Could not read a task', id, error)
		return null
	}
}

/**
 * Write a task's changes into its calendar object (or a new one), keeping everything else in it
 *
 * @param existing - The calendar object, or null for a new task
 * @param changes - What changes
 */
export function writeTask(existing: string | null, changes: TaskChanges): string {
	let root: ICAL.Component
	let vtodo: ICAL.Component
	if (existing) {
		root = new ICAL.Component(ICAL.parse(existing))
		vtodo = root.getFirstSubcomponent('vtodo')!
	} else {
		root = new ICAL.Component(['vcalendar', [], []])
		root.addPropertyWithValue('prodid', PRODID)
		root.addPropertyWithValue('version', '2.0')
		vtodo = new ICAL.Component('vtodo')
		vtodo.addPropertyWithValue('uid', crypto.randomUUID())
		vtodo.addPropertyWithValue('created', ICAL.Time.fromJSDate(new Date(), true))
		root.addSubcomponent(vtodo)
	}
	const now = ICAL.Time.fromJSDate(new Date(), true)
	vtodo.updatePropertyWithValue('dtstamp', now)
	vtodo.updatePropertyWithValue('last-modified', now)

	if (changes.title !== undefined) {
		vtodo.updatePropertyWithValue('summary', changes.title.trim())
	}
	if (changes.notes !== undefined) {
		vtodo.removeAllProperties('description')
		if (changes.notes.trim()) {
			vtodo.addPropertyWithValue('description', changes.notes.trim())
		}
	}
	if (changes.due !== undefined) {
		vtodo.removeAllProperties('due')
		const match = changes.due?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
		if (match) {
			// A date-only time: ical.js writes it as DUE;VALUE=DATE
			vtodo.addPropertyWithValue('due', ICAL.Time.fromData({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), isDate: true }))
		}
	}
	if (changes.important !== undefined) {
		vtodo.removeAllProperties('priority')
		if (changes.important) {
			vtodo.addPropertyWithValue('priority', 1)
		}
	}
	if (changes.done !== undefined) {
		vtodo.removeAllProperties('completed')
		vtodo.removeAllProperties('percent-complete')
		if (changes.done) {
			vtodo.updatePropertyWithValue('status', 'COMPLETED')
			vtodo.addPropertyWithValue('completed', now)
			vtodo.addPropertyWithValue('percent-complete', 100)
		} else {
			vtodo.updatePropertyWithValue('status', 'NEEDS-ACTION')
		}
	} else if (!existing) {
		vtodo.updatePropertyWithValue('status', 'NEEDS-ACTION')
	}
	return root.toString()
}

/**
 * Add a task to a list
 *
 * @param listUrl - The list
 * @param changes - The task
 */
export async function createTask(listUrl: string, changes: TaskChanges) {
	const list = lists.find((item) => item.url === listUrl)
	if (!list) {
		throw new Error(`No task list ${listUrl}`)
	}
	await list.createVObject(writeTask(null, changes))
	syncSoon(toTaskList(list))
}

/**
 * Change a task
 *
 * @param task - The task
 * @param changes - What changes
 */
export async function updateTask(task: Task, changes: TaskChanges) {
	const entry = objects.get(task.id)
	if (!entry) {
		throw new Error(`No task ${task.id}`)
	}
	entry.object.data = writeTask(entry.object.data, changes)
	await entry.object.update()
	syncSoon(task.list)
}

/**
 * Delete a task
 *
 * @param task - The task
 */
export async function deleteTask(task: Task) {
	const entry = objects.get(task.id)
	if (!entry) {
		return
	}
	await entry.object.delete()
	objects.delete(task.id)
	syncSoon(task.list)
}

/**
 * Make a new task list (in Nextcloud; it isn't sent to To Do or Google Tasks)
 *
 * @param name - Its name
 */
export async function createTaskList(name: string): Promise<string> {
	const dav = await connect()
	const created = await dav.calendarHomes[0]!.createCalendarCollection(name, '#12718C', ['VTODO']) as DavCalendar
	return created.url
}

const pendingSync = new Map<number, number>()

/**
 * Send a synced list's changes to To Do or Google Tasks shortly (a few ticks in a row go together)
 *
 * @param list - The list
 */
function syncSoon(list: TaskList) {
	const id = list.connectionId
	if (id === null) {
		return
	}
	window.clearTimeout(pendingSync.get(id))
	pendingSync.set(id, window.setTimeout(() => {
		pendingSync.delete(id)
		axios.post(generateOcsUrl('apps/teamslogic/api/v1/connections/{id}/sync', { id }))
			.catch((error) => console.warn('Could not sync the task list now', error))
	}, 2000))
}
