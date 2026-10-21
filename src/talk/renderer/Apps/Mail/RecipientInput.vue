<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { Address } from './mail.service.ts'

import axios from '@nextcloud/axios'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { ref, useTemplateRef } from 'vue'
import FluentIcon from '../../AppRail/FluentIcon.vue'

const recipients = defineModel<Address[]>({ required: true })

defineProps<{
	label: string
}>()

const text = ref('')
const suggestions = ref<Address[]>([])
const highlighted = ref(0)
const input = useTemplateRef('input')
let searchTimer: number | undefined

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Suggest addresses from contacts and earlier mail (Nextcloud Mail's autocomplete)
 */
function onInput() {
	window.clearTimeout(searchTimer)
	const term = text.value.trim()
	if (term.length < 2) {
		suggestions.value = []
		return
	}
	searchTimer = window.setTimeout(async () => {
		try {
			const response = await axios.get(generateUrl('/apps/mail/api/autoComplete'), { params: { term } })
			const entries = (response.data ?? []) as { label?: string, email: string | string[] }[]
			suggestions.value = entries
				.flatMap((entry) => (Array.isArray(entry.email) ? entry.email : [entry.email]).map((email) => ({ label: entry.label || email, email })))
				.filter((entry) => !recipients.value.some((recipient) => recipient.email === entry.email))
				.slice(0, 8)
			highlighted.value = 0
		} catch {
			suggestions.value = []
		}
	}, 200)
}

/**
 * Add a recipient
 *
 * @param address - The address
 */
function add(address: Address) {
	if (!recipients.value.some((recipient) => recipient.email === address.email)) {
		recipients.value = [...recipients.value, address]
	}
	text.value = ''
	suggestions.value = []
	input.value?.focus()
}

/**
 * Turn what was typed into a recipient, if it is an address
 */
function commitText() {
	const value = text.value.trim().replace(/[,;]$/, '')
	if (suggestions.value.length && suggestions.value[highlighted.value]) {
		add(suggestions.value[highlighted.value]!)
	} else if (EMAIL_RE.test(value)) {
		add({ label: value, email: value })
	}
}

/**
 * Leaving the field keeps a typed address, after a click on a suggestion had its turn
 */
function onBlur() {
	window.setTimeout(commitText, 150)
}

/**
 * Keyboard: Enter/comma/semicolon add, Backspace removes the last, arrows pick a suggestion
 *
 * @param event - Key
 */
function onKeydown(event: KeyboardEvent) {
	if (['Enter', ',', ';', 'Tab'].includes(event.key) && (text.value.trim() || event.key !== 'Tab')) {
		if (text.value.trim()) {
			event.preventDefault()
			commitText()
		}
	} else if (event.key === 'Backspace' && !text.value && recipients.value.length) {
		recipients.value = recipients.value.slice(0, -1)
	} else if (event.key === 'ArrowDown' && suggestions.value.length) {
		event.preventDefault()
		highlighted.value = (highlighted.value + 1) % suggestions.value.length
	} else if (event.key === 'ArrowUp' && suggestions.value.length) {
		event.preventDefault()
		highlighted.value = (highlighted.value - 1 + suggestions.value.length) % suggestions.value.length
	} else if (event.key === 'Escape') {
		suggestions.value = []
	}
}
</script>

<template>
	<div class="recipient-input" @click="input?.focus()">
		<span class="recipient-input__label">{{ label }}</span>
		<span
			v-for="recipient in recipients"
			:key="recipient.email"
			class="recipient-input__chip"
			:title="recipient.email">
			{{ recipient.label || recipient.email }}
			<button :aria-label="t('talk_desktop', 'Remove {name}', { name: recipient.label || recipient.email }, undefined, { escape: false, sanitize: false })" @click.stop="recipients = recipients.filter((item) => item !== recipient)">
				<FluentIcon name="dismiss" :size="12" />
			</button>
		</span>
		<input
			ref="input"
			v-model="text"
			class="recipient-input__field"
			type="text"
			:aria-label="label"
			@input="onInput"
			@keydown="onKeydown"
			@blur="onBlur">
		<ul v-if="suggestions.length" class="recipient-input__suggestions" role="listbox">
			<li
				v-for="(suggestion, index) in suggestions"
				:key="suggestion.email"
				role="option"
				:aria-selected="index === highlighted"
				:class="{ 'recipient-input__suggestion--active': index === highlighted }"
				@mousedown.prevent="add(suggestion)">
				<strong>{{ suggestion.label }}</strong>
				<span>{{ suggestion.email }}</span>
			</li>
		</ul>
	</div>
</template>

<style scoped>
.recipient-input {
	position: relative;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px;
	min-height: 36px;
	padding: 2px 0;
	border-block-end: 1px solid var(--teamslogic-stroke);
	cursor: text;
}

.recipient-input__label {
	width: 48px;
	color: var(--teamslogic-foreground-3);
	font-size: 13px;
}

.recipient-input__chip {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 4px 2px 8px;
	border-radius: 12px;
	background-color: var(--teamslogic-brand-tint);
	color: var(--teamslogic-foreground-1);
	font-size: 13px;

	button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		min-height: 0;
		margin: 0;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: none;
		color: var(--teamslogic-foreground-2);
		cursor: pointer;
	}
}

.recipient-input__field {
	flex: 1 1 120px;
	min-width: 120px;
	height: 28px;
	min-height: 0;
	margin: 0;
	padding: 0 4px;
	border: none !important;
	background: none;
	box-shadow: none !important;
	font-size: 14px;
	outline: none;
}

.recipient-input__suggestions {
	position: absolute;
	z-index: 10;
	top: 100%;
	inset-inline-start: 48px;
	width: min(420px, 100%);
	margin: 0;
	padding: 4px;
	border-radius: var(--border-radius-element);
	background-color: var(--teamslogic-surface);
	box-shadow: var(--teamslogic-shadow-4);
	list-style: none;

	li {
		display: flex;
		flex-direction: column;
		padding: 6px 8px;
		border-radius: var(--border-radius-element);
		cursor: pointer;

		span {
			color: var(--teamslogic-foreground-3);
			font-size: 12px;
		}
	}
}

.recipient-input__suggestion--active {
	background-color: var(--color-background-hover);
}
</style>
