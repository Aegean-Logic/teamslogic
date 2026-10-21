<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { AutocompleteEntry } from '../talk.api.ts'

import { t } from '@nextcloud/l10n'
import { ref } from 'vue'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import { searchContacts } from '../People/people.service.ts'
import { searchPeople } from '../talk.api.ts'

const modelValue = defineModel<AutocompleteEntry[] | AutocompleteEntry | null>({ default: null })

const props = withDefaults(defineProps<{
	inputLabel: string
	placeholder?: string
	multiple?: boolean
	onlyUsers?: boolean
	withEmails?: boolean
	/** Also the user's address books (People): options with source "contacts" and the contact's id */
	withContacts?: boolean
}>(), {
	placeholder: '',
	multiple: false,
	onlyUsers: false,
	withEmails: false,
	withContacts: false,
})

type Option = AutocompleteEntry & { key: string, displayName: string, subname?: string, isNoUser?: boolean, user?: string }

const options = ref<Option[]>([])
const loading = ref(false)
let searchTimer: number | undefined
let lastSearch = ''

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Search people as the user types
 *
 * @param query - Search text
 */
function onSearch(query: string) {
	lastSearch = query
	window.clearTimeout(searchTimer)
	if (!query.trim()) {
		options.value = []
		return
	}
	loading.value = true
	searchTimer = window.setTimeout(async () => {
		try {
			const [entries, contacts] = await Promise.all([
				searchPeople(query, { onlyUsers: props.onlyUsers, withEmails: props.withEmails }),
				props.withContacts ? searchContacts(query).catch(() => []) : Promise.resolve([]),
			])
			if (query !== lastSearch) {
				return
			}
			options.value = entries.map((entry) => ({
				...entry,
				key: `${entry.source}/${entry.id}`,
				displayName: entry.label,
				subname: entry.source === 'groups' ? t('talk_desktop', 'Group') : (entry.subline || entry.shareWithDisplayNameUnique),
				user: entry.source === 'users' ? entry.id : undefined,
				isNoUser: entry.source !== 'users',
			}))
			// Contacts from People, unless they are already here as a user or guest with the same address
			const listed = new Set(options.value.flatMap((option) => [option.id, option.shareWithDisplayNameUnique]).filter(Boolean).map((value) => String(value).toLowerCase()))
			for (const contact of contacts.slice(0, 10)) {
				if (contact.emails.some((email) => listed.has(email.value.toLowerCase()))) {
					continue
				}
				options.value.push({
					id: contact.id,
					label: contact.displayName,
					source: 'contacts',
					key: `contacts/${contact.id}`,
					displayName: contact.displayName,
					subname: contact.emails[0]?.value ?? contact.phones[0]?.value ?? contact.addressBook.name,
					isNoUser: true,
				})
			}
			// Anyone outside the organisation by email address, as in Teams
			if (props.withEmails && EMAIL_RE.test(query) && !options.value.some((option) => option.id === query)) {
				options.value.push({ id: query, label: query, source: 'emails', key: `emails/${query}`, displayName: query, subname: t('talk_desktop', 'Guest by email'), isNoUser: true })
			}
		} catch (error) {
			console.warn('Could not search people', error)
		} finally {
			loading.value = false
		}
	}, 250)
}
</script>

<template>
	<NcSelect
		v-model="modelValue"
		class="people-picker"
		:inputLabel="inputLabel"
		:placeholder="placeholder"
		:options="options"
		:multiple="multiple"
		:loading="loading"
		:filterable="false"
		:closeOnSelect="!multiple"
		label="displayName"
		userSelect
		@search="onSearch" />
</template>

<style scoped>
.people-picker {
	width: 100%;
}
</style>
