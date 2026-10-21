/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ShellApp } from '../AppRail/shell.store.ts'

import { watch } from 'vue'
import { useShellStore } from '../AppRail/shell.store.ts'

/**
 * Run a callback each time an app is shown again (the apps stay mounted while hidden)
 *
 * @param app - The app
 * @param callback - Callback
 */
export function useAppShown(app: ShellApp, callback: () => void) {
	const shellStore = useShellStore()
	watch(() => shellStore.currentApp, (current, previous) => {
		if (current === app && previous !== app) {
			callback()
		}
	})
}
