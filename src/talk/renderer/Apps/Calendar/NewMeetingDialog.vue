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
import { createEvent, getOwnEmail, markTalkAudio, syncNow } from './calendar.service.ts'

/** How the meeting is held: a Talk conversation (video or audio call), the provider's Teams or Meet, a link, or none */
type MeetingChoice = 'talk-video' | 'talk-audio' | 'teams' | 'meet' | 'link' | 'none'

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

const MEETING_LABELS: Record<MeetingChoice, string> = {
	'talk-video': t('talk_desktop', 'Nextcloud Talk meeting (video)'),
	'talk-audio': t('talk_desktop', 'Nextcloud Talk call (audio only)'),
	teams: t('talk_desktop', 'Microsoft Teams meeting'),
	meet: t('talk_desktop', 'Google Meet'),
	link: t('talk_desktop', 'Other meeting link'),
	none: t('talk_desktop', 'No online meeting'),
}

/** The choices the selected calendar offers: Teams or Meet only in a calendar synced with Microsoft or Google */
const meetingChoices = computed(() => {
	const choices: MeetingChoice[] = []
	const provided = calendar.value?.synced?.onlineMeeting
	if (provided) {
		choices.push(provided)
	}
	choices.push('talk-video', 'talk-audio', 'link', 'none')
	return choices.map((id) => ({ id, label: MEETING_LABELS[id] }))
})

/**
 * The choice the form starts with: the calendar's Teams or Meet if it has one, else a Talk meeting
 */
function firstChoice() {
	return meetingChoices.value[0]!
}

const meeting = ref<{ id: MeetingChoice, label: string }>(firstChoice())
const meetingLink = ref('')

// Another calendar: its own default (Teams or Meet where it can), unless the choice still applies
watch(calendar, () => {
	const choices = meetingChoices.value
	if (!choices.some((choice) => choice.id === meeting.value.id) || meeting.value.id === 'talk-video') {
		meeting.value = choices[0]!
	}
})

const isTalk = computed(() => meeting.value.id === 'talk-video' || meeting.value.id === 'talk-audio')
const linkIsValid = computed(() => meeting.value.id !== 'link' || /^https?:\/\/\S+$/.test(meetingLink.value.trim()))

const hint = computed(() => {
	switch (meeting.value.id) {
		case 'teams':
			return t('talk_desktop', 'Microsoft makes the Teams meeting and sends the invitations from {email}. The link appears once the calendar syncs.', { email: calendar.value?.synced?.email ?? '' })
		case 'meet':
			return t('talk_desktop', 'Google makes the Meet and sends the invitations from {email}. The link appears once the calendar syncs.', { email: calendar.value?.synced?.email ?? '' })
		case 'link':
		case 'none':
			return attendees.value.length
				? t('talk_desktop', 'Everyone invited gets the meeting in their calendar by email.')
				: ''
		default:
			return t('talk_desktop', 'A conversation is created for the meeting and everyone invited gets the meeting in their calendar. People without an email address in Nextcloud join the conversation but get no calendar invitation.')
	}
})

const isValid = computed(() => title.value.trim() && start.value && end.value && end.value > start.value && calendar.value && linkIsValid.value)

/** Explanations of the errors Talk's meeting endpoint returns */
const SCHEDULE_ERRORS: Record<string, string> = {
	email: t('talk_desktop', 'Meeting invitations are sent from your email address. Add one to your Nextcloud account (Personal info) and try again.'),
	calendar: t('talk_desktop', 'The meeting cannot be added to this calendar. Choose another one.'),
	start: t('talk_desktop', 'The meeting must start in the future.'),
	end: t('talk_desktop', 'The meeting must end after it starts.'),
}

/**
 * Save the meeting the chosen way
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
	try {
		if (isTalk.value) {
			await saveTalkMeeting()
		} else {
			await saveEvent()
		}
	} finally {
		saving.value = false
	}
}

/**
 * Write the event (Teams, Meet, another link or none) to the calendar. Nextcloud invites the attendees, or for
 * Teams and Meet, Microsoft or Google do when the calendar syncs, which also brings the meeting link back.
 */
async function saveEvent() {
	const synced = calendar.value!.synced
	const kind = meeting.value.id
	const providerMeeting = kind === 'teams' || kind === 'meet' ? kind : null

	const invited: { email: string, name: string }[] = []
	const withoutEmail: string[] = []
	for (const attendee of attendees.value) {
		const email = attendee.source === 'emails' ? attendee.id : (attendee.shareWithDisplayNameUnique ?? '')
		if (email.includes('@')) {
			invited.push({ email, name: attendee.source === 'emails' ? '' : attendee.label })
		} else {
			withoutEmail.push(attendee.label)
		}
	}
	if (withoutEmail.length) {
		error.value = t('talk_desktop', 'These people or groups have no email address to invite: {names}. Remove them, or hold the meeting in Nextcloud Talk.', { names: withoutEmail.join(', ') })
		return
	}

	try {
		let organizer: { email: string, name: string } | null = null
		if (synced) {
			organizer = { email: synced.email, name: '' }
		} else if (invited.length) {
			const email = await getOwnEmail()
			if (!email) {
				error.value = SCHEDULE_ERRORS.email!
				return
			}
			organizer = { email, name: '' }
		}
		const link = kind === 'link' ? meetingLink.value.trim() : null
		const details = description.value.trim()
		await createEvent(calendar.value!.uri, {
			title: title.value.trim(),
			start: start.value,
			end: end.value,
			description: link ? `${details}${details ? '\n\n' : ''}${t('talk_desktop', 'Join: {link}', { link }, undefined, { escape: false })}` : details,
			location: link ?? '',
			organizer,
			attendees: invited,
			onlineMeeting: providerMeeting,
			joinUrl: link,
			// In a synced calendar the provider invites everyone (Nextcloud would send a second invitation)
			providerSchedules: Boolean(synced),
		})
		if (synced) {
			// Send it to Google or Microsoft now: the Teams or Meet link comes back with it
			await syncNow(synced).catch((syncError) => console.warn('Could not sync the calendar now', syncError))
			if (providerMeeting) {
				// Outlook finishes a new Teams meeting a few seconds later; fetch that soon, so an edit made
				// meanwhile isn't overwritten by it at the next regular sync
				setTimeout(() => syncNow(synced).catch((syncError) => console.warn('Could not sync the calendar again', syncError)), 20000)
			}
		}
		emit('created', '')
	} catch (exception) {
		console.error('Could not save the event', exception)
		error.value = t('talk_desktop', 'The meeting could not be saved. Please try again.')
	}
}

/**
 * Create the Talk conversation, then let Talk write the event and send the invitations
 */
async function saveTalkMeeting() {
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
		if (meeting.value.id === 'talk-audio') {
			await markTalkAudio(calendar.value!.uri, token, start.value, end.value)
				.catch((markError) => console.warn('Could not mark the meeting as an audio call', markError))
		}
		emit('created', token)
	} catch (exception) {
		console.error('Could not schedule the meeting', exception)
		const reason = (exception as { response?: { data?: { ocs?: { data?: { error?: string } } } } }).response?.data?.ocs?.data?.error
		error.value = (reason && SCHEDULE_ERRORS[reason]) || t('talk_desktop', 'The meeting could not be scheduled. Please try again.')
		// Without the event the new conversation is of no use, and trying again would make another
		if (token) {
			deleteConversation(token).catch((deleteError) => console.warn('Could not remove the meeting conversation', deleteError))
		}
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
			<NcSelect
				v-model="meeting"
				:inputLabel="t('talk_desktop', 'Online meeting')"
				:options="meetingChoices"
				label="label"
				:clearable="false" />
			<NcTextField
				v-if="meeting.id === 'link'"
				v-model="meetingLink"
				type="url"
				:label="t('talk_desktop', 'Meeting link')"
				placeholder="https://"
				:error="Boolean(meetingLink) && !linkIsValid"
				required />
			<NcTextArea v-model="description" :label="t('talk_desktop', 'Details')" resize="vertical" />
			<NcNoteCard v-if="!writableCalendars.length" type="warning" :text="t('talk_desktop', 'You have no calendar to add the meeting to.')" />
			<NcNoteCard v-if="error" type="error" :text="error" />
			<p v-if="hint" class="new-meeting__hint">
				{{ hint }}
			</p>
		</div>

		<template #actions>
			<NcButton variant="tertiary" @click="emit('close')">
				{{ t('talk_desktop', 'Cancel') }}
			</NcButton>
			<NcButton variant="primary" type="submit" :disabled="!isValid || saving">
				{{ saving
					? t('talk_desktop', 'Sending…')
					: (attendees.length || isTalk ? t('talk_desktop', 'Send') : t('talk_desktop', 'Save')) }}
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
