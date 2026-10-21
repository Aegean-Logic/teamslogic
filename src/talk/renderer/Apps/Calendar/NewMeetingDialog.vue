<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { Attendees, AutocompleteEntry } from '../talk.api.ts'
import type { CalendarInfo } from './calendar.service.ts'

import { t } from '@nextcloud/l10n'
import { computed, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDateTimePickerNative from '@nextcloud/vue/components/NcDateTimePickerNative'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import PeoplePicker from '../components/PeoplePicker.vue'
import { CONVERSATION_TYPE, createConversation, deleteConversation, scheduleMeeting } from '../talk.api.ts'

const props = defineProps<{
	start: Date
	calendars: CalendarInfo[]
	defaultCalendarUri: string
}>()

const emit = defineEmits<{
	close: []
	created: [token: string]
}>()

const writableCalendars = computed(() => props.calendars.filter((calendar) => calendar.writable))

/**
 * The calendar the form starts with: the user's default one for meetings
 */
function pickDefaultCalendar() {
	return writableCalendars.value.find((item) => item.uri === props.defaultCalendarUri) ?? writableCalendars.value[0] ?? null
}

const title = ref('')
const attendees = ref<AutocompleteEntry[]>([])
const start = ref(new Date(props.start))
const end = ref(new Date(props.start.getTime() + 30 * 60000))
const description = ref('')
const calendar = ref<CalendarInfo | null>(pickDefaultCalendar())
const saving = ref(false)
const error = ref('')

// Moving the start keeps the length, as in Teams
watch(start, (newStart, oldStart) => {
	if (newStart && oldStart && end.value) {
		end.value = new Date(end.value.getTime() + newStart.getTime() - oldStart.getTime())
	}
})

const isValid = computed(() => title.value.trim() && start.value && end.value && end.value > start.value && calendar.value)

/** Explanations of the errors Talk's meeting endpoint returns */
const SCHEDULE_ERRORS: Record<string, string> = {
	email: t('talk_desktop', 'Meeting invitations are sent from your email address. Add one to your Nextcloud account (Personal info) and try again.'),
	calendar: t('talk_desktop', 'The meeting cannot be added to this calendar. Choose another one.'),
	start: t('talk_desktop', 'The meeting must start in the future.'),
	end: t('talk_desktop', 'The meeting must end after it starts.'),
}

/**
 * Create the Talk conversation, then let Talk write the event and send the invitations
 */
async function save() {
	if (!isValid.value || saving.value) {
		return
	}
	if (start.value < new Date()) {
		error.value = SCHEDULE_ERRORS.start!
		return
	}
	saving.value = true
	error.value = ''
	let token: string | null = null
	try {
		const participants: Attendees = { users: [], groups: [], emails: [] }
		for (const attendee of attendees.value) {
			const list = participants[attendee.source as keyof Attendees]
			list?.push(attendee.id)
		}
		token = (await createConversation({ roomType: CONVERSATION_TYPE.GROUP, roomName: title.value.trim(), participants })).token
		await scheduleMeeting(token, {
			calendarUri: calendar.value!.uri,
			start: Math.round(start.value.getTime() / 1000),
			end: Math.round(end.value.getTime() / 1000),
			title: title.value.trim(),
			description: description.value,
		})
		emit('created', token)
	} catch (exception) {
		console.error('Could not schedule the meeting', exception)
		const reason = (exception as { response?: { data?: { ocs?: { data?: { error?: string } } } } }).response?.data?.ocs?.data?.error
		error.value = (reason && SCHEDULE_ERRORS[reason]) || t('talk_desktop', 'The meeting could not be scheduled. Please try again.')
		// Without the event the new conversation is of no use, and trying again would make another
		if (token) {
			deleteConversation(token).catch((deleteError) => console.warn('Could not remove the meeting conversation', deleteError))
		}
	} finally {
		saving.value = false
	}
}
</script>

<template>
	<NcDialog
		:name="t('talk_desktop', 'New meeting')"
		size="normal"
		isForm
		@update:open="(open) => !open && emit('close')"
		@submit="save">
		<div class="new-meeting">
			<NcTextField v-model="title" :label="t('talk_desktop', 'Add a title')" required />
			<PeoplePicker
				v-model="attendees"
				:inputLabel="t('talk_desktop', 'Invite attendees')"
				:placeholder="t('talk_desktop', 'Name, group or email address')"
				multiple
				withEmails />
			<div class="new-meeting__times">
				<NcDateTimePickerNative v-model="start" type="datetime-local" :label="t('talk_desktop', 'Start')" />
				<NcDateTimePickerNative
					v-model="end"
					type="datetime-local"
					:label="t('talk_desktop', 'End')"
					:min="start" />
			</div>
			<NcSelect
				v-if="writableCalendars.length > 1"
				v-model="calendar"
				:inputLabel="t('talk_desktop', 'Calendar')"
				:options="writableCalendars"
				label="name"
				:clearable="false" />
			<NcTextArea v-model="description" :label="t('talk_desktop', 'Details')" resize="vertical" />
			<NcNoteCard v-if="!writableCalendars.length" type="warning" :text="t('talk_desktop', 'You have no calendar to add the meeting to.')" />
			<NcNoteCard v-if="error" type="error" :text="error" />
			<p class="new-meeting__hint">
				{{ t('talk_desktop', 'A conversation is created for the meeting and everyone invited gets the meeting in their calendar. People without an email address in Nextcloud join the conversation but get no calendar invitation.') }}
			</p>
		</div>

		<template #actions>
			<NcButton variant="tertiary" @click="emit('close')">
				{{ t('talk_desktop', 'Cancel') }}
			</NcButton>
			<NcButton variant="primary" type="submit" :disabled="!isValid || saving">
				{{ saving ? t('talk_desktop', 'Sending…') : t('talk_desktop', 'Send') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.new-meeting {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding-block: 4px;
}

.new-meeting__times {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 12px;
}

.new-meeting__hint {
	margin: 0;
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}
</style>
