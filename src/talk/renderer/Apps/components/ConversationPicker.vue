<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import { generateOcsUrl } from '@nextcloud/router'
import { computed, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import AppListItem from './AppListItem.vue'
import { CONVERSATION_TYPE } from '../talk.api.ts'

type Conversation = {
	token: string
	displayName: string
	type: number
	readOnly: number
	lastActivity: number
	isArchived?: boolean
}

defineProps<{
	name: string
	confirmLabel: string
}>()

const emit = defineEmits<{
	close: []
	pick: [token: string]
}>()

const search = ref('')
const selectedToken = ref<string | null>(null)

const conversations = computed(() => {
	const all = (window.OCA.Talk?.instance?.$store.getters.conversationsList ?? []) as Conversation[]
	const query = search.value.trim().toLowerCase()
	return all
		.filter((conversation) => !conversation.readOnly && conversation.type !== CONVERSATION_TYPE.CHANGELOG && !conversation.isArchived)
		.filter((conversation) => !query || conversation.displayName.toLowerCase().includes(query))
		.sort((a, b) => b.lastActivity - a.lastActivity)
})

/**
 * Avatar of a conversation
 *
 * @param conversation - The conversation
 */
function avatarUrl(conversation: Conversation) {
	return generateOcsUrl('apps/spreed/api/v1/room/{token}/avatar', { token: conversation.token })
}
</script>

<template>
	<NcDialog :name="name" size="normal" @update:open="(open) => !open && emit('close')">
		<div class="conversation-picker">
			<NcTextField v-model="search" :label="t('talk_desktop', 'Search conversations')" />
			<ul class="conversation-picker__list">
				<AppListItem
					v-for="conversation in conversations"
					:key="conversation.token"
					:active="conversation.token === selectedToken"
					@click="selectedToken = conversation.token">
					<template #icon>
						<img class="conversation-picker__avatar" :src="avatarUrl(conversation)" alt="">
					</template>
					<template #title>
						{{ conversation.displayName }}
					</template>
				</AppListItem>
			</ul>
		</div>
		<template #actions>
			<NcButton variant="tertiary" @click="emit('close')">
				{{ t('talk_desktop', 'Cancel') }}
			</NcButton>
			<NcButton variant="primary" :disabled="!selectedToken" @click="emit('pick', selectedToken!)">
				{{ confirmLabel }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.conversation-picker {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.conversation-picker__list {
	max-height: 50vh;
	margin: 0;
	padding: 0;
	overflow-y: auto;
}

.conversation-picker__avatar {
	width: 32px;
	height: 32px;
	border-radius: 50%;
}
</style>
