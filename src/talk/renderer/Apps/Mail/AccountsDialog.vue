<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { MailAccount, OAuthProvider, ServerSettings } from './mail.service.ts'

import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { computed, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcPasswordField from '@nextcloud/vue/components/NcPasswordField'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import { appData } from '../../../../app/AppData.js'
import { connect, listConnections } from '../Accounts/connections.service.ts'
import { connectOAuthAccount, createAccount, deleteAccount, discoverServers, getOAuthUrls, setSignature } from './mail.service.ts'
import { useMailStore } from './mail.store.ts'

const props = defineProps<{
	/** Open on the add form, for a first account */
	startAdding?: boolean
}>()

const emit = defineEmits<{
	close: []
}>()

const mailStore = useMailStore()

type View = 'list' | 'add' | 'signature'
const view = ref<View>(props.startAdding ? 'add' : 'list')
const busy = ref(false)
const error = ref('')
const oauthUrls = ref<Partial<Record<OAuthProvider, string>>>({})

const displayName = (appData.userMetadata as { 'display-name'?: string } | null)?.['display-name'] ?? ''

// Add form
const name = ref(displayName)
const email = ref('')
const password = ref('')
const manual = ref(false)
const imap = ref<ServerSettings>({ host: '', port: 993, sslMode: 'ssl', user: '', password: '' })
const smtp = ref<ServerSettings>({ host: '', port: 587, sslMode: 'tls', user: '', password: '' })

// Signature form
const signatureAccount = ref<MailAccount | null>(null)
const signature = ref('')

/** Gmail and Microsoft addresses sign in at the provider instead of with a password */
const oauthProvider = computed<OAuthProvider | null>(() => {
	const domain = email.value.split('@')[1]?.toLowerCase() ?? ''
	if (['gmail.com', 'googlemail.com'].includes(domain)) {
		return 'google'
	}
	if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain) || domain.endsWith('.onmicrosoft.com')) {
		return 'microsoft'
	}
	return null
})

/** The TeamsLogic server app connects Google and Microsoft accounts in one go: mail, calendar and contacts */
const serverConnect = ref(false)

onMounted(async () => {
	oauthUrls.value = await getOAuthUrls().catch(() => ({}))
	serverConnect.value = (await listConnections().catch(() => null)) !== null
})

/**
 * Connect a Google or Microsoft account through the TeamsLogic server app
 *
 * @param provider - google or microsoft
 */
async function addThroughServer(provider: OAuthProvider) {
	busy.value = true
	try {
		const connection = await connect(provider, { mail: true, calendar: true, contacts: true })
		if (connection) {
			showSuccess(t('talk_desktop', '{email} is connected: mail, calendar and contacts', { email: connection.email }, undefined, { escape: false, sanitize: false }))
			await mailStore.loadAccounts()
			await mailStore.loadMessages()
			view.value = 'list'
		} else {
			error.value = t('talk_desktop', 'Sign-in was cancelled or did not finish.')
		}
	} catch (exception) {
		error.value = (exception as Error).message
	} finally {
		busy.value = false
	}
}

/**
 * Add the account: provider sign-in, or discovered/manual IMAP and SMTP servers
 *
 * @param provider - Sign in with Google or Microsoft (for Microsoft 365 work addresses too)
 */
async function add(provider: OAuthProvider | null = oauthProvider.value) {
	error.value = ''
	if (provider && serverConnect.value) {
		await addThroughServer(provider)
		return
	}
	if (!email.value.includes('@')) {
		error.value = t('talk_desktop', 'Enter your email address')
		return
	}
	busy.value = true
	try {
		if (provider) {
			const authorizeUrl = oauthUrls.value[provider]
			if (!authorizeUrl) {
				error.value = provider === 'google'
					? t('talk_desktop', 'Signing in with Google is not set up on your server yet. Your administrator can turn it on in Nextcloud\'s Groupware settings (Gmail integration).')
					: t('talk_desktop', 'Signing in with Microsoft is not set up on your server yet. Your administrator can turn it on in Nextcloud\'s Groupware settings (Microsoft integration).')
				return
			}
			const account = await connectOAuthAccount(provider, email.value.trim(), name.value.trim() || email.value.trim(), authorizeUrl)
			if (!account) {
				error.value = t('talk_desktop', 'Sign-in was cancelled or did not finish.')
				return
			}
		} else {
			if (!manual.value) {
				const found = await discoverServers(email.value.trim())
				if (!found?.imap || !found.smtp) {
					// Fill what is likely and let the user check
					const domain = email.value.split('@')[1]
					imap.value = { ...imap.value, host: `imap.${domain}`, user: email.value.trim() }
					smtp.value = { ...smtp.value, host: `smtp.${domain}`, user: email.value.trim() }
					manual.value = true
					error.value = t('talk_desktop', 'We couldn\'t find the settings for this address. Check the server details below.')
					return
				}
				imap.value = { ...found.imap, password: '' }
				smtp.value = { ...found.smtp, password: '' }
			}
			await createAccount({
				name: name.value.trim() || email.value.trim(),
				email: email.value.trim(),
				imap: { ...imap.value, password: imap.value.password || password.value },
				smtp: { ...smtp.value, password: smtp.value.password || password.value },
			})
		}
		showSuccess(t('talk_desktop', '{email} was added', { email: email.value.trim() }, undefined, { escape: false, sanitize: false }))
		await mailStore.loadAccounts()
		await mailStore.loadMessages()
		email.value = ''
		password.value = ''
		manual.value = false
		view.value = 'list'
	} catch (exception) {
		console.error('Could not add the account', exception)
		const data = (exception as { response?: { data?: { data?: { error?: string, service?: string, host?: string } } } }).response?.data?.data
		error.value = data?.error === 'CONNECTION_ERROR'
			? t('talk_desktop', 'Could not connect to the {service} server {host}. Check the address, password and server details.', { service: data.service ?? '', host: data.host ?? '' }, undefined, { escape: false, sanitize: false })
			: t('talk_desktop', 'The account could not be added.')
		manual.value = true
	} finally {
		busy.value = false
	}
}

/**
 * Remove an account from the app (and Nextcloud Mail); the mailbox stays as it is
 *
 * @param account - Account
 */
async function remove(account: MailAccount) {
	busy.value = true
	try {
		await deleteAccount(account.id)
		await mailStore.loadAccounts()
		mailStore.selectFolder('unified')
	} catch (exception) {
		console.error('Could not remove the account', exception)
		showError(t('talk_desktop', 'Could not remove {email}', { email: account.emailAddress }, undefined, { escape: false, sanitize: false }))
	} finally {
		busy.value = false
	}
}

/**
 * Edit the signature of an account
 *
 * @param account - Account
 */
function editSignature(account: MailAccount) {
	signatureAccount.value = account
	signature.value = (account.signature ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
	view.value = 'signature'
}

/**
 * Save the signature
 */
async function saveSignature() {
	const escaped = signature.value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]!).replace(/\n/g, '<br>')
	await setSignature(signatureAccount.value!.id, escaped)
	await mailStore.loadAccounts()
	view.value = 'list'
}
</script>

<template>
	<NcDialog
		:name="view === 'add' ? t('talk_desktop', 'Add an email account') : view === 'signature' ? t('talk_desktop', 'Signature') : t('talk_desktop', 'Email accounts')"
		size="normal"
		@update:open="(open) => !open && emit('close')">
		<div v-if="view === 'list'" class="accounts">
			<ul class="accounts__list">
				<li v-for="account in mailStore.accounts" :key="account.id" class="accounts__item">
					<FluentIcon name="mailSmall" :size="20" />
					<span class="accounts__name">
						<strong>{{ account.emailAddress }}</strong>
						<span>{{ account.authMethod === 'xoauth2' ? (account.imapHost.includes('gmail') ? t('talk_desktop', 'Google account') : t('talk_desktop', 'Microsoft account')) : account.imapHost }}</span>
					</span>
					<NcButton variant="tertiary" @click="editSignature(account)">
						{{ t('talk_desktop', 'Signature') }}
					</NcButton>
					<NcButton variant="tertiary" :disabled="busy" @click="remove(account)">
						{{ t('talk_desktop', 'Remove') }}
					</NcButton>
				</li>
			</ul>
			<p v-if="!mailStore.accounts.length" class="accounts__hint">
				{{ t('talk_desktop', 'No email accounts yet.') }}
			</p>
		</div>

		<form v-else-if="view === 'add'" class="accounts__form" @submit.prevent="add()">
			<div class="accounts__providers">
				<NcButton variant="secondary" :disabled="busy" @click="add('google')">
					<template #icon>
						<FluentIcon name="mailSmall" :size="20" />
					</template>
					{{ t('talk_desktop', 'Sign in with Google') }}
				</NcButton>
				<NcButton variant="secondary" :disabled="busy" @click="add('microsoft')">
					<template #icon>
						<FluentIcon name="mailSmall" :size="20" />
					</template>
					{{ t('talk_desktop', 'Sign in with Microsoft') }}
				</NcButton>
			</div>
			<p class="accounts__hint">
				{{ t('talk_desktop', 'For Gmail and Microsoft 365 or Outlook.com, enter your address, then sign in with Google or Microsoft. For other email, including Exchange, enter your address and password.') }}
			</p>
			<NcTextField v-model="name" :label="t('talk_desktop', 'Your name')" />
			<NcTextField
				v-model="email"
				type="email"
				:label="t('talk_desktop', 'Email address')"
				required />
			<NcPasswordField v-if="!oauthProvider && !manual" v-model="password" :label="t('talk_desktop', 'Password')" />

			<fieldset v-if="manual && !oauthProvider" class="accounts__manual">
				<legend>{{ t('talk_desktop', 'Incoming mail (IMAP)') }}</legend>
				<NcTextField v-model="imap.host" :label="t('talk_desktop', 'Server')" />
				<div class="accounts__pair">
					<NcTextField v-model.number="imap.port" type="number" :label="t('talk_desktop', 'Port')" />
					<select v-model="imap.sslMode" :aria-label="t('talk_desktop', 'Security')">
						<option value="ssl">
							SSL/TLS
						</option>
						<option value="tls">
							STARTTLS
						</option>
						<option value="none">
							{{ t('talk_desktop', 'None') }}
						</option>
					</select>
				</div>
				<NcTextField v-model="imap.user" :label="t('talk_desktop', 'User name')" />
				<NcPasswordField v-model="imap.password" :label="t('talk_desktop', 'Password')" />
				<legend>{{ t('talk_desktop', 'Outgoing mail (SMTP)') }}</legend>
				<NcTextField v-model="smtp.host" :label="t('talk_desktop', 'Server')" />
				<div class="accounts__pair">
					<NcTextField v-model.number="smtp.port" type="number" :label="t('talk_desktop', 'Port')" />
					<select v-model="smtp.sslMode" :aria-label="t('talk_desktop', 'Security')">
						<option value="ssl">
							SSL/TLS
						</option>
						<option value="tls">
							STARTTLS
						</option>
						<option value="none">
							{{ t('talk_desktop', 'None') }}
						</option>
					</select>
				</div>
				<NcTextField v-model="smtp.user" :label="t('talk_desktop', 'User name')" />
				<NcPasswordField v-model="smtp.password" :label="t('talk_desktop', 'Password (if different)')" />
			</fieldset>
			<NcButton v-else-if="!oauthProvider" variant="tertiary" @click="manual = true">
				{{ t('talk_desktop', 'Set up servers manually') }}
			</NcButton>

			<NcNoteCard v-if="error" type="warning" :text="error" />
		</form>

		<div v-else class="accounts__form">
			<NcTextArea v-model="signature" :label="t('talk_desktop', 'Signature for {email}', { email: signatureAccount?.emailAddress ?? '' }, undefined, { escape: false, sanitize: false })" resize="vertical" />
		</div>

		<template #actions>
			<template v-if="view === 'list'">
				<NcButton variant="primary" @click="view = 'add'">
					<template #icon>
						<FluentIcon name="add" :size="20" />
					</template>
					{{ t('talk_desktop', 'Add account') }}
				</NcButton>
			</template>
			<template v-else-if="view === 'add'">
				<NcButton variant="tertiary" @click="mailStore.accounts.length ? (view = 'list') : emit('close')">
					{{ t('talk_desktop', 'Cancel') }}
				</NcButton>
				<NcButton variant="primary" :disabled="busy || !email" @click="add()">
					{{ busy ? t('talk_desktop', 'Connecting…') : oauthProvider ? t('talk_desktop', 'Continue to sign in') : t('talk_desktop', 'Add') }}
				</NcButton>
			</template>
			<template v-else>
				<NcButton variant="tertiary" @click="view = 'list'">
					{{ t('talk_desktop', 'Cancel') }}
				</NcButton>
				<NcButton variant="primary" @click="saveSignature">
					{{ t('talk_desktop', 'Save') }}
				</NcButton>
			</template>
		</template>
	</NcDialog>
</template>

<style scoped>
.accounts__list {
	margin: 0;
	padding: 0;
	list-style: none;
}

.accounts__item {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 8px 0;
	border-block-end: 1px solid var(--teamslogic-stroke);
}

.accounts__name {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	min-width: 0;

	span {
		color: var(--teamslogic-foreground-3);
		font-size: 12px;
	}
}

.accounts__form {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.accounts__providers {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.accounts__hint {
	margin: 0;
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}

.accounts__manual {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin: 0;
	padding: 0;
	border: none;

	legend {
		margin-block: 8px 0;
		font-weight: 600;
	}
}

.accounts__pair {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
	align-items: end;

	select {
		height: 36px;
		margin: 0;
	}
}
</style>
