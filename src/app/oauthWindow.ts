/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { BrowserWindow, shell } from 'electron'
import { getBrowserWindowIcon } from '../shared/icons.utils.js'
import { appData } from './AppData.js'
import { getScaledWindowSize } from './utils.ts'

/**
 * Open a Google or Microsoft sign-in in an app window, for connecting an account to the server.
 *
 * The window uses the app's session, so the server's OAuth callback is reached signed in (the web request
 * interceptor adds the credentials), which a system browser could not do. It closes once the callback page loaded.
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
