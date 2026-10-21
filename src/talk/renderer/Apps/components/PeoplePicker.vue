<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { AutocompleteEntry } from '../talk.api.ts'

import { t } from '@nextcloud/l10n'
import { ref } from 'vue'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import { searchPeople } from '../talk.api.ts'

const modelValue = defineModel<AutocompleteEntry[] | AutocompleteEntry | null>({ default: null })

const props = withDefaults(defineProps<{
	inputLabel: string
	placeholder?: string
	multiple?: boolean
	onlyUsers?: boolean
	withEmails?: boolean
}>(), {
	placeholder: '',
	multiple: false,
	onlyUsers: false,
	withEmails: false,
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
			const entries = await searchPeople(query, { onlyUsers: props.onlyUsers, withEmails: props.withEmails })
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
