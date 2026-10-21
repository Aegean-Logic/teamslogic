/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { defineStore } from 'pinia'
import { readonly, ref } from 'vue'

export type FilesView = 'recent' | 'mine' | 'shared' | 'favorites'

/**
 * Where the Files app is, so other apps (Activity) can send the user there
 */
export const useFilesStore = defineStore('files', () => {
	const view = ref<FilesView>('recent')
	const path = ref('/')

	/**
	 * Show a list, or a folder of My files
	 *
	 * @param newView - The list
	 * @param newPath - Folder in My files
	 */
	function openView(newView: FilesView, newPath = '/') {
		view.value = newView
		path.value = newView === 'mine' ? newPath : '/'
	}

	return {
		view: readonly(view),
		path: readonly(path),
		openView,
	}
})
