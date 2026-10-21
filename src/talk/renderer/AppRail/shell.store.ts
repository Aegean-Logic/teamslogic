/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { defineStore } from 'pinia'
import { readonly, ref, watchEffect } from 'vue'
import { getCurrentConversationToken, isInCall, openConversation, openRoot } from '../TalkWrapper/talk.service.ts'

export type ShellApp = 'activity' | 'chat' | 'calendar' | 'calls' | 'files'

const SHELL_APPS: ShellApp[] = ['activity', 'chat', 'calendar', 'calls', 'files']
const STORAGE_KEY = 'teamslogic:app'

/**
 * Read the app shown last time
 */
function readLastApp(): ShellApp {
	try {
		const app = localStorage.getItem(STORAGE_KEY) as ShellApp
		return SHELL_APPS.includes(app) ? app : 'chat'
	} catch {
		return 'chat'
	}
}

/**
 * The Teams-style app shown beside the rail: Talk (Chat) or one of the TeamsLogic apps
 */
export const useShellStore = defineStore('shell', () => {
	const currentApp = ref<ShellApp>(readLastApp())
	/** Conversation open in Chat when the user switched away, reopened when they come back */
	const parkedToken = ref<string | null>(null)
	/** Token of the conversation with a call running while Chat is hidden */
	const callToken = ref<string | null>(null)

	watchEffect(() => {
		document.body.dataset.teamslogicApp = currentApp.value
		try {
			localStorage.setItem(STORAGE_KEY, currentApp.value)
		} catch {
			// Only a convenience
		}
	})

	/**
	 * Show an app
	 *
	 * @param app - The app
	 */
	function showApp(app: ShellApp) {
		if (app === currentApp.value) {
			return
		}

		if (currentApp.value === 'chat' && window.OCA.Talk?.instance) {
			const token = getCurrentConversationToken()
			parkedToken.value = token
			// Hidden Talk would still mark new messages read, so leave the conversation unless a call is running there
			if (token && isInCall(token)) {
				callToken.value = token
			} else {
				callToken.value = null
				openRoot()
			}
		}

		const tokenToReopen = app === 'chat' && !callToken.value ? parkedToken.value : null
		if (app === 'chat') {
			parkedToken.value = null
			callToken.value = null
		}
		currentApp.value = app

		if (tokenToReopen) {
			openConversation(tokenToReopen)
		}
	}

	/**
	 * Show Chat with a conversation
	 *
	 * @param token - Conversation token
	 * @param options - Options of openConversation
	 * @param options.directCall - Join its call
	 * @param options.messageId - Message to scroll to
	 */
	async function openChat(token: string, options: { directCall?: boolean, messageId?: number | string } = {}) {
		parkedToken.value = null
		callToken.value = null
		currentApp.value = 'chat'
		await openConversation(token, options)
	}

	/**
	 * Connect to Talk once it runs: park the conversation it restored if another app is shown,
	 * and bring Chat forward whenever something else opens a conversation (notifications, other windows)
	 */
	function onTalkReady() {
		if (currentApp.value !== 'chat') {
			parkedToken.value = getCurrentConversationToken()
			if (parkedToken.value) {
				openRoot()
			}
		}

		window.OCA.Talk.instance.$router.afterEach((to: { name?: unknown }) => {
			if (to.name === 'conversation' && currentApp.value !== 'chat') {
				parkedToken.value = null
				callToken.value = null
				currentApp.value = 'chat'
			}
		})
	}

	return {
		currentApp: readonly(currentApp),
		callToken: readonly(callToken),
		showApp,
		openChat,
		onTalkReady,
	}
})
