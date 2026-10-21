/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Credentials } from '../authentication/loginFlowV1.service.ts'

import { BrowserWindow, session, shell } from 'electron'
import { getBrowserWindowIcon } from '../shared/icons.utils.js'
import { appData } from './AppData.js'
import { promptCertificateTrust } from './certificate.service.ts'
import { getScaledWindowSize } from './utils.ts'

/**
 * Get the session of the sign-in windows, set up for the current server.
 *
 * It is not the default session: the app's https protocol handler re-fetches every request there with net.fetch,
 * which follows the provider's cross-site redirect to the callback itself. The window then stays on the provider's
 * URL with the callback's page, which renders blank, and the callback is never seen as navigated to.
 *
 * @param parentWindow - The window certificate prompts belong to
 */
function getOAuthSession(parentWindow: BrowserWindow) {
	// Not persisted: provider sign-ins are kept only until the app quits
	const oauthSession = session.fromPartition('oauth-signin')

	// Accept the server's untrusted certificate when the user accepted it before, as on the default session
	oauthSession.setCertificateVerifyProc(async (request, callback) => {
		const isAccepted = request.errorCode === 0 || await promptCertificateTrust(parentWindow, request)
		callback(isAccepted ? 0 : -3)
	})

	// Reach the server's callback signed in, as the web request interceptor does on the default session
	const credentials = appData.credentials as Credentials | null
	if (!credentials) {
		oauthSession.webRequest.onBeforeSendHeaders(null)
		return oauthSession
	}
	const authorization = `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`, 'utf8').toString('base64')}`
	oauthSession.webRequest.onBeforeSendHeaders({ urls: [`${appData.serverUrl}/*`] }, (details, callback) => {
		callback({ requestHeaders: { ...details.requestHeaders, Authorization: authorization } })
	})

	return oauthSession
}

/**
 * Open a Google or Microsoft sign-in in an app window, for connecting an account to the server.
 *
 * The window has its own session, which sends the app's credentials to the server, so the server's OAuth callback
 * is reached signed in, which a system browser could not do. It closes once the callback page loaded.
 *
 * @param parentWindow - The window it belongs to
 * @param url - The provider's authorization URL
 * @param callbackPaths - Server paths of the OAuth callbacks, e.g. /apps/mail/integration/
 * @return Whether the sign-in reached the server callback (false when the user closed the window)
 */
export function openOAuthWindow(parentWindow: BrowserWindow, url: string, callbackPaths: string[]): Promise<boolean> {
	if (!url.startsWith('https://')) {
		return Promise.resolve(false)
	}

	const window = new BrowserWindow({
		parent: parentWindow,
		...getScaledWindowSize({ width: 520, height: 720 }),
		icon: getBrowserWindowIcon(),
		autoHideMenuBar: true,
		show: false,
		webPreferences: {
			session: getOAuthSession(parentWindow),
			// A third-party page: nothing of the app is exposed
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	})

	return new Promise((resolve) => {
		let reachedCallback = false

		const isCallback = (target: string) => {
			try {
				const parsed = new URL(target)
				return parsed.origin === new URL(appData.serverUrl!).origin
					&& callbackPaths.some((path) => parsed.pathname.replace(/^\/index\.php/, '').startsWith(path))
			} catch {
				return false
			}
		}

		window.webContents.on('did-navigate', (event, target) => {
			if (isCallback(target)) {
				reachedCallback = true
			}
		})

		window.webContents.on('did-finish-load', () => {
			if (reachedCallback) {
				// Let the user see the server's confirmation for a moment
				setTimeout(() => !window.isDestroyed() && window.close(), 1200)
			}
		})

		// Popups of the provider pages (help, privacy) go to the browser
		window.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
			shell.openExternal(popupUrl)
			return { action: 'deny' }
		})

		window.on('closed', () => resolve(reachedCallback))
		window.once('ready-to-show', () => window.show())
		window.loadURL(url)
	})
}
