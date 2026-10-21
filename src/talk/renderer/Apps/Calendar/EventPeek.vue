<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { CalendarEvent } from './calendar.service.ts'

import { getCanonicalLocale, t } from '@nextcloud/l10n'
import { computed } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import { formatTime } from '../apps.utils.ts'

const props = defineProps<{
	event: CalendarEvent
}>()

const emit = defineEmits<{
	close: []
	join: [token: string]
	chat: [token: string]
}>()

const locale = getCanonicalLocale()

const when = computed(() => {
	const { start, end, allDay } = props.event
	const day = start.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
	if (allDay) {
		return t('talk_desktop', '{day}, all day', { day })
	}
	return `${day} ${formatTime(start)} – ${formatTime(end)}`
})

const STATUS_LABELS: Record<string, string> = {
	ACCEPTED: t('talk_desktop', 'Accepted'),
	DECLINED: t('talk_desktop', 'Declined'),
	TENTATIVE: t('talk_desktop', 'Tentative'),
	'NEEDS-ACTION': t('talk_desktop', 'No response'),
}

/** A Talk meeting shows the link as its location; Teams shows "Online meeting" instead */
const location = computed(() => props.event.talkToken && /^https?:\/\//.test(props.event.location) ? '' : props.event.location)
</script>

<template>
	<aside class="event-peek" :style="{ '--event-color': event.calendar.color }">
		<header class="event-peek__header">
			<h3 class="event-peek__title">
				{{ event.title || t('talk_desktop', 'Untitled event') }}
			</h3>
			<NcButton variant="tertiary" :aria-label="t('talk_desktop', 'Close')" @click="emit('close')">
				<template #icon>
					<FluentIcon name="dismiss" :size="20" />
				</template>
			</NcButton>
		</header>

		<div v-if="event.talkToken" class="event-peek__actions">
			<NcButton variant="primary" @click="emit('join', event.talkToken)">
				<template #icon>
					<FluentIcon name="video" :size="20" />
				</template>
				{{ t('talk_desktop', 'Join') }}
			</NcButton>
			<NcButton variant="secondary" @click="emit('chat', event.talkToken)">
				<template #icon>
					<FluentIcon name="chatSmall" :size="20" />
				</template>
				{{ t('talk_desktop', 'Chat with participants') }}
			</NcButton>
		</div>

		<dl class="event-peek__details">
			<div class="event-peek__row">
				<dt><FluentIcon name="clock" :size="20" /></dt>
				<dd>{{ when }}</dd>
			</div>
			<div v-if="event.talkToken" class="event-peek__row">
				<dt><FluentIcon name="video" :size="20" /></dt>
				<dd>{{ t('talk_desktop', 'Online meeting') }}</dd>
			</div>
			<div v-if="location" class="event-peek__row">
				<dt><FluentIcon name="location" :size="20" /></dt>
				<dd>{{ location }}</dd>
			</div>
			<div class="event-peek__row">
				<dt><span class="event-peek__calendar-dot" /></dt>
				<dd>{{ event.calendar.name }}</dd>
			</div>
			<div v-if="event.organizer || event.attendees.length" class="event-peek__row">
				<dt><FluentIcon name="people" :size="20" /></dt>
				<dd>
					<ul class="event-peek__people">
						<li v-if="event.organizer">
							{{ event.organizer }} <span class="event-peek__muted">{{ t('talk_desktop', 'Organiser') }}</span>
						</li>
						<li v-for="attendee in event.attendees" :key="attendee.email">
							{{ attendee.name }} <span class="event-peek__muted">{{ STATUS_LABELS[attendee.status] ?? attendee.status }}</span>
						</li>
					</ul>
				</dd>
			</div>
			<div v-if="event.description" class="event-peek__row">
				<dt><FluentIcon name="textDescription" :size="20" /></dt>
				<dd class="event-peek__description">
					{{ event.description }}
				</dd>
			</div>
		</dl>
	</aside>
</template>

<style scoped>
.event-peek {
	display: flex;
	flex: 0 0 360px;
	flex-direction: column;
	gap: 16px;
	min-height: 0;
	overflow-y: auto;
	padding: 16px 20px;
	border-inline-start: 1px solid var(--teamslogic-stroke);
	border-block-start: 4px solid var(--event-color);
	background-color: var(--teamslogic-surface);
}

.event-peek__header {
	display: flex;
	align-items: flex-start;
	gap: 8px;
}

.event-peek__title {
	flex: 1 1 auto;
	margin: 0;
	font-size: 20px;
	font-weight: 600;
	line-height: 28px;
	overflow-wrap: anywhere;
}

.event-peek__actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.event-peek__details {
	display: flex;
	flex-direction: column;
	gap: 12px;
	margin: 0;
}

.event-peek__row {
	display: flex;
	gap: 12px;

	dt {
		display: flex;
		flex: 0 0 20px;
		justify-content: center;
		color: var(--teamslogic-foreground-3);
	}

	dd {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		overflow-wrap: anywhere;
	}
}

.event-peek__calendar-dot {
	width: 12px;
	height: 12px;
	margin-block-start: 4px;
	border-radius: 50%;
	background-color: var(--event-color);
}

.event-peek__people {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.event-peek__muted {
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}

.event-peek__description {
	white-space: pre-wrap;
}
</style>
