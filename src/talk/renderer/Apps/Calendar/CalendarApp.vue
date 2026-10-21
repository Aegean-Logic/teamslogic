<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { CalendarEvent, CalendarInfo } from './calendar.service.ts'

import { getCanonicalLocale, t } from '@nextcloud/l10n'
import { computed, onMounted, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import AppStage from '../components/AppStage.vue'
import CalendarGrid from './CalendarGrid.vue'
import EventPeek from './EventPeek.vue'
import NewMeetingDialog from './NewMeetingDialog.vue'
import { useShellStore } from '../../AppRail/shell.store.ts'
import { readStored, writeStored } from '../apps.utils.ts'
import { CONVERSATION_TYPE, createConversation, hasTalkFeature } from '../talk.api.ts'
import { useAppShown } from '../useAppShown.ts'
import { getDefaultCalendar, getEvents, loadCalendars } from './calendar.service.ts'

type CalendarView = 'day' | 'workweek' | 'week'

const VIEWS: { id: CalendarView, label: string }[] = [
	{ id: 'day', label: t('talk_desktop', 'Day') },
	{ id: 'workweek', label: t('talk_desktop', 'Work week') },
	{ id: 'week', label: t('talk_desktop', 'Week') },
]

const shellStore = useShellStore()
const locale = getCanonicalLocale()

const view = ref<CalendarView>(readStored<CalendarView>('teamslogic:calendar:view', 'workweek'))
const anchor = ref(startOfDay(new Date()))
const calendars = ref<CalendarInfo[]>([])
const defaultCalendarUri = ref('')
const events = ref<CalendarEvent[]>([])
const loading = ref(true)
const error = ref('')
const selectedId = ref<string | null>(null)
const newMeetingStart = ref<Date | null>(null)

const canScheduleMeetings = hasTalkFeature('schedule-meeting')

watch(view, (value) => writeStored('teamslogic:calendar:view', value))

/**
 * Midnight of a day
 *
 * @param date - A date
 */
function startOfDay(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * Add days to a date
 *
 * @param date - A date
 * @param count - Days to add
 */
function addDays(date: Date, count: number) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count)
}

const days = computed(() => {
	if (view.value === 'day') {
		return [anchor.value]
	}
	// Weeks start on Monday
	const monday = addDays(anchor.value, -((anchor.value.getDay() + 6) % 7))
	return Array.from({ length: view.value === 'week' ? 7 : 5 }, (_, index) => addDays(monday, index))
})

const rangeTitle = computed(() => {
	const first = days.value[0]!
	const last = days.value[days.value.length - 1]!
	if (first.getMonth() === last.getMonth()) {
		return first.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
	}
	return `${first.toLocaleDateString(locale, { month: 'short' })} – ${last.toLocaleDateString(locale, { month: 'short', year: 'numeric' })}`
})

const selectedEvent = computed(() => events.value.find((event) => event.id === selectedId.value) ?? null)

/**
 * Load the events of the shown days
 */
async function refresh() {
	const from = days.value[0]!
	const to = addDays(days.value[days.value.length - 1]!, 1)
	try {
		events.value = await getEvents(from, to)
		error.value = ''
	} catch (exception) {
		console.error('Could not load the calendar', exception)
		error.value = t('talk_desktop', 'The calendar could not be loaded.')
	}
}

/**
 * Go a period forward or back
 *
 * @param direction - 1 or -1
 */
function move(direction: number) {
	anchor.value = addDays(anchor.value, direction * (view.value === 'day' ? 1 : 7))
}

/**
 * Start a group call now, as Teams' Meet now
 */
async function meetNow() {
	const name = t('talk_desktop', 'Meeting {date}', { date: new Date().toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })
	const conversation = await createConversation({ roomType: CONVERSATION_TYPE.GROUP, roomName: name })
	await shellStore.openChat(conversation.token, { directCall: true })
}

/**
 * Open the new meeting form, by default at the next half hour
 *
 * @param start - Start of the meeting
 */
function newMeeting(start?: Date) {
	if (!canScheduleMeetings) {
		return
	}
	if (start) {
		newMeetingStart.value = start
		return
	}
	const next = new Date()
	next.setMinutes(next.getMinutes() < 30 ? 30 : 60, 0, 0)
	newMeetingStart.value = next
}

/**
 * A meeting was scheduled
 */
async function onMeetingCreated() {
	newMeetingStart.value = null
	await refresh()
}

watch(days, () => {
	selectedId.value = null
	refresh()
})

onMounted(async () => {
	try {
		calendars.value = await loadCalendars()
		defaultCalendarUri.value = getDefaultCalendar()
		await refresh()
	} catch (exception) {
		console.error('Could not connect to the calendars', exception)
		error.value = t('talk_desktop', 'Your calendars could not be loaded.')
	} finally {
		loading.value = false
	}
})

// Coming back to Calendar shows fresh events
useAppShown('calendar', () => {
	if (!loading.value) {
		refresh()
	}
})
</script>

<template>
	<AppStage class="calendar-app">
		<template #header>
			<FluentIcon class="calendar-app__icon" name="calendar" />
			<h2 class="calendar-app__title">
				{{ t('talk_desktop', 'Calendar') }}
			</h2>
		</template>
		<template #actions>
			<NcButton variant="secondary" @click="meetNow">
				<template #icon>
					<FluentIcon name="video" :size="20" />
				</template>
				{{ t('talk_desktop', 'Meet now') }}
			</NcButton>
			<NcButton
				v-if="canScheduleMeetings"
				variant="primary"
				:disabled="loading || !calendars.some((calendar) => calendar.writable)"
				@click="newMeeting()">
				<template #icon>
					<FluentIcon name="add" :size="20" />
				</template>
				{{ t('talk_desktop', 'New meeting') }}
			</NcButton>
		</template>

		<div class="calendar-app__layout">
			<div class="calendar-app__toolbar">
				<NcButton variant="secondary" size="small" @click="anchor = startOfDay(new Date())">
					<template #icon>
						<FluentIcon name="calendar" :size="16" />
					</template>
					{{ t('talk_desktop', 'Today') }}
				</NcButton>
				<NcButton
					variant="tertiary"
					size="small"
					:aria-label="t('talk_desktop', 'Previous')"
					@click="move(-1)">
					<template #icon>
						<FluentIcon name="chevronLeft" :size="20" />
					</template>
				</NcButton>
				<NcButton
					variant="tertiary"
					size="small"
					:aria-label="t('talk_desktop', 'Next')"
					@click="move(1)">
					<template #icon>
						<FluentIcon name="chevronRight" :size="20" />
					</template>
				</NcButton>
				<span class="calendar-app__range">{{ rangeTitle }}</span>
				<div class="calendar-app__views" role="radiogroup" :aria-label="t('talk_desktop', 'Calendar view')">
					<button
						v-for="item in VIEWS"
						:key="item.id"
						class="calendar-app__view"
						:class="{ 'calendar-app__view--active': view === item.id }"
						role="radio"
						:aria-checked="view === item.id"
						@click="view = item.id">
						{{ item.label }}
					</button>
				</div>
			</div>

			<div class="calendar-app__content">
				<NcEmptyContent v-if="error" class="calendar-app__empty" :name="error">
					<template #icon>
						<FluentIcon name="calendar" :size="48" />
					</template>
				</NcEmptyContent>
				<NcEmptyContent v-else-if="loading" class="calendar-app__empty" :name="t('talk_desktop', 'Loading your calendar…')">
					<template #icon>
						<NcLoadingIcon :size="48" />
					</template>
				</NcEmptyContent>
				<CalendarGrid
					v-else
					class="calendar-app__grid"
					:days="days"
					:events="events"
					:selectedId="selectedId"
					@select="selectedId = $event.id"
					@create="newMeeting" />

				<EventPeek
					v-if="selectedEvent"
					:event="selectedEvent"
					@close="selectedId = null"
					@join="(token) => shellStore.openChat(token, { directCall: true })"
					@chat="(token) => shellStore.openChat(token)" />
			</div>
		</div>

		<NewMeetingDialog
			v-if="newMeetingStart"
			:start="newMeetingStart"
			:calendars="calendars"
			:defaultCalendarUri="defaultCalendarUri"
			@close="newMeetingStart = null"
			@created="onMeetingCreated" />
	</AppStage>
</template>

<style scoped>
.calendar-app :deep(.app-stage__body) {
	overflow: hidden;
}

.calendar-app__icon {
	color: var(--teamslogic-brand-foreground);
}

.calendar-app__title {
	flex: 1 1 auto;
	margin: 0;
	font-size: 18px;
	font-weight: 700;
}

.calendar-app__layout {
	display: flex;
	flex-direction: column;
	height: 100%;
}

.calendar-app__toolbar {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 8px 20px;
	background-color: var(--teamslogic-surface);
	border-block-end: 1px solid var(--teamslogic-stroke);
}

.calendar-app__range {
	flex: 1 1 auto;
	margin-inline-start: 8px;
	font-size: 16px;
	font-weight: 600;
}

.calendar-app__views {
	display: flex;
	padding: 2px;
	border-radius: var(--border-radius-element);
	background-color: var(--color-background-dark);
}

.calendar-app__view {
	min-height: 0;
	height: 28px;
	margin: 0;
	padding: 0 12px;
	border: none;
	border-radius: var(--border-radius-element);
	background: none;
	color: var(--teamslogic-foreground-2);
	font-size: 13px;
	font-weight: 400;
	cursor: pointer;
}

.calendar-app__view--active {
	background-color: var(--teamslogic-surface);
	box-shadow: var(--teamslogic-shadow-2);
	color: var(--teamslogic-foreground-1);
	font-weight: 600;
}

.calendar-app__content {
	display: flex;
	flex: 1 1 auto;
	min-height: 0;
}

.calendar-app__grid {
	flex: 1 1 auto;
	min-width: 0;
}

.calendar-app__empty {
	flex: 1 1 auto;
	margin-block-start: 15vh;
}
</style>
