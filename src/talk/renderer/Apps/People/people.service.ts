/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/*
 * The user's contacts over CardDAV: their address books, including the ones the TeamsLogic server app syncs with
 * Google and Microsoft 365 ("Outlook · Contacts"), so a contact added or changed here reaches Outlook or Google too.
 */

import axios from '@nextcloud/axios'
import DavClient from '@nextcloud/cdav-library'
import { generateOcsUrl, generateRemoteUrl } from '@nextcloud/router'
import ICAL from 'ical.js'

type DavVCard = {
	url: string
	data: string
	update: () => Promise<void>
	delete: () => Promise<void>
}

type DavAddressBook = {
	url: string
	displayname: string
	enabled?: boolean
	isWriteable: () => boolean
	findAllVCards: () => Promise<DavVCard[]>
	createVCard: (data: string) => Promise<DavVCard>
}

export type AddressBookInfo = {
	url: string
	name: string
	writable: boolean
	/** The TeamsLogic connection it syncs with, if it does */
	connectionId: number | null
}

export type ContactField = {
	/** work, home, mobile, fax or other */
	type: string
	value: string
}

export type ContactAddress = {
	type: string
	street: string
	city: string
	region: string
	postcode: string
	country: string
}

export type ContactInput = {
	firstName: string
	lastName: string
	company: string
	jobTitle: string
	emails: ContactField[]
	phones: ContactField[]
	address: ContactAddress | null
	/** YYYY-MM-DD, or --MM-DD without a year */
	birthday: string
	notes: string
}

export type Contact = ContactInput & {
	id: string
	uid: string
	displayName: string
	addressBook: AddressBookInfo
	/** An image URL (data: or https:) */
	photo: string | null
	/** The address beyond the first one, kept as they are on edit */
	moreAddresses: number
}

const PRODID = '-//Aegean Logic//TeamsLogic//EN'
/** The properties the contact form writes; everything else in a card is kept as it is */
const MANAGED = new Set(['FN', 'N', 'ORG', 'TITLE', 'EMAIL', 'TEL', 'ADR', 'BDAY', 'NOTE', 'REV'])
/** Year Apple and Nextcloud use for a vCard 3.0 birthday without one */
const NO_YEAR = '1604'
/** A birthday as the app holds it: YYYY-MM-DD, or --MM-DD without a year (the year is group 1) */
export const BIRTHDAY = /^(?:(\d{4})|-)-(\d{2})-(\d{2})$/

let client: DavClient | null = null
let addressBooks: DavAddressBook[] = []
const cards = new Map<string, { card: DavVCard, book: DavAddressBook }>()
/** The contacts as last loaded, for searches from other apps (Calls) */
let cache: { at: number, contacts: Contact[] } | null = null
const CACHE_MS = 5 * 60 * 1000

/**
 * Connect to the user's address books (a CardDAV client of its own: Talk's connects for CalDAV only)
 */
async function connect(): Promise<DavClient> {
	if (!client) {
		client = new DavClient({ rootUrl: generateRemoteUrl('dav') })
	}
	await client.connect({ enableCardDAV: true })
	return client
}

/**
 * Describe an address book
 *
 * @param book - The address book
 */
function toAddressBookInfo(book: DavAddressBook): AddressBookInfo {
	const uri = book.url.replace(/\/$/, '').split('/').pop() ?? ''
	const synced = uri.match(/^teamslogic-(\d+)-/)
	return {
		url: book.url,
		name: book.displayname || uri,
		writable: book.isWriteable(),
		connectionId: synced ? Number(synced[1]) : null,
	}
}

/**
 * All contacts of all address books, sorted by name
 */
export async function loadContacts(): Promise<{ addressBooks: AddressBookInfo[], contacts: Contact[] }> {
	const dav = await connect()
	addressBooks = ((await dav.addressBookHomes[0]!.findAllAddressBooks()) as DavAddressBook[])
		.filter((book) => book.enabled !== false)
	cards.clear()
	const contacts: Contact[] = []
	const results = await Promise.allSettled(addressBooks.map(async (book) => ({ book, vcards: await book.findAllVCards() })))
	for (const result of results) {
		if (result.status !== 'fulfilled') {
			console.warn('Could not read an address book', result.reason)
			continue
		}
		const info = toAddressBookInfo(result.value.book)
		for (const card of result.value.vcards) {
			const contact = parseContact(card.url, card.data, info)
			if (contact) {
				cards.set(card.url, { card, book: result.value.book })
				contacts.push(contact)
			}
		}
	}
	const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
	contacts.sort((a, b) => collator.compare(a.displayName, b.displayName))
	cache = { at: Date.now(), contacts }
	return { addressBooks: addressBooks.map(toAddressBookInfo), contacts }
}

/**
 * A contact as last loaded, by its id
 *
 * @param id - The contact's id (its URL)
 */
export function getCachedContact(id: string): Contact | null {
	return cache?.contacts.find((contact) => contact.id === id) ?? null
}

/**
 * Contacts matching a search (name, company, email or phone), for the Calls search; read again after five minutes
 *
 * @param query - The search
 */
export async function searchContacts(query: string): Promise<Contact[]> {
	if (!cache || Date.now() - cache.at > CACHE_MS) {
		cache = { at: Date.now(), contacts: (await loadContacts()).contacts }
	}
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
	const digits = query.replace(/\D/g, '')
	if (!words.length) {
		return []
	}
	return cache.contacts.filter((contact) => {
		const haystack = [contact.displayName, contact.company, ...contact.emails.map((email) => email.value)].join(' ').toLowerCase()
		return words.every((word) => haystack.includes(word))
			|| (digits.length >= 4 && contact.phones.some((phone) => phone.value.replace(/\D/g, '').includes(digits)))
	})
}

/**
 * Add a contact to an address book
 *
 * @param addressBookUrl - The address book
 * @param input - The contact
 */
export async function createContact(addressBookUrl: string, input: ContactInput) {
	const book = addressBooks.find((item) => item.url === addressBookUrl)
	if (!book) {
		throw new Error(`No address book ${addressBookUrl}`)
	}
	await book.createVCard(writeVCard(null, input))
	await syncIfSynced(toAddressBookInfo(book))
}

/**
 * Save changes to a contact, keeping what the form doesn't show (photo, other properties)
 *
 * @param contact - The contact
 * @param input - Its new values
 */
export async function updateContact(contact: Contact, input: ContactInput) {
	const entry = cards.get(contact.id)
	if (!entry) {
		throw new Error(`No contact ${contact.id}`)
	}
	entry.card.data = writeVCard(entry.card.data, input)
	await entry.card.update()
	await syncIfSynced(contact.addressBook)
}

/**
 * Delete a contact
 *
 * @param contact - The contact
 */
export async function deleteContact(contact: Contact) {
	const entry = cards.get(contact.id)
	if (!entry) {
		return
	}
	await entry.card.delete()
	cards.delete(contact.id)
	await syncIfSynced(contact.addressBook)
}

/**
 * Send an address book's change to Google or Microsoft now rather than at the next background sync
 *
 * @param book - The address book
 */
async function syncIfSynced(book: AddressBookInfo) {
	if (book.connectionId === null) {
		return
	}
	await axios.post(generateOcsUrl('apps/teamslogic/api/v1/connections/{id}/sync', { id: book.connectionId }))
		.catch((error) => console.warn('Could not sync the address book now', error))
}

/**
 * Read a vCard
 *
 * @param id - Its URL
 * @param data - The vCard
 * @param addressBook - Its address book
 */
export function parseContact(id: string, data: string, addressBook: AddressBookInfo): Contact | null {
	let card: ICAL.Component
	try {
		card = new ICAL.Component(ICAL.parse(data))
	} catch (error) {
		console.warn('Could not read a contact', id, error)
		return null
	}
	// Some writers escape ; in plain text values too
	const text = (name: string) => String(card.getFirstPropertyValue(name) ?? '').replace(/\\;/g, ';').trim()
	const parts = (name: string): string[] => {
		const value = card.getFirstPropertyValue(name)
		if (Array.isArray(value)) {
			return value.map((part) => (Array.isArray(part) ? part.join(',') : String(part ?? '')))
		}
		return value === null || value === undefined ? [] : String(value).split(';')
	}
	const typesOf = (property: ICAL.Property) => ([] as unknown[]).concat(property.getParameter('type') ?? [])
		.flatMap((type) => String(type).toLowerCase().split(','))

	const [lastName = '', firstName = ''] = parts('n')
	const [company = ''] = parts('org')
	const emails = card.getAllProperties('email').map((property) => {
		const types = typesOf(property)
		return {
			type: types.includes('work') ? 'work' : types.includes('home') ? 'home' : 'other',
			value: String(property.getFirstValue() ?? '').trim(),
			preferred: types.includes('pref') || property.getParameter('pref') !== undefined,
		}
	}).filter((email) => email.value)
	// The preferred address first, as Outlook's "Email"
	emails.sort((a, b) => Number(b.preferred) - Number(a.preferred))
	const phones = card.getAllProperties('tel').map((property) => {
		const types = typesOf(property)
		return {
			type: types.includes('fax') ? 'fax' : types.includes('cell') ? 'mobile' : types.includes('work') ? 'work' : types.includes('home') ? 'home' : 'other',
			value: String(property.getFirstValue() ?? '').trim(),
		}
	}).filter((phone) => phone.value)
	const addresses = card.getAllProperties('adr').map((property) => {
		const value = property.getFirstValue()
		const [, extended = '', street = '', city = '', region = '', postcode = '', country = ''] = (Array.isArray(value) ? value : String(value ?? '').split(';'))
			.map((part) => (Array.isArray(part) ? part.join(', ') : String(part ?? '')))
		const types = typesOf(property)
		return {
			type: types.includes('work') ? 'work' : types.includes('home') ? 'home' : 'other',
			street: [street, extended].filter(Boolean).join('\n'),
			city,
			region,
			postcode,
			country,
		}
	})

	const bdayProperty = card.getFirstProperty('bday')
	let birthday = bdayProperty ? String(bdayProperty.getFirstValue() ?? '') : ''
	const dateMatch = birthday.match(/^(\d{4}|--)-?(\d{2})-?(\d{2})/)
	if (dateMatch) {
		const noYear = dateMatch[1] === '--' || dateMatch[1] === NO_YEAR || bdayProperty?.getParameter('x-apple-omit-year') !== undefined
		birthday = noYear ? `--${dateMatch[2]}-${dateMatch[3]}` : `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
	}

	const displayName = text('fn')
		|| [firstName, lastName].filter(Boolean).join(' ')
		|| company
		|| emails[0]?.value
		|| ''

	return {
		id,
		uid: text('uid'),
		displayName,
		addressBook,
		firstName,
		lastName,
		company,
		jobTitle: text('title'),
		emails: emails.map(({ type, value }) => ({ type, value })),
		phones,
		address: addresses[0] ?? null,
		moreAddresses: Math.max(0, addresses.length - 1),
		birthday,
		notes: text('note'),
		photo: photoOf(card),
	}
}

/**
 * The contact's photo as an image URL
 *
 * @param card - The vCard
 */
function photoOf(card: ICAL.Component): string | null {
	const property = card.getFirstProperty('photo')
	if (!property) {
		return null
	}
	const value = String(property.getFirstValue() ?? '')
	if (/^(?:data:image\/|https:\/\/)/.test(value)) {
		return value
	}
	const encoding = String(property.getParameter('encoding') ?? '').toLowerCase()
	if (encoding === 'b' || encoding === 'base64') {
		const type = String(property.getParameter('type') ?? 'jpeg').toLowerCase().replace(/^image\//, '')
		return `data:image/${type};base64,${value.replace(/\s/g, '')}`
	}
	return null
}

/**
 * Write a vCard: the form's properties replaced, everything else (photo, UID, other properties) kept
 *
 * @param existing - The card as it is, or null for a new one
 * @param input - The form's values
 */
export function writeVCard(existing: string | null, input: ContactInput): string {
	const lines = existing
		? existing.replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter((line) => line.trim() !== '')
		: ['BEGIN:VCARD', 'VERSION:3.0', `PRODID:${PRODID}`, `UID:${crypto.randomUUID()}`, 'END:VCARD']
	const version4 = lines.some((line) => /^VERSION:4/i.test(line))

	// Drop the managed properties (of addresses only the first, the one the form shows), and Apple's labels
	// grouped with them (item1.EMAIL, item1.X-ABLABEL)
	const nameOf = (line: string) => line.split(/[;:]/)[0]!.toUpperCase()
	const firstAdr = lines.findIndex((line) => nameOf(line).replace(/^[^.]+\./, '') === 'ADR')
	const isManaged = (line: string, index: number) => {
		const name = nameOf(line).replace(/^[^.]+\./, '')
		return MANAGED.has(name) && (name !== 'ADR' || index === firstAdr)
	}
	const droppedGroups = new Set(lines
		.filter((line, index) => isManaged(line, index) && nameOf(line).includes('.'))
		.map((line) => nameOf(line).split('.')[0]))
	const kept = lines.filter((line, index) => {
		const name = nameOf(line)
		const group = name.includes('.') ? name.split('.')[0]! : null
		return !isManaged(line, index) && !(group && droppedGroups.has(group)) && name !== 'END'
	})

	const fn = [input.firstName, input.lastName].map((part) => part.trim()).filter(Boolean).join(' ')
		|| input.company.trim()
		|| input.emails.find((email) => email.value.trim())?.value.trim()
		|| ''
	const added = [
		`FN:${escape(fn)}`,
		`N:${[input.lastName, input.firstName, '', '', ''].map((part) => escape(part.trim(), true)).join(';')}`,
	]
	if (input.company.trim()) {
		added.push(`ORG:${escape(input.company.trim(), true)}`)
	}
	if (input.jobTitle.trim()) {
		added.push(`TITLE:${escape(input.jobTitle.trim())}`)
	}
	input.emails.filter((email) => email.value.trim()).forEach((email, index) => {
		const types = version4 ? [] : ['INTERNET']
		if (email.type === 'work' || email.type === 'home') {
			types.push(email.type.toUpperCase())
		}
		if (index === 0) {
			types.push(version4 ? '' : 'PREF')
		}
		const params = [types.filter(Boolean).length ? `TYPE=${types.filter(Boolean).join(',')}` : '', index === 0 && version4 ? 'PREF=1' : '']
			.filter(Boolean).map((param) => `;${param}`).join('')
		added.push(`EMAIL${params}:${escape(email.value.trim())}`)
	})
	for (const phone of input.phones.filter((item) => item.value.trim())) {
		const types = ({ mobile: ['CELL'], work: ['WORK', 'VOICE'], home: ['HOME', 'VOICE'], fax: ['FAX'] } as Record<string, string[]>)[phone.type] ?? ['VOICE']
		added.push(`TEL;TYPE=${types.join(',')}:${escape(phone.value.trim())}`)
	}
	if (input.address && [input.address.street, input.address.city, input.address.region, input.address.postcode, input.address.country].some((part) => part.trim())) {
		const { type, street, city, region, postcode, country } = input.address
		const [firstLine = '', ...rest] = street.trim().split(/\r?\n/)
		const typeParam = type === 'work' || type === 'home' ? `;TYPE=${type.toUpperCase()}` : ''
		added.push(`ADR${typeParam}:${['', rest.join(', '), firstLine, city, region, postcode, country].map((part) => escape(part.trim(), true)).join(';')}`)
	}
	const birthday = input.birthday.match(BIRTHDAY)
	if (birthday) {
		if (birthday[1]) {
			added.push(`BDAY;VALUE=DATE:${birthday[1]}-${birthday[2]}-${birthday[3]}`)
		} else if (version4) {
			added.push(`BDAY:--${birthday[2]}${birthday[3]}`)
		} else {
			added.push(`BDAY;X-APPLE-OMIT-YEAR=${NO_YEAR}:${NO_YEAR}-${birthday[2]}-${birthday[3]}`)
		}
	}
	if (input.notes.trim()) {
		added.push(`NOTE:${escape(input.notes.trim())}`)
	}
	added.push(`REV:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`)

	return [...kept, ...added, 'END:VCARD'].map(fold).join('\r\n') + '\r\n'
}

/**
 * Escape a vCard text value (RFC 6350 3.4: ; only inside a structured value, where it separates the parts)
 *
 * @param value - The text
 * @param component - A part of a structured value (N, ORG, ADR)
 */
function escape(value: string, component = false): string {
	const escaped = value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,')
	return component ? escaped.replace(/;/g, '\\;') : escaped
}

/**
 * Fold a content line at 75 characters, as vCard asks
 *
 * @param line - The line
 */
function fold(line: string): string {
	if (line.length <= 75) {
		return line
	}
	const chunks = [line.slice(0, 75)]
	for (let i = 75; i < line.length; i += 74) {
		chunks.push(' ' + line.slice(i, i + 74))
	}
	return chunks.join('\r\n')
}
