<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { CalendarEvent } from './calendar.service.ts'

import { getCanonicalLocale, t } from '@nextcloud/l10n'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { formatTime } from '../apps.utils.ts'

const props = defineProps<{
	days: Date[]
	events: CalendarEvent[]
	selectedId: string | null
}>()

const emit = defineEmits<{
	select: [event: CalendarEvent]
	create: [start: Date]
}>()

/** Pixels per hour: 30-minute rows of 24 px, as in Teams */
const HOUR_HEIGHT = 48
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

const locale = getCanonicalLocale()
const scroller = useTemplateRef('scroller')
const now = ref(new Date())
let nowTimer: number | undefined

const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

const dayStart = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate())

/**
 * Lay out the timed events of a day: overlapping events share the width, side by side
 *
 * @param day - The day
 */
function layoutDay(day: Date) {
	const start = dayStart(day).getTime()
	const end = start + 86400000
	const events = props.events
		.filter((event) => !event.allDay && event.start.getTime() < end && event.end.getTime() > start)
		.sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime())

	const placed: { event: CalendarEvent, top: number, height: number, column: number, columns: number }[] = []
	let cluster: typeof placed = []
	let clusterEnd = 0
	const columnEnds: number[] = []

	const closeCluster = () => {
		const columns = Math.max(1, ...cluster.map((item) => item.column + 1))
		for (const item of cluster) {
			item.columns = columns
		}
		cluster = []
		columnEnds.length = 0
	}

	for (const event of events) {
		const from = Math.max(event.start.getTime(), start)
		const to = Math.min(Math.max(event.end.getTime(), from + 15 * 60000), end)
		if (cluster.length && from >= clusterEnd) {
			closeCluster()
		}
		let column = columnEnds.findIndex((columnEnd) => columnEnd <= from)
		if (column === -1) {
			column = columnEnds.length
		}
		columnEnds[column] = to
		clusterEnd = Math.max(clusterEnd, to)
		const item = {
			event,
			top: (from - start) / 3600000 * HOUR_HEIGHT,
			height: Math.max((to - from) / 3600000 * HOUR_HEIGHT - 2, 20),
			column,
			columns: 1,
		}
		cluster.push(item)
		placed.push(item)
	}
	closeCluster()
	return placed
}

const columns = computed(() => props.days.map((day) => ({
	day,
	isToday: isSameDay(day, now.value),
	allDay: props.events.filter((event) => event.allDay && event.start < new Date(dayStart(day).getTime() + 86400000) && event.end > dayStart(day)),
	timed: layoutDay(day),
})))

const hasAllDay = computed(() => columns.value.some((column) => column.allDay.length))

const nowTop = computed(() => (now.value.getHours() + now.value.getMinutes() / 60) * HOUR_HEIGHT)

/**
 * Label of an hour on the time axis
 *
 * @param hour - Hour of the day
 */
function hourLabel(hour: number) {
	return new Date(2000, 0, 1, hour).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Start a new meeting at the clicked half hour
 *
 * @param day - The day
 * @param event - Click
 */
function onGridClick(day: Date, event: MouseEvent) {
	const offset = (event.currentTarget as HTMLElement).getBoundingClientRect()
	const halfHours = Math.floor((event.clientY - offset.top) / (HOUR_HEIGHT / 2))
	const start = dayStart(day)
	start.setMinutes(halfHours * 30)
	emit('create', start)
}

/**
 * Scroll to the working day, or to now
 */
function scrollToWorkingDay() {
	const hour = props.days.some((day) => isSameDay(day, now.value)) ? Math.max(now.value.getHours() - 1, 0) : 8
	scroller.value?.scrollTo({ top: hour * HOUR_HEIGHT })
}

watch(() => props.days[0]?.getTime(), () => nextTick(scrollToWorkingDay))

onMounted(() => {
	scrollToWorkingDay()
	nowTimer = window.setInterval(() => {
		now.value = new Date()
	}, 60000)
})

onBeforeUnmount(() => window.clearInterval(nowTimer))
</script>

<template>
	<div class="calendar-grid" :style="{ '--calendar-days': days.length }">
		<div class="calendar-grid__head">
			<div class="calendar-grid__gutter" />
			<div
				v-for="column in columns"
				:key="column.day.getTime()"
				class="calendar-grid__day-head"
				:class="{ 'calendar-grid__day-head--today': column.isToday }">
				<span class="calendar-grid__day-number">{{ column.day.getDate() }}</span>
				<span class="calendar-grid__day-name">{{ column.day.toLocaleDateString(locale, { weekday: 'long' }) }}</span>
			</div>
		</div>

		<div v-if="hasAllDay" class="calendar-grid__all-day">
			<div class="calendar-grid__gutter calendar-grid__all-day-label">
				{{ t('talk_desktop', 'All day') }}
			</div>
			<div v-for="column in columns" :key="column.day.getTime()" class="calendar-grid__all-day-cell">
				<button
					v-for="event in column.allDay"
					:key="event.id"
					class="calendar-event calendar-event--all-day"
					:class="{ 'calendar-event--selected': event.id === selectedId }"
					:style="{ '--event-color': event.calendar.color }"
					@click="emit('select', event)">
					<span class="calendar-event__title">{{ event.title || t('talk_desktop', 'Untitled event') }}</span>
				</button>
			</div>
		</div>

		<div ref="scroller" class="calendar-grid__scroller">
			<div class="calendar-grid__body" :style="{ height: `${24 * HOUR_HEIGHT}px` }">
				<div class="calendar-grid__gutter calendar-grid__hours">
					<span
						v-for="hour in HOURS"
						:key="hour"
						class="calendar-grid__hour"
						:style="{ top: `${hour * HOUR_HEIGHT}px` }">
						{{ hour ? hourLabel(hour) : '' }}
					</span>
				</div>
				<div
					v-for="column in columns"
					:key="column.day.getTime()"
					class="calendar-grid__column"
					:class="{ 'calendar-grid__column--today': column.isToday }"
					@click.self="onGridClick(column.day, $event)">
					<button
						v-for="item in column.timed"
						:key="item.event.id"
						class="calendar-event"
						:class="{ 'calendar-event--selected': item.event.id === selectedId, 'calendar-event--short': item.height < 40 }"
						:style="{
							'--event-color': item.event.calendar.color,
							top: `${item.top}px`,
							height: `${item.height}px`,
							insetInlineStart: `calc(${item.column} * (100% - 8px) / ${item.columns})`,
							width: `calc((100% - 8px) / ${item.columns} - 2px)`,
						}"
						@click="emit('select', item.event)">
						<span class="calendar-event__title">{{ item.event.title || t('talk_desktop', 'Untitled event') }}</span>
						<span class="calendar-event__time">{{ formatTime(item.event.start) }} – {{ formatTime(item.event.end) }}</span>
					</button>
					<div v-if="column.isToday" class="calendar-grid__now" :style="{ top: `${nowTop}px` }" />
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.calendar-grid {
	--calendar-gutter: 64px;
	display: flex;
	flex-direction: column;
	height: 100%;
	background-color: var(--teamslogic-surface);
}

.calendar-grid__head,
.calendar-grid__all-day,
.calendar-grid__body {
	display: grid;
	grid-template-columns: var(--calendar-gutter) repeat(var(--calendar-days), minmax(0, 1fr));
}

.calendar-grid__head {
	border-block-end: 1px solid var(--teamslogic-stroke);
	/* Room for the scrollbar of the body */
	padding-inline-end: 12px;
}

.calendar-grid__day-head {
	display: flex;
	flex-direction: column;
	padding: 8px 8px 6px;
	border-inline-start: 1px solid var(--teamslogic-stroke);
	color: var(--teamslogic-foreground-2);
}

.calendar-grid__day-number {
	font-size: 24px;
	font-weight: 600;
	line-height: 32px;
}

.calendar-grid__day-name {
	font-size: 12px;
}

.calendar-grid__day-head--today {
	color: var(--teamslogic-brand-foreground);
	box-shadow: inset 0 3px 0 var(--teamslogic-brand-foreground);
}

.calendar-grid__all-day {
	padding-inline-end: 12px;
	border-block-end: 1px solid var(--teamslogic-stroke);
}

.calendar-grid__all-day-label {
	padding: 4px 8px;
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
	text-align: end;
}

.calendar-grid__all-day-cell {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
	padding: 2px 4px;
	border-inline-start: 1px solid var(--teamslogic-stroke);
}

.calendar-grid__scroller {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: scroll;
}

.calendar-grid__body {
	position: relative;
}

.calendar-grid__hours {
	position: relative;
}

.calendar-grid__hour {
	position: absolute;
	inset-inline-end: 8px;
	transform: translateY(-50%);
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}

.calendar-grid__column {
	position: relative;
	border-inline-start: 1px solid var(--teamslogic-stroke);
	/* Hour lines, dotted half hours */
	background-image:
		linear-gradient(to bottom, var(--teamslogic-stroke) 1px, transparent 1px),
		linear-gradient(to bottom, transparent 23px, color-mix(in srgb, var(--teamslogic-stroke) 50%, transparent) 23px, transparent 24px);
	background-size: 100% 48px;
	cursor: pointer;
}

.calendar-grid__column--today {
	background-color: color-mix(in srgb, var(--teamslogic-brand-tint) 35%, transparent);
}

.calendar-grid__now {
	position: absolute;
	inset-inline: -1px 0;
	height: 2px;
	background-color: var(--teamslogic-badge);
	pointer-events: none;

	&::before {
		content: '';
		position: absolute;
		inset-inline-start: -5px;
		top: -4px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background-color: var(--teamslogic-badge);
	}
}

/* Teams event cards: a tint of the calendar colour with a solid bar at the start */
.calendar-event {
	position: absolute;
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	overflow: hidden;
	min-height: 0;
	margin: 0 0 0 4px;
	padding: 4px 8px;
	border: none;
	border-inline-start: 4px solid var(--event-color);
	border-radius: var(--border-radius-element);
	background-color: color-mix(in srgb, var(--event-color) 18%, var(--teamslogic-surface));
	color: var(--teamslogic-foreground-1);
	font-size: 12px;
	font-weight: 400;
	line-height: 16px;
	text-align: start;
	cursor: pointer;

	&:hover {
		background-color: color-mix(in srgb, var(--event-color) 28%, var(--teamslogic-surface));
	}
}

.calendar-event--short {
	flex-direction: row;
	gap: 6px;
	padding-block: 1px;
}

.calendar-event--selected {
	outline: 2px solid var(--event-color);
	outline-offset: 0;
}

.calendar-event--all-day {
	position: static;
	margin: 0;
	padding: 2px 6px;
}

.calendar-event__title {
	overflow: hidden;
	max-width: 100%;
	font-weight: 600;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.calendar-event__time {
	color: var(--teamslogic-foreground-2);
	white-space: nowrap;
}
</style>
