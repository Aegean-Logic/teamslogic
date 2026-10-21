<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { AddressBookInfo, Contact, ContactInput } from './people.service.ts'

import { showError } from '@nextcloud/dialogs'
import { getCanonicalLocale, t } from '@nextcloud/l10n'
import { computed, onMounted, ref } from 'vue'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import AppListItem from '../components/AppListItem.vue'
import AppPane from '../components/AppPane.vue'
import AppStage from '../components/AppStage.vue'
import ContactDialog from './ContactDialog.vue'
import { useShellStore } from '../../AppRail/shell.store.ts'
import { readStored, writeStored } from '../apps.utils.ts'
import { useMailStore } from '../Mail/mail.store.ts'
import { useAppShown } from '../useAppShown.ts'
import { callHint, canReach, talkWithContact } from './contact.actions.ts'
import { BIRTHDAY, createContact, deleteContact, loadContacts, updateContact } from './people.service.ts'

const shellStore = useShellStore()
const mailStore = useMailStore()
const locale = getCanonicalLocale()

const addressBooks = ref<AddressBookInfo[]>([])
const contacts = ref<Contact[]>([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const selectedId = ref<string | null>(null)

const ALL_BOOKS = { url: '', name: t('talk_desktop', 'All contacts') }
const bookFilter = ref<{ url: string, name: string }>(ALL_BOOKS)
const bookOptions = computed(() => [ALL_BOOKS, ...addressBooks.value.map((book) => ({ url: book.url, name: book.name }))])

/** The form: a contact to edit, 'new', or closed */
const editing = ref<Contact | 'new' | null>(null)
const saving = ref(false)
const saveError = ref('')
const confirmDelete = ref(false)

/** The address book new contacts go to: the one last used */
const lastBookUrl = ref<string | null>(readStored<string | null>('teamslogic:people:book', null))

const shownContacts = computed(() => {
	const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
	return contacts.value.filter((contact) => {
		if (bookFilter.value.url && contact.addressBook.url !== bookFilter.value.url) {
			return false
		}
		if (!words.length) {
			return true
		}
		const haystack = [contact.displayName, contact.company, contact.jobTitle, ...contact.emails.map((email) => email.value), ...contact.phones.map((phone) => phone.value)]
			.join(' ').toLowerCase()
		return words.every((word) => haystack.includes(word))
	})
})

const selected = computed(() => contacts.value.find((contact) => contact.id === selectedId.value) ?? null)

const TYPE_LABELS: Record<string, string> = {
	work: t('talk_desktop', 'Work'),
	home: t('talk_desktop', 'Personal'),
	mobile: t('talk_desktop', 'Mobile'),
	fax: t('talk_desktop', 'Fax'),
	other: t('talk_desktop', 'Other'),
}

/**
 * Load the address books and contacts, keeping the selection when it still exists
 */
async function refresh() {
	try {
		const result = await loadContacts()
		addressBooks.value = result.addressBooks
		contacts.value = result.contacts
		error.value = ''
		if (bookFilter.value.url && !result.addressBooks.some((book) => book.url === bookFilter.value.url)) {
			bookFilter.value = ALL_BOOKS
		}
	} catch (exception) {
		console.error('Could not load the contacts', exception)
		error.value = t('talk_desktop', 'Your contacts could not be loaded.')
	} finally {
		loading.value = false
	}
}

/**
 * Save the form: a new contact or the changes
 *
 * @param input - The values
 * @param addressBookUrl - The address book (for a new contact)
 */
async function save(input: ContactInput, addressBookUrl: string) {
	saving.value = true
	saveError.value = ''
	try {
		const contact = editing.value
		if (contact === 'new') {
			await createContact(addressBookUrl, input)
			lastBookUrl.value = addressBookUrl
			writeStored('teamslogic:people:book', addressBookUrl)
		} else if (contact) {
			await updateContact(contact, input)
		}
		const uid = contact !== 'new' ? contact?.uid : null
		const name = [input.firstName, input.lastName].map((part) => part.trim()).filter(Boolean).join(' ')
		await refresh()
		// Show the contact just saved
		selectedId.value = contacts.value.find((item) => (uid ? item.uid === uid : item.displayName === name && item.addressBook.url === addressBookUrl))?.id ?? selectedId.value
		editing.value = null
	} catch (exception) {
		console.error('Could not save the contact', exception)
		saveError.value = t('talk_desktop', 'The contact could not be saved. Please try again.')
	} finally {
		saving.value = false
	}
}

/**
 * Delete the selected contact, once confirmed
 */
async function remove() {
	const contact = selected.value
	confirmDelete.value = false
	if (!contact) {
		return
	}
	try {
		await deleteContact(contact)
		selectedId.value = null
		await refresh()
	} catch (exception) {
		console.error('Could not delete the contact', exception)
		error.value = t('talk_desktop', 'The contact could not be deleted.')
	}
}

/**
 * Write to a contact in Mail
 *
 * @param contact - The contact
 * @param email - The address
 */
async function sendEmail(contact: Contact, email: string) {
	if (!mailStore.accounts.length) {
		await mailStore.loadAccounts().catch(() => {})
	}
	mailStore.compose = {
		mode: 'new',
		source: null,
		draft: {
			accountId: mailStore.accounts[0]?.id ?? 0,
			to: [{ label: contact.displayName, email }],
			cc: [],
			bcc: [],
			subject: '',
			html: '<p><br></p>',
			attachments: [],
			forwarded: [],
			draftId: null,
		},
	}
	shellStore.showApp('mail')
}

/**
 * Call or chat with a contact in Talk
 *
 * @param contact - The contact
 * @param call - Join a call, or only open the chat
 */
async function contactAction(contact: Contact, call: boolean) {
	try {
		await talkWithContact(contact, call)
	} catch (exception) {
		console.error('Could not start the conversation', exception)
		showError(call ? t('talk_desktop', 'Could not start the call') : t('talk_desktop', 'Could not start the chat'))
	}
}

/**
 * A birthday for display
 *
 * @param value - YYYY-MM-DD or --MM-DD
 */
function formatBirthday(value: string) {
	const match = value.match(BIRTHDAY)
	if (!match) {
		return value
	}
	const date = new Date(match[1] ? Number(match[1]) : 2000, Number(match[2]) - 1, Number(match[3]))
	return date.toLocaleDateString(locale, match[1] ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' })
}

/**
 * A postal address on lines
 *
 * @param contact - The contact
 */
function formatAddress(contact: Contact) {
	const address = contact.address
	if (!address) {
		return ''
	}
	return [address.street, [address.city, address.region].filter(Boolean).join(', '), address.postcode, address.country]
		.filter((part) => part.trim()).join('\n')
}

/**
 * Job title and company, as Outlook shows them under the name
 *
 * @param contact - The contact
 */
function roleOf(contact: Contact) {
	return [contact.jobTitle, contact.company].filter(Boolean).join(' · ')
}

onMounted(refresh)
// Contacts change elsewhere too (synced from Outlook or Google, the Contacts app, a phone)
useAppShown('people', refresh)
</script>

<template>
	<div class="people-app">
		<AppPane :title="t('talk_desktop', 'People')">
			<template #actions>
				<NcButton
					variant="tertiary"
					:aria-label="t('talk_desktop', 'New contact')"
					:title="t('talk_desktop', 'New contact')"
					@click="saveError = ''; editing = 'new'">
					<template #icon>
						<FluentIcon name="add" :size="20" />
					</template>
				</NcButton>
			</template>
			<template #toolbar>
				<div class="people-app__toolbar">
					<NcTextField
						v-model="search"
						type="search"
						:label="t('talk_desktop', 'Search contacts')"
						:showTrailingButton="search !== ''"
						@trailingButtonClick="search = ''">
						<template #icon>
							<FluentIcon name="search" :size="16" />
						</template>
					</NcTextField>
					<NcSelect
						v-if="addressBooks.length > 1"
						v-model="bookFilter"
						:options="bookOptions"
						label="name"
						:inputLabel="t('talk_desktop', 'Address book')"
						labelOutside
						:clearable="false" />
				</div>
			</template>

			<NcLoadingIcon v-if="loading" :size="32" class="people-app__loading" />
			<ul v-else-if="shownContacts.length" class="people-app__list">
				<AppListItem
					v-for="contact in shownContacts"
					:key="contact.id"
					:active="contact.id === selectedId"
					@click="selectedId = contact.id">
					<template #icon>
						<NcAvatar
							:displayName="contact.displayName"
							:url="contact.photo ?? undefined"
							:size="32"
							isNoUser
							disableMenu
							disableTooltip />
					</template>
					<template #title>
						{{ contact.displayName || t('talk_desktop', 'No name') }}
					</template>
					<template #subtitle>
						{{ contact.emails[0]?.value || roleOf(contact) || contact.phones[0]?.value }}
					</template>
				</AppListItem>
			</ul>
			<p v-else class="people-app__none">
				{{ search ? t('talk_desktop', 'No contacts match.') : t('talk_desktop', 'No contacts yet.') }}
			</p>
		</AppPane>

		<AppStage :title="selected?.displayName">
			<template v-if="selected && selected.addressBook.writable" #actions>
				<NcButton variant="secondary" @click="saveError = ''; editing = selected">
					<template #icon>
						<FluentIcon name="compose" :size="20" />
					</template>
					{{ t('talk_desktop', 'Edit') }}
				</NcButton>
				<NcButton
					variant="tertiary"
					:aria-label="t('talk_desktop', 'Delete')"
					:title="t('talk_desktop', 'Delete')"
					@click="confirmDelete = true">
					<template #icon>
						<FluentIcon name="trash" :size="20" />
					</template>
				</NcButton>
			</template>

			<NcEmptyContent
				v-if="error"
				:name="error">
				<template #icon>
					<FluentIcon name="people" :size="48" />
				</template>
			</NcEmptyContent>
			<div v-else-if="selected" class="people-app__card">
				<div class="people-app__identity">
					<NcAvatar
						:displayName="selected.displayName"
						:url="selected.photo ?? undefined"
						:size="96"
						isNoUser
						disableMenu
						disableTooltip />
					<div>
						<h3 class="people-app__name">
							{{ selected.displayName || t('talk_desktop', 'No name') }}
						</h3>
						<p v-if="roleOf(selected)" class="people-app__role">
							{{ roleOf(selected) }}
						</p>
						<div class="people-app__quick">
							<NcButton
								v-if="selected.emails.length"
								variant="primary"
								@click="sendEmail(selected, selected.emails[0]!.value)">
								<template #icon>
									<FluentIcon name="mail" :size="20" />
								</template>
								{{ t('talk_desktop', 'Send email') }}
							</NcButton>
							<NcButton
								v-if="canReach(selected).call"
								variant="secondary"
								:title="callHint(selected)"
								@click="contactAction(selected, true)">
								<template #icon>
									<FluentIcon name="call" :size="20" />
								</template>
								{{ t('talk_desktop', 'Call') }}
							</NcButton>
							<NcButton
								v-if="canReach(selected).chat"
								variant="secondary"
								:title="t('talk_desktop', '{email} gets an email with a link to the chat', { email: selected.emails[0]!.value })"
								@click="contactAction(selected, false)">
								<template #icon>
									<FluentIcon name="chatSmall" :size="20" />
								</template>
								{{ t('talk_desktop', 'Chat') }}
							</NcButton>
						</div>
					</div>
				</div>

				<dl class="people-app__details">
					<div v-for="email in selected.emails" :key="`e-${email.value}`" class="people-app__row">
						<dt><FluentIcon name="mail" :size="20" /></dt>
						<dd>
							<a href="#" @click.prevent="sendEmail(selected, email.value)">{{ email.value }}</a>
							<span class="people-app__muted">{{ TYPE_LABELS[email.type] }}</span>
						</dd>
					</div>
					<div v-for="phone in selected.phones" :key="`p-${phone.value}`" class="people-app__row">
						<dt><FluentIcon name="call" :size="20" /></dt>
						<dd>
							<a :href="`tel:${phone.value.replace(/[^\d+]/g, '')}`">{{ phone.value }}</a>
							<span class="people-app__muted">{{ TYPE_LABELS[phone.type] }}</span>
						</dd>
					</div>
					<div v-if="formatAddress(selected)" class="people-app__row">
						<dt><FluentIcon name="location" :size="20" /></dt>
						<dd class="people-app__multiline">
							{{ formatAddress(selected) }}
							<span class="people-app__muted">{{ TYPE_LABELS[selected.address!.type] }}</span>
						</dd>
					</div>
					<div v-if="selected.birthday" class="people-app__row">
						<dt><FluentIcon name="calendar" :size="20" /></dt>
						<dd>
							{{ formatBirthday(selected.birthday) }}
							<span class="people-app__muted">{{ t('talk_desktop', 'Birthday') }}</span>
						</dd>
					</div>
					<div v-if="selected.notes" class="people-app__row">
						<dt><FluentIcon name="textDescription" :size="20" /></dt>
						<dd class="people-app__multiline">
							{{ selected.notes }}
						</dd>
					</div>
					<div class="people-app__row">
						<dt><FluentIcon name="people" :size="20" /></dt>
						<dd>
							{{ selected.addressBook.name }}
							<span v-if="!selected.addressBook.writable" class="people-app__muted">{{ t('talk_desktop', 'Read only') }}</span>
						</dd>
					</div>
				</dl>
			</div>
			<NcEmptyContent
				v-else-if="!loading"
				:name="t('talk_desktop', 'Select a contact')"
				:description="t('talk_desktop', 'Your contacts from Nextcloud, and from Outlook or Google when your account is connected.')">
				<template #icon>
					<FluentIcon name="people" :size="48" />
				</template>
				<template #action>
					<NcButton variant="primary" @click="saveError = ''; editing = 'new'">
						<template #icon>
							<FluentIcon name="add" :size="20" />
						</template>
						{{ t('talk_desktop', 'New contact') }}
					</NcButton>
				</template>
			</NcEmptyContent>
		</AppStage>

		<ContactDialog
			v-if="editing"
			:contact="editing === 'new' ? null : editing"
			:addressBooks="addressBooks"
			:defaultAddressBookUrl="lastBookUrl"
			:busy="saving"
			:error="saveError"
			@close="editing = null"
			@save="save" />

		<NcDialog
			v-if="confirmDelete && selected"
			:name="t('talk_desktop', 'Delete contact')"
			:message="selected.addressBook.connectionId !== null
				? t('talk_desktop', 'Delete {name}? It is deleted from {book} in your connected account too.', { name: selected.displayName, book: selected.addressBook.name })
				: t('talk_desktop', 'Delete {name}?', { name: selected.displayName })"
			:buttons="[
				{ label: t('talk_desktop', 'Cancel'), callback: () => { confirmDelete = false } },
				{ label: t('talk_desktop', 'Delete'), variant: 'error', callback: remove },
			]"
			@update:open="(open) => !open && (confirmDelete = false)" />
	</div>
</template>

<style scoped>
.people-app {
	display: flex;
	flex: 1 1 auto;
	min-width: 0;
}

.people-app__toolbar {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.people-app__loading {
	margin-block-start: 24px;
}

.people-app__list {
	margin: 0;
	padding: 0;
}

.people-app__none {
	margin: 8px;
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}

.people-app__card {
	display: flex;
	flex-direction: column;
	gap: 24px;
	max-width: 720px;
	padding: 24px;
}

.people-app__identity {
	display: flex;
	align-items: center;
	gap: 20px;
}

.people-app__name {
	margin: 0;
	font-size: 24px;
	font-weight: 600;
	line-height: 32px;
}

.people-app__role {
	margin: 2px 0 0;
	color: var(--teamslogic-foreground-3);
}

.people-app__quick {
	display: flex;
	gap: 8px;
	margin-block-start: 12px;
}

.people-app__details {
	display: flex;
	flex-direction: column;
	gap: 14px;
	margin: 0;
	padding: 16px 20px;
	border-radius: var(--border-radius-large);
	background-color: var(--teamslogic-surface);
	box-shadow: var(--teamslogic-shadow-2);
}

.people-app__row {
	display: flex;
	gap: 12px;

	dt {
		display: flex;
		flex: 0 0 20px;
		justify-content: center;
		color: var(--teamslogic-foreground-3);
	}

	dd {
		display: flex;
		flex: 1 1 auto;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 8px;
		min-width: 0;
		margin: 0;
		overflow-wrap: anywhere;
	}

	a {
		color: var(--color-primary-element-text, var(--color-primary-element));
	}
}

.people-app__multiline {
	white-space: pre-line;
}

.people-app__muted {
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}
</style>
