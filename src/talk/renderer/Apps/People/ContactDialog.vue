<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { AddressBookInfo, Contact, ContactField, ContactInput } from './people.service.ts'

import { t } from '@nextcloud/l10n'
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDateTimePickerNative from '@nextcloud/vue/components/NcDateTimePickerNative'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import { BIRTHDAY } from './people.service.ts'

const props = defineProps<{
	/** The contact to edit, or null for a new one */
	contact: Contact | null
	addressBooks: AddressBookInfo[]
	/** The address book a new contact goes to first */
	defaultAddressBookUrl: string | null
	/** Saving now */
	busy: boolean
	/** Why the last save failed */
	error: string
}>()

const emit = defineEmits<{
	close: []
	save: [input: ContactInput, addressBookUrl: string]
}>()

type Option = { id: string, label: string }

const EMAIL_TYPES: Option[] = [
	{ id: 'work', label: t('talk_desktop', 'Work') },
	{ id: 'home', label: t('talk_desktop', 'Personal') },
	{ id: 'other', label: t('talk_desktop', 'Other') },
]
const PHONE_TYPES: Option[] = [
	{ id: 'mobile', label: t('talk_desktop', 'Mobile') },
	{ id: 'work', label: t('talk_desktop', 'Work') },
	{ id: 'home', label: t('talk_desktop', 'Home') },
	{ id: 'fax', label: t('talk_desktop', 'Fax') },
	{ id: 'other', label: t('talk_desktop', 'Other') },
]
const ADDRESS_TYPES: Option[] = [
	{ id: 'work', label: t('talk_desktop', 'Work') },
	{ id: 'home', label: t('talk_desktop', 'Home') },
	{ id: 'other', label: t('talk_desktop', 'Other') },
]

const writableBooks = computed(() => props.addressBooks.filter((book) => book.writable))

/**
 * The address book a new contact starts in
 */
function initialBook() {
	return writableBooks.value.find((book) => book.url === props.defaultAddressBookUrl) ?? writableBooks.value[0] ?? null
}

/**
 * A row of the email or phone list, with its type as a select option
 *
 * @param field - The value
 * @param types - The type options
 */
function toRow(field: ContactField, types: Option[]) {
	return { type: types.find((type) => type.id === field.type) ?? types[types.length - 1]!, value: field.value }
}

const source = props.contact
const firstName = ref(source?.firstName ?? '')
const lastName = ref(source?.lastName ?? '')
const company = ref(source?.company ?? '')
const jobTitle = ref(source?.jobTitle ?? '')
const emails = ref((source?.emails.length ? source.emails : [{ type: 'work', value: '' }]).map((field) => toRow(field, EMAIL_TYPES)))
const phones = ref((source?.phones.length ? source.phones : [{ type: 'mobile', value: '' }]).map((field) => toRow(field, PHONE_TYPES)))
const addressType = ref(ADDRESS_TYPES.find((type) => type.id === source?.address?.type) ?? ADDRESS_TYPES[0]!)
const street = ref(source?.address?.street ?? '')
const city = ref(source?.address?.city ?? '')
const region = ref(source?.address?.region ?? '')
const postcode = ref(source?.address?.postcode ?? '')
const country = ref(source?.address?.country ?? '')
const notes = ref(source?.notes ?? '')
const addressBook = ref<AddressBookInfo | null>(source?.addressBook ?? initialBook())

// The date field needs a year: a birthday without one shows this year, and is saved without it unless changed
const birthdayMatch = (source?.birthday ?? '').match(BIRTHDAY)
const birthdayHadNoYear = Boolean(birthdayMatch && !birthdayMatch[1])
const initialDate = birthdayMatch
	? new Date(birthdayHadNoYear ? new Date().getFullYear() : Number(birthdayMatch[1]), Number(birthdayMatch[2]) - 1, Number(birthdayMatch[3]))
	: null
const birthday = ref<Date | null>(initialDate)
const initialBirthday = initialDate?.getTime() ?? null

const hasName = computed(() => [firstName.value, lastName.value, company.value].some((value) => value.trim())
	|| emails.value.some((email) => email.value.trim()))
const isValid = computed(() => hasName.value && addressBook.value !== null && addressBook.value.writable)

/**
 * The birthday as YYYY-MM-DD, or --MM-DD if it had no year and wasn't changed
 */
function birthdayValue(): string {
	const date = birthday.value
	if (!date || Number.isNaN(date.getTime())) {
		return ''
	}
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	return birthdayHadNoYear && date.getTime() === initialBirthday ? `--${month}-${day}` : `${date.getFullYear()}-${month}-${day}`
}

/**
 * Hand the values to the app to save
 */
function save() {
	if (!isValid.value || props.busy) {
		return
	}
	emit('save', {
		firstName: firstName.value,
		lastName: lastName.value,
		company: company.value,
		jobTitle: jobTitle.value,
		emails: emails.value.map((row) => ({ type: row.type.id, value: row.value })),
		phones: phones.value.map((row) => ({ type: row.type.id, value: row.value })),
		address: { type: addressType.value.id, street: street.value, city: city.value, region: region.value, postcode: postcode.value, country: country.value },
		birthday: birthdayValue(),
		notes: notes.value,
	}, addressBook.value!.url)
}
</script>

<template>
	<NcDialog
		:name="contact ? t('talk_desktop', 'Edit contact') : t('talk_desktop', 'New contact')"
		size="normal"
		isForm
		@update:open="(open) => !open && emit('close')"
		@submit="save">
		<div class="contact-form">
			<div class="contact-form__pair">
				<NcTextField v-model="firstName" :label="t('talk_desktop', 'First name')" />
				<NcTextField v-model="lastName" :label="t('talk_desktop', 'Last name')" />
			</div>
			<div class="contact-form__pair">
				<NcTextField v-model="company" :label="t('talk_desktop', 'Company')" />
				<NcTextField v-model="jobTitle" :label="t('talk_desktop', 'Job title')" />
			</div>

			<fieldset class="contact-form__group">
				<legend>{{ t('talk_desktop', 'Email') }}</legend>
				<div v-for="(row, index) in emails" :key="`email-${index}`" class="contact-form__row">
					<NcSelect
						v-model="row.type"
						class="contact-form__type"
						:options="EMAIL_TYPES"
						:inputLabel="t('talk_desktop', 'Type')"
						labelOutside
						:clearable="false" />
					<NcTextField v-model="row.value" type="email" :label="t('talk_desktop', 'Email address')" />
					<NcButton variant="tertiary" :aria-label="t('talk_desktop', 'Remove')" @click="emails.splice(index, 1)">
						<template #icon>
							<FluentIcon name="dismiss" :size="20" />
						</template>
					</NcButton>
				</div>
				<NcButton variant="tertiary" @click="emails.push({ type: EMAIL_TYPES[0]!, value: '' })">
					<template #icon>
						<FluentIcon name="add" :size="20" />
					</template>
					{{ t('talk_desktop', 'Add email') }}
				</NcButton>
			</fieldset>

			<fieldset class="contact-form__group">
				<legend>{{ t('talk_desktop', 'Phone') }}</legend>
				<div v-for="(row, index) in phones" :key="`phone-${index}`" class="contact-form__row">
					<NcSelect
						v-model="row.type"
						class="contact-form__type"
						:options="PHONE_TYPES"
						:inputLabel="t('talk_desktop', 'Type')"
						labelOutside
						:clearable="false" />
					<NcTextField v-model="row.value" type="tel" :label="t('talk_desktop', 'Phone number')" />
					<NcButton variant="tertiary" :aria-label="t('talk_desktop', 'Remove')" @click="phones.splice(index, 1)">
						<template #icon>
							<FluentIcon name="dismiss" :size="20" />
						</template>
					</NcButton>
				</div>
				<NcButton variant="tertiary" @click="phones.push({ type: PHONE_TYPES[0]!, value: '' })">
					<template #icon>
						<FluentIcon name="add" :size="20" />
					</template>
					{{ t('talk_desktop', 'Add phone') }}
				</NcButton>
			</fieldset>

			<fieldset class="contact-form__group">
				<legend>{{ t('talk_desktop', 'Address') }}</legend>
				<NcSelect
					v-model="addressType"
					class="contact-form__type"
					:options="ADDRESS_TYPES"
					:inputLabel="t('talk_desktop', 'Type')"
					labelOutside
					:clearable="false" />
				<NcTextArea
					v-model="street"
					:label="t('talk_desktop', 'Street')"
					resize="vertical"
					rows="2" />
				<div class="contact-form__pair">
					<NcTextField v-model="city" :label="t('talk_desktop', 'City')" />
					<NcTextField v-model="region" :label="t('talk_desktop', 'County or state')" />
				</div>
				<div class="contact-form__pair">
					<NcTextField v-model="postcode" :label="t('talk_desktop', 'Postcode')" />
					<NcTextField v-model="country" :label="t('talk_desktop', 'Country')" />
				</div>
				<p v-if="contact?.moreAddresses" class="contact-form__hint">
					{{ t('talk_desktop', 'This contact has more addresses; they are kept as they are.') }}
				</p>
			</fieldset>

			<NcDateTimePickerNative v-model="birthday" type="date" :label="t('talk_desktop', 'Birthday')" />
			<NcTextArea v-model="notes" :label="t('talk_desktop', 'Notes')" resize="vertical" />

			<NcSelect
				v-if="!contact && writableBooks.length > 1"
				v-model="addressBook"
				:inputLabel="t('talk_desktop', 'Save to')"
				:options="writableBooks"
				label="name"
				:clearable="false" />
			<p v-if="addressBook?.connectionId !== null && addressBook" class="contact-form__hint">
				{{ t('talk_desktop', 'This address book syncs with your {name} account: the change goes there too.', { name: addressBook.name.split(' · ')[0] ?? '' }) }}
			</p>
			<NcNoteCard v-if="!writableBooks.length" type="warning" :text="t('talk_desktop', 'You have no address book you can add contacts to.')" />
			<NcNoteCard v-if="error" type="error" :text="error" />
		</div>

		<template #actions>
			<NcButton variant="tertiary" @click="emit('close')">
				{{ t('talk_desktop', 'Cancel') }}
			</NcButton>
			<NcButton variant="primary" type="submit" :disabled="!isValid || busy">
				{{ busy ? t('talk_desktop', 'Saving…') : t('talk_desktop', 'Save') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.contact-form {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding-block: 4px;
}

.contact-form__pair {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 12px;
}

.contact-form__group {
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 8px;
	margin: 0;
	padding: 0;
	border: none;

	legend {
		margin-block-end: 4px;
		font-weight: 600;
	}

	> .button-vue {
		align-self: flex-start;
	}
}

.contact-form__row {
	display: flex;
	align-items: flex-end;
	gap: 8px;

	> :nth-child(2) {
		flex: 1 1 auto;
		min-width: 0;
	}
}

.contact-form__type {
	flex: 0 0 140px;
	min-width: 140px;
}

.contact-form__hint {
	margin: 0;
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}
</style>
