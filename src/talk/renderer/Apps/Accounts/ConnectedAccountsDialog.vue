<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { Connection, Features, Provider } from './connections.service.ts'

import { showError, showSuccess } from '@nextcloud/dialogs'
import { getCanonicalLocale, t } from '@nextcloud/l10n'
import { onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import { useMailStore } from '../Mail/mail.store.ts'
import { connect, disconnect, listConnections, syncNow, updateConnection } from './connections.service.ts'

const emit = defineEmits<{
	close: []
}>()

const mailStore = useMailStore()
const locale = getCanonicalLocale()

const PROVIDERS: Record<Provider, string> = {
	google: t('talk_desktop', 'Google'),
	microsoft: t('talk_desktop', 'Microsoft 365'),
}

const FEATURES: { id: keyof Features, label: string }[] = [
	{ id: 'mail', label: t('talk_desktop', 'Mail') },
	{ id: 'calendar', label: t('talk_desktop', 'Calendar') },
	{ id: 'contacts', label: t('talk_desktop', 'Contacts') },
]

/** null: the server app is not installed */
const connections = ref<Connection[] | null | undefined>(undefined)
const busy = ref<string | null>(null)
const error = ref('')
const newFeatures = ref<Features>({ mail: true, calendar: true, contacts: true })
const confirmingDisconnect = ref<Connection | null>(null)
const keepData = ref(false)

/**
 * Load the connections
 */
async function refresh() {
	try {
		connections.value = await listConnections()
	} catch (exception) {
		console.error('Could not load the connected accounts', exception)
		connections.value = []
		error.value = t('talk_desktop', 'The connected accounts could not be loaded.')
	}
}

onMounted(refresh)

/**
 * When a connection last synced
 *
 * @param connection - Connection
 */
function status(connection: Connection) {
	if (connection.lastError) {
		return t('talk_desktop', 'Sync problem: {error}', { error: connection.lastError }, undefined, { escape: false, sanitize: false })
	}
	if (!connection.lastSync) {
		return t('talk_desktop', 'Waiting for the first sync')
	}
	const minutes = Math.round((Date.now() / 1000 - connection.lastSync) / 60)
	const ago = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
	return t('talk_desktop', 'Synced {when}', {
		when: minutes < 60 ? ago.format(-minutes, 'minute') : new Date(connection.lastSync * 1000).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
	}, undefined, { escape: false, sanitize: false })
}

/**
 * Connect an account: sign in at Google or Microsoft in an app window
 *
 * @param provider - google or microsoft
 */
async function add(provider: Provider) {
	error.value = ''
	busy.value = provider
	try {
		const connection = await connect(provider, newFeatures.value)
		if (connection) {
			showSuccess(t('talk_desktop', '{email} is connected', { email: connection.email }, undefined, { escape: false, sanitize: false }))
			if (connection.mail) {
				await mailStore.loadAccounts().catch(() => {})
			}
		}
		await refresh()
	} catch (exception) {
		error.value = (exception as Error).message
	} finally {
		busy.value = null
	}
}

/**
 * Switch a feature of a connection
 *
 * @param connection - Connection
 * @param feature - Feature
 * @param on - On or off
 */
async function toggle(connection: Connection, feature: keyof Features, on: boolean) {
	busy.value = `${connection.id}`
	try {
		Object.assign(connection, await updateConnection(connection.id, { [feature]: on }))
		if (feature === 'mail') {
			await mailStore.loadAccounts().catch(() => {})
		}
	} catch (exception) {
		console.error('Could not change the connection', exception)
		showError(t('talk_desktop', 'Could not change {email}', { email: connection.email }, undefined, { escape: false, sanitize: false }))
	} finally {
		busy.value = null
	}
}

/**
 * Sync a connection now
 *
 * @param connection - Connection
 */
async function sync(connection: Connection) {
	busy.value = `${connection.id}`
	try {
		Object.assign(connection, await syncNow(connection.id))
	} catch (exception) {
		console.error('Could not sync', exception)
		showError(t('talk_desktop', 'Could not sync {email}', { email: connection.email }, undefined, { escape: false, sanitize: false }))
	} finally {
		busy.value = null
	}
}

/**
 * Disconnect the account being confirmed
 */
async function confirmDisconnect() {
	const connection = confirmingDisconnect.value!
	confirmingDisconnect.value = null
	busy.value = `${connection.id}`
	try {
		await disconnect(connection.id, keepData.value)
		await refresh()
		await mailStore.loadAccounts().catch(() => {})
	} catch (exception) {
		console.error('Could not disconnect', exception)
		showError(t('talk_desktop', 'Could not disconnect {email}', { email: connection.email }, undefined, { escape: false, sanitize: false }))
	} finally {
		busy.value = null
	}
}
</script>

<template>
	<NcDialog :name="t('talk_desktop', 'Connected accounts')" size="normal" @update:open="(open) => !open && emit('close')">
		<div v-if="connections === undefined" class="connected__loading">
			<NcLoadingIcon :size="32" />
		</div>

		<NcNoteCard
			v-else-if="connections === null"
			type="info"
			:text="t('talk_desktop', 'Connecting Google and Microsoft 365 accounts needs the TeamsLogic app on your Nextcloud server. Ask your administrator to install it. You can still add email accounts in Mail.')" />

		<div v-else class="connected">
			<p class="connected__intro">
				{{ t('talk_desktop', 'Your Google or Microsoft 365 mail, calendars and contacts, kept in sync with TeamsLogic both ways.') }}
			</p>

			<ul v-if="connections.length" class="connected__list">
				<li v-for="connection in connections" :key="connection.id" class="connected__item">
					<div class="connected__head">
						<FluentIcon name="mailSmall" :size="20" />
						<span class="connected__name">
							<strong>{{ connection.email }}</strong>
							<span>{{ PROVIDERS[connection.provider] }} · {{ status(connection) }}</span>
						</span>
						<NcButton variant="tertiary" :disabled="busy !== null" @click="sync(connection)">
							<template #icon>
								<NcLoadingIcon v-if="busy === `${connection.id}`" :size="20" />
								<FluentIcon v-else name="arrowSync" :size="20" />
							</template>
							{{ t('talk_desktop', 'Sync now') }}
						</NcButton>
						<NcButton variant="tertiary" :disabled="busy !== null" @click="confirmingDisconnect = connection; keepData = false">
							{{ t('talk_desktop', 'Disconnect') }}
						</NcButton>
					</div>
					<div class="connected__features">
						<NcCheckboxRadioSwitch
							v-for="feature in FEATURES"
							:key="feature.id"
							type="switch"
							:modelValue="connection[feature.id]"
							:disabled="busy !== null"
							@update:modelValue="(on: boolean) => toggle(connection, feature.id, on)">
							{{ feature.label }}
						</NcCheckboxRadioSwitch>
					</div>
					<div v-if="confirmingDisconnect === connection" class="connected__confirm">
						<p>{{ t('talk_desktop', 'Disconnect {email}?', { email: connection.email }, undefined, { escape: false, sanitize: false }) }}</p>
						<NcCheckboxRadioSwitch v-model="keepData">
							{{ t('talk_desktop', 'Keep a copy of its calendars and contacts') }}
						</NcCheckboxRadioSwitch>
						<div class="connected__confirm-actions">
							<NcButton variant="tertiary" @click="confirmingDisconnect = null">
								{{ t('talk_desktop', 'Cancel') }}
							</NcButton>
							<NcButton variant="error" @click="confirmDisconnect">
								{{ t('talk_desktop', 'Disconnect') }}
							</NcButton>
						</div>
					</div>
				</li>
			</ul>

			<section class="connected__add">
				<h3>{{ t('talk_desktop', 'Connect an account') }}</h3>
				<div class="connected__features">
					<NcCheckboxRadioSwitch v-for="feature in FEATURES" :key="feature.id" v-model="newFeatures[feature.id]">
						{{ feature.label }}
					</NcCheckboxRadioSwitch>
				</div>
				<div class="connected__providers">
					<NcButton variant="secondary" :disabled="busy !== null" @click="add('google')">
						<template #icon>
							<NcLoadingIcon v-if="busy === 'google'" :size="20" />
							<FluentIcon v-else name="add" :size="20" />
						</template>
						{{ t('talk_desktop', 'Connect Google') }}
					</NcButton>
					<NcButton variant="secondary" :disabled="busy !== null" @click="add('microsoft')">
						<template #icon>
							<NcLoadingIcon v-if="busy === 'microsoft'" :size="20" />
							<FluentIcon v-else name="add" :size="20" />
						</template>
						{{ t('talk_desktop', 'Connect Microsoft 365') }}
					</NcButton>
				</div>
				<NcNoteCard v-if="error" type="warning" :text="error" />
			</section>
		</div>

		<template #actions>
			<NcButton variant="primary" @click="emit('close')">
				{{ t('talk_desktop', 'Done') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.connected {
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.connected__loading {
	display: flex;
	justify-content: center;
	padding: 24px;
}

.connected__intro {
	margin: 0;
	color: var(--teamslogic-foreground-3);
}

.connected__list {
	margin: 0;
	padding: 0;
	list-style: none;
}

.connected__item {
	padding: 12px 0;
	border-block-end: 1px solid var(--teamslogic-stroke);
}

.connected__head {
	display: flex;
	align-items: center;
	gap: 12px;
}

.connected__name {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	min-width: 0;

	span {
		color: var(--teamslogic-foreground-3);
		font-size: 12px;
	}
}

.connected__features {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 16px;
	padding-inline-start: 32px;
}

.connected__confirm {
	margin: 8px 0 0 32px;
	padding: 12px;
	border-radius: var(--border-radius-element);
	background-color: var(--color-background-hover);

	p {
		margin: 0 0 8px;
		font-weight: 600;
	}
}

.connected__confirm-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}

.connected__add {
	display: flex;
	flex-direction: column;
	gap: 8px;

	h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}

	.connected__features {
		padding-inline-start: 0;
	}
}

.connected__providers {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
</style>
