<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { Ref } from 'vue'
import type { AutocompleteEntry } from '../talk.api.ts'

import { showError } from '@nextcloud/dialogs'
import { getCanonicalLocale, t } from '@nextcloud/l10n'
import { generateOcsUrl } from '@nextcloud/router'
import { computed, inject, ref } from 'vue'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import AppListItem from '../components/AppListItem.vue'
import AppPane from '../components/AppPane.vue'
import AppStage from '../components/AppStage.vue'
import PeoplePicker from '../components/PeoplePicker.vue'
import { useShellStore } from '../../AppRail/shell.store.ts'
import { formatListTime } from '../apps.utils.ts'
import { talkWithContact } from '../People/contact.actions.ts'
import { getCachedContact } from '../People/people.service.ts'
import { CONVERSATION_TYPE, createConversation } from '../talk.api.ts'

type Conversation = {
	token: string
	type: number
	name: string
	displayName: string
	hasCall: boolean
	callStartTime?: number
	lastActivity: number
	isFavorite: boolean
	isArchived?: boolean
	status?: string
	statusMessage?: string
	lastMessage?: { systemMessage?: string, timestamp?: number }
}

const CALL_MESSAGES: Record<string, string> = {
	call_missed: t('talk_desktop', 'Missed call'),
	call_tried: t('talk_desktop', 'Call not answered'),
	call_ended: t('talk_desktop', 'Call ended'),
	call_ended_everyone: t('talk_desktop', 'Call ended'),
	call_started: t('talk_desktop', 'Call started'),
}

const shellStore = useShellStore()
const isTalkInitialized = inject<Ref<boolean>>('talk:isInitialized')
const locale = getCanonicalLocale()

const callee = ref<AutocompleteEntry | null>(null)
const calling = ref(false)

const conversations = computed<Conversation[]>(() => {
	if (!isTalkInitialized?.value) {
		return []
	}
	return (window.OCA.Talk.instance.$store.getters.conversationsList as Conversation[]).filter((conversation) => !conversation.isArchived)
})

const isOneToOne = (conversation: Conversation) => conversation.type === CONVERSATION_TYPE.ONE_TO_ONE

const activeCalls = computed(() => conversations.value.filter((conversation) => conversation.hasCall))

/** Teams' call history; Talk keeps none, so these are the chats whose last event is a call */
const recentCalls = computed(() => conversations.value
	.filter((conversation) => conversation.lastMessage?.systemMessage && conversation.lastMessage.systemMessage in CALL_MESSAGES)
	.sort((a, b) => b.lastActivity - a.lastActivity)
	.slice(0, 30))

/** Speed dial: favourite one-to-one chats first, then the most recent ones */
const speedDial = computed(() => conversations.value
	.filter(isOneToOne)
	.sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || b.lastActivity - a.lastActivity)
	.slice(0, 12))

/**
 * Avatar of a group conversation
 *
 * @param conversation - The conversation
 */
function roomAvatar(conversation: Conversation) {
	return generateOcsUrl('apps/spreed/api/v1/room/{token}/avatar', { token: conversation.token })
}

/**
 * Call the person picked in the search
 */
async function callPicked() {
	if (!callee.value || calling.value) {
		return
	}
	calling.value = true
	try {
		if (callee.value.source === 'contacts') {
			// A contact from People: Talk invites them by email (or the computer's phone app dials them)
			const contact = getCachedContact(callee.value.id)
			callee.value = null
			if (contact) {
				await talkWithContact(contact, true)
			}
			return
		}
		const conversation = await createConversation({ roomType: CONVERSATION_TYPE.ONE_TO_ONE, participants: { users: [callee.value.id] } })
		callee.value = null
		await shellStore.openChat(conversation.token, { directCall: true })
	} catch (exception) {
		console.error('Could not start the call', exception)
		showError(t('talk_desktop', 'Could not start the call'))
	} finally {
		calling.value = false
	}
}

/**
 * Start a group call now
 */
async function groupCall() {
	const name = t('talk_desktop', 'Meeting {date}', { date: new Date().toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })
	const conversation = await createConversation({ roomType: CONVERSATION_TYPE.GROUP, roomName: name })
	await shellStore.openChat(conversation.token, { directCall: true })
}
</script>

<template>
	<div class="calls-app">
		<AppPane :title="t('talk_desktop', 'Calls')">
			<template #toolbar>
				<form class="calls-app__dial" @submit.prevent="callPicked">
					<PeoplePicker
						v-model="callee"
						:inputLabel="t('talk_desktop', 'Make a call')"
						:placeholder="t('talk_desktop', 'Type a name, email or number')"
						onlyUsers
						withContacts />
					<NcButton
						variant="primary"
						type="submit"
						:disabled="!callee || calling"
						:aria-label="t('talk_desktop', 'Call')"
						:title="t('talk_desktop', 'Call')">
						<template #icon>
							<FluentIcon name="call" :size="20" />
						</template>
					</NcButton>
				</form>
			</template>

			<h3 class="calls-app__section">
				{{ t('talk_desktop', 'Recent calls in your chats') }}
			</h3>
			<ul v-if="recentCalls.length" class="calls-app__list">
				<AppListItem
					v-for="conversation in recentCalls"
					:key="conversation.token"
					:unread="conversation.lastMessage?.systemMessage === 'call_missed'"
					@click="shellStore.openChat(conversation.token)">
					<template #icon>
						<NcAvatar
							v-if="isOneToOne(conversation)"
							:user="conversation.name"
							:displayName="conversation.displayName"
							:size="32"
							disableMenu
							disableTooltip />
						<img
							v-else
							class="calls-app__room-avatar"
							:src="roomAvatar(conversation)"
							alt="">
					</template>
					<template #title>
						{{ conversation.displayName }}
					</template>
					<template #subtitle>
						<span :class="{ 'calls-app__missed': ['call_missed', 'call_tried'].includes(conversation.lastMessage!.systemMessage!) }">
							{{ CALL_MESSAGES[conversation.lastMessage!.systemMessage!] }}
						</span>
					</template>
					<template #details>
						{{ formatListTime(new Date(conversation.lastActivity * 1000)) }}
					</template>
					<template #actions>
						<NcButton
							variant="tertiary"
							size="small"
							:aria-label="t('talk_desktop', 'Call back')"
							:title="t('talk_desktop', 'Call back')"
							@click.stop="shellStore.openChat(conversation.token, { directCall: true })">
							<template #icon>
								<FluentIcon name="call" :size="16" />
							</template>
						</NcButton>
					</template>
				</AppListItem>
			</ul>
			<p v-else class="calls-app__none">
				{{ t('talk_desktop', 'Calls you make and miss show up here.') }}
			</p>
		</AppPane>

		<AppStage :title="t('talk_desktop', 'Speed dial')">
			<template #actions>
				<NcButton variant="secondary" @click="groupCall">
					<template #icon>
						<FluentIcon name="video" :size="20" />
					</template>
					{{ t('talk_desktop', 'Start a group call') }}
				</NcButton>
			</template>

			<div class="calls-app__stage">
				<section v-if="activeCalls.length" class="calls-app__block">
					<h3 class="calls-app__heading">
						{{ t('talk_desktop', 'Calls in progress') }}
					</h3>
					<ul class="calls-app__active">
						<li v-for="conversation in activeCalls" :key="conversation.token" class="calls-app__active-call">
							<img class="calls-app__room-avatar" :src="roomAvatar(conversation)" alt="">
							<span class="calls-app__active-name">{{ conversation.displayName }}</span>
							<NcButton variant="success" @click="shellStore.openChat(conversation.token, { directCall: true })">
								<template #icon>
									<FluentIcon name="video" :size="20" />
								</template>
								{{ t('talk_desktop', 'Join') }}
							</NcButton>
						</li>
					</ul>
				</section>

				<section class="calls-app__block">
					<ul v-if="speedDial.length" class="calls-app__tiles">
						<li v-for="conversation in speedDial" :key="conversation.token" class="calls-app__tile">
							<NcAvatar
								:user="conversation.name"
								:displayName="conversation.displayName"
								:size="64"
								:preloadedUserStatus="conversation.status ? { status: conversation.status, message: conversation.statusMessage } : undefined"
								disableMenu
								disableTooltip />
							<span class="calls-app__tile-name">{{ conversation.displayName }}</span>
							<span class="calls-app__tile-status">{{ conversation.statusMessage || '' }}</span>
							<span class="calls-app__tile-actions">
								<NcButton
									variant="tertiary"
									:aria-label="t('talk_desktop', 'Call {name}', { name: conversation.displayName })"
									:title="t('talk_desktop', 'Call')"
									@click="shellStore.openChat(conversation.token, { directCall: true })">
									<template #icon>
										<FluentIcon name="call" :size="20" />
									</template>
								</NcButton>
								<NcButton
									variant="tertiary"
									:aria-label="t('talk_desktop', 'Chat with {name}', { name: conversation.displayName })"
									:title="t('talk_desktop', 'Chat')"
									@click="shellStore.openChat(conversation.token)">
									<template #icon>
										<FluentIcon name="chatSmall" :size="20" />
									</template>
								</NcButton>
							</span>
						</li>
					</ul>
					<NcEmptyContent
						v-else
						:name="t('talk_desktop', 'No contacts yet')"
						:description="t('talk_desktop', 'People you chat with one to one appear here for quick calls.')">
						<template #icon>
							<FluentIcon name="call" :size="48" />
						</template>
					</NcEmptyContent>
				</section>
			</div>
		</AppStage>
	</div>
</template>

<style scoped>
.calls-app {
	display: flex;
	flex: 1 1 auto;
	min-width: 0;
}

.calls-app__dial {
	display: flex;
	align-items: flex-end;
	gap: 8px;

	> :first-child {
		flex: 1 1 auto;
		min-width: 0;
	}
}

.calls-app__section {
	margin: 8px 8px 4px;
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
	font-weight: 600;
}

.calls-app__list {
	margin: 0;
	padding: 0;
}

.calls-app__none {
	margin: 8px;
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}

.calls-app__missed {
	color: var(--teamslogic-badge);
}

.calls-app__room-avatar {
	width: 32px;
	height: 32px;
	border-radius: 50%;
}

.calls-app__stage {
	display: flex;
	flex-direction: column;
	gap: 24px;
	padding: 20px;
}

.calls-app__heading {
	margin: 0 0 8px;
	font-size: 14px;
	font-weight: 600;
}

.calls-app__active {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.calls-app__active-call {
	display: flex;
	align-items: center;
	gap: 12px;
	max-width: 640px;
	padding: 12px 16px;
	border-inline-start: 4px solid #13A10E;
	border-radius: var(--border-radius-element);
	background-color: var(--teamslogic-surface);
	box-shadow: var(--teamslogic-shadow-2);
}

.calls-app__active-name {
	flex: 1 1 auto;
	font-weight: 600;
}

.calls-app__tiles {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
	gap: 12px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.calls-app__tile {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
	padding: 20px 12px 12px;
	border-radius: var(--border-radius-element);
	background-color: var(--teamslogic-surface);
	box-shadow: var(--teamslogic-shadow-2);
	text-align: center;
}

.calls-app__tile-name {
	max-width: 100%;
	margin-block-start: 8px;
	overflow: hidden;
	font-weight: 600;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.calls-app__tile-status {
	min-height: 16px;
	max-width: 100%;
	overflow: hidden;
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.calls-app__tile-actions {
	display: flex;
	gap: 4px;
}
</style>
