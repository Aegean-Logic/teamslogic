<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { FluentIconName } from '../../AppRail/fluentIcons.ts'
import type { FileRow } from './files.service.ts'
import type { FilesView } from './files.store.ts'

import { showError, showSuccess } from '@nextcloud/dialogs'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { computed, ref, useTemplateRef, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcProgressBar from '@nextcloud/vue/components/NcProgressBar'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import AppListItem from '../components/AppListItem.vue'
import AppPane from '../components/AppPane.vue'
import AppStage from '../components/AppStage.vue'
import ConversationPicker from '../components/ConversationPicker.vue'
import { formatFileSize, formatListTime, openInBrowser } from '../apps.utils.ts'
import { useAppShown } from '../useAppShown.ts'
import {
	createFolder,
	downloadFile,
	getIconUrl,
	getWebLink,
	listFavorites,
	listFolder,
	listRecent,
	listSharedWithMe,
	setFavorite,
	shareToConversation,
	uploadFile,
} from './files.service.ts'
import { useFilesStore } from './files.store.ts'

type SortKey = 'name' | 'modified' | 'owner' | 'size'

const VIEWS: { id: FilesView, icon: FluentIconName, label: string }[] = [
	{ id: 'recent', icon: 'clock', label: t('talk_desktop', 'Recent') },
	{ id: 'mine', icon: 'folder', label: t('talk_desktop', 'My files') },
	{ id: 'shared', icon: 'people', label: t('talk_desktop', 'Shared with me') },
	{ id: 'favorites', icon: 'star', label: t('talk_desktop', 'Favourites') },
]

const filesStore = useFilesStore()

const rows = ref<FileRow[]>([])
const loading = ref(false)
const error = ref('')
const selectedId = ref<number | null>(null)
const sortKey = ref<SortKey>('modified')
const sortAscending = ref(false)
const uploads = ref<{ id: number, name: string, progress: number }[]>([])
let lastUploadId = 0
const isDragging = ref(false)
const newFolderOpen = ref(false)
const newFolderName = ref('')
const shareRow = ref<FileRow | null>(null)
const fileInput = useTemplateRef('fileInput')

const viewTitle = computed(() => VIEWS.find((view) => view.id === filesStore.view)!.label)

const breadcrumbs = computed(() => {
	const parts = filesStore.path.split('/').filter(Boolean)
	return [
		{ name: t('talk_desktop', 'My files'), path: '/' },
		...parts.map((part, index) => ({ name: part, path: '/' + parts.slice(0, index + 1).join('/') })),
	]
})

const sortedRows = computed(() => {
	const direction = sortAscending.value ? 1 : -1
	return [...rows.value].sort((a, b) => {
		// Folders first, as in Teams
		if (a.isFolder !== b.isFolder) {
			return a.isFolder ? -1 : 1
		}
		switch (sortKey.value) {
			case 'name':
				return direction * a.name.localeCompare(b.name)
			case 'owner':
				return direction * a.owner.localeCompare(b.owner)
			case 'size':
				return direction * ((a.size ?? 0) - (b.size ?? 0))
			default:
				return direction * (a.modified.getTime() - b.modified.getTime())
		}
	})
})

const canUpload = computed(() => filesStore.view === 'mine')

/**
 * Load the current list
 */
async function refresh() {
	loading.value = true
	error.value = ''
	try {
		switch (filesStore.view) {
			case 'recent':
				rows.value = await listRecent()
				break
			case 'shared':
				rows.value = await listSharedWithMe()
				break
			case 'favorites':
				rows.value = await listFavorites()
				break
			default:
				rows.value = await listFolder(filesStore.path)
		}
	} catch (exception) {
		console.error('Could not load files', exception)
		rows.value = []
		error.value = t('talk_desktop', 'Your files could not be loaded.')
	} finally {
		loading.value = false
	}
}

watch(() => [filesStore.view, filesStore.path], () => {
	selectedId.value = null
	refresh()
}, { immediate: true })

useAppShown('files', refresh)

/**
 * Sort by a column, or flip the order
 *
 * @param key - Column
 */
function sortBy(key: SortKey) {
	if (sortKey.value === key) {
		sortAscending.value = !sortAscending.value
	} else {
		sortKey.value = key
		sortAscending.value = key === 'name' || key === 'owner'
	}
}

/**
 * Whether the built-in viewer shows this file
 *
 * @param row - The file
 */
function canPreview(row: FileRow) {
	return window.OCA.Viewer.availableHandlers.some((handler: { mimes: string[] }) => handler.mimes.includes(row.mime))
}

/**
 * Open a file or folder: folders in place, media and text in the viewer, documents in Nextcloud
 *
 * @param row - The file
 */
function open(row: FileRow) {
	if (row.isFolder) {
		filesStore.openView('mine', row.path)
		return
	}
	if (canPreview(row)) {
		const toFileInfo = (item: FileRow) => ({ fileid: item.id, mime: item.mime, filename: item.path, basename: item.name, etag: item.etag })
		window.OCA.Viewer.open({
			fileInfo: toFileInfo(row),
			list: sortedRows.value.filter((item) => !item.isFolder && canPreview(item)).map(toFileInfo),
		})
		return
	}
	openInBrowser(getWebLink(row))
}

/**
 * Add or remove a favourite
 *
 * @param row - The file
 */
async function toggleFavorite(row: FileRow) {
	try {
		await setFavorite(row.path, !row.favorite)
		row.favorite = !row.favorite
		if (filesStore.view === 'favorites' && !row.favorite) {
			rows.value = rows.value.filter((item) => item !== row)
		}
	} catch (exception) {
		console.error('Could not change the favourite', exception)
		showError(t('talk_desktop', 'Could not change the favourite'))
	}
}

/**
 * Save a file to the computer
 *
 * @param row - The file
 */
async function download(row: FileRow) {
	try {
		await downloadFile(row)
	} catch (exception) {
		console.error('Could not download the file', exception)
		showError(t('talk_desktop', 'Could not download {file}', { file: row.name }))
	}
}

/**
 * Share the picked file into a conversation
 *
 * @param token - Conversation token
 */
async function share(token: string) {
	const row = shareRow.value!
	shareRow.value = null
	try {
		await shareToConversation(row.path, token)
		showSuccess(t('talk_desktop', '{file} was shared in the chat', { file: row.name }))
	} catch (exception) {
		console.error('Could not share the file', exception)
		showError(t('talk_desktop', 'Could not share {file}', { file: row.name }))
	}
}

/**
 * Upload files into the open folder
 *
 * @param files - Files
 */
async function upload(files: FileList | File[]) {
	if (!canUpload.value) {
		return
	}
	const folder = filesStore.path
	await Promise.all([...files].map(async (file) => {
		const id = ++lastUploadId
		uploads.value.push({ id, name: file.name, progress: 0 })
		try {
			await uploadFile(folder, file, (progress) => {
				const entry = uploads.value.find((item) => item.id === id)
				if (entry) {
					entry.progress = progress
				}
			})
		} catch (exception) {
			console.error('Upload failed', exception)
			showError(t('talk_desktop', 'Could not upload {file}', { file: file.name }))
		} finally {
			uploads.value = uploads.value.filter((item) => item.id !== id)
		}
	}))
	if (folder === filesStore.path) {
		refresh()
	}
}

/**
 * Upload what is dropped on the list
 *
 * @param event - Drop
 */
function onDrop(event: DragEvent) {
	isDragging.value = false
	if (event.dataTransfer?.files.length) {
		upload(event.dataTransfer.files)
	}
}

/**
 * Create the folder named in the dialog
 */
async function confirmNewFolder() {
	const name = newFolderName.value.trim()
	if (!name || name.includes('/')) {
		return
	}
	newFolderOpen.value = false
	if (rows.value.some((row) => row.name === name)) {
		showError(t('talk_desktop', '{folder} already exists here', { folder: name }))
		return
	}
	try {
		await createFolder(`${filesStore.path.replace(/\/$/, '')}/${name}`)
		await refresh()
	} catch (exception) {
		console.error('Could not create the folder', exception)
		showError(t('talk_desktop', 'Could not create the folder {folder}', { folder: name }))
	}
}
</script>

<template>
	<div class="files-app">
		<AppPane :title="t('talk_desktop', 'Files')">
			<ul class="files-app__nav">
				<AppListItem
					v-for="view in VIEWS"
					:key="view.id"
					:active="filesStore.view === view.id"
					@click="filesStore.openView(view.id)">
					<template #icon>
						<FluentIcon :name="view.icon" :size="20" :filled="filesStore.view === view.id" />
					</template>
					<template #title>
						{{ view.label }}
					</template>
				</AppListItem>
			</ul>
			<template #footer>
				<NcButton variant="tertiary" wide @click="openInBrowser(generateUrl('/apps/files/'))">
					<template #icon>
						<FluentIcon name="open" :size="20" />
					</template>
					{{ t('talk_desktop', 'Open Files in the browser') }}
				</NcButton>
			</template>
		</AppPane>

		<AppStage class="files-app__stage">
			<template #header>
				<nav v-if="filesStore.view === 'mine'" class="files-app__breadcrumbs" :aria-label="t('talk_desktop', 'Folder path')">
					<template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
						<FluentIcon
							v-if="index"
							class="files-app__crumb-separator"
							name="chevronRight"
							:size="16" />
						<button
							class="files-app__crumb"
							:class="{ 'files-app__crumb--current': index === breadcrumbs.length - 1 }"
							@click="filesStore.openView('mine', crumb.path)">
							{{ crumb.name }}
						</button>
					</template>
				</nav>
				<h2 v-else class="files-app__title">
					{{ viewTitle }}
				</h2>
			</template>
			<template #actions>
				<template v-if="canUpload">
					<NcButton variant="secondary" @click="newFolderName = ''; newFolderOpen = true">
						<template #icon>
							<FluentIcon name="folderAdd" :size="20" />
						</template>
						{{ t('talk_desktop', 'New folder') }}
					</NcButton>
					<NcButton variant="primary" @click="fileInput?.click()">
						<template #icon>
							<FluentIcon name="upload" :size="20" />
						</template>
						{{ t('talk_desktop', 'Upload') }}
					</NcButton>
					<input
						ref="fileInput"
						class="hidden-visually"
						type="file"
						multiple
						@change="upload(($event.target as HTMLInputElement).files!); ($event.target as HTMLInputElement).value = ''">
				</template>
			</template>

			<div
				class="files-app__content"
				:class="{ 'files-app__content--dragging': isDragging && canUpload }"
				@dragover.prevent="isDragging = canUpload"
				@dragleave.self="isDragging = false"
				@drop.prevent="onDrop">
				<div v-for="item in uploads" :key="item.id" class="files-app__upload">
					<span>{{ t('talk_desktop', 'Uploading {file}', { file: item.name }) }}</span>
					<NcProgressBar :value="Math.round(item.progress * 100)" />
				</div>

				<NcEmptyContent v-if="loading && !rows.length" class="files-app__empty" :name="t('talk_desktop', 'Loading…')">
					<template #icon>
						<NcLoadingIcon :size="48" />
					</template>
				</NcEmptyContent>
				<NcEmptyContent v-else-if="error" class="files-app__empty" :name="error">
					<template #icon>
						<FluentIcon name="folder" :size="48" />
					</template>
				</NcEmptyContent>
				<NcEmptyContent
					v-else-if="!rows.length"
					class="files-app__empty"
					:name="filesStore.view === 'mine' ? t('talk_desktop', 'This folder is empty') : t('talk_desktop', 'Nothing here yet')"
					:description="canUpload ? t('talk_desktop', 'Drop files here or use Upload.') : ''">
					<template #icon>
						<FluentIcon name="folder" :size="48" />
					</template>
				</NcEmptyContent>

				<table v-else class="files-app__table">
					<thead>
						<tr>
							<th class="files-app__col-name">
								<button @click="sortBy('name')">
									{{ t('talk_desktop', 'Name') }}
									<FluentIcon
										v-if="sortKey === 'name'"
										name="chevronDown"
										:class="{ 'files-app__sort--up': sortAscending }"
										:size="12" />
								</button>
							</th>
							<th class="files-app__col-modified">
								<button @click="sortBy('modified')">
									{{ filesStore.view === 'shared' ? t('talk_desktop', 'Shared') : t('talk_desktop', 'Modified') }}
									<FluentIcon
										v-if="sortKey === 'modified'"
										name="chevronDown"
										:class="{ 'files-app__sort--up': sortAscending }"
										:size="12" />
								</button>
							</th>
							<th class="files-app__col-owner">
								<button @click="sortBy('owner')">
									{{ filesStore.view === 'shared' ? t('talk_desktop', 'Shared by') : t('talk_desktop', 'Owner') }}
									<FluentIcon
										v-if="sortKey === 'owner'"
										name="chevronDown"
										:class="{ 'files-app__sort--up': sortAscending }"
										:size="12" />
								</button>
							</th>
							<th class="files-app__col-size">
								<button @click="sortBy('size')">
									{{ t('talk_desktop', 'Size') }}
									<FluentIcon
										v-if="sortKey === 'size'"
										name="chevronDown"
										:class="{ 'files-app__sort--up': sortAscending }"
										:size="12" />
								</button>
							</th>
							<th class="files-app__col-actions">
								<span class="hidden-visually">{{ t('talk_desktop', 'Actions') }}</span>
							</th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="row in sortedRows"
							:key="row.id + row.path"
							class="files-app__row"
							:class="{ 'files-app__row--selected': row.id === selectedId }"
							@click="selectedId = row.id"
							@dblclick="open(row)">
							<td class="files-app__col-name">
								<span class="files-app__name">
									<img
										class="files-app__icon"
										:src="getIconUrl(row)"
										alt=""
										loading="lazy">
									<button class="files-app__name-link" @click.stop="open(row)">{{ row.name }}</button>
									<FluentIcon
										v-if="row.favorite"
										class="files-app__favorite"
										name="star"
										:size="16"
										filled />
								</span>
							</td>
							<td class="files-app__col-modified">
								{{ formatListTime(row.modified) }}
							</td>
							<td class="files-app__col-owner">
								{{ row.owner }}
							</td>
							<td class="files-app__col-size">
								{{ row.size === null || row.isFolder ? '' : formatFileSize(row.size) }}
							</td>
							<td class="files-app__col-actions" @click.stop>
								<NcActions :aria-label="t('talk_desktop', 'More actions for {file}', { file: row.name })" variant="tertiary">
									<template #icon>
										<FluentIcon name="more" :size="20" />
									</template>
									<NcActionButton closeAfterClick @click="open(row)">
										<template #icon>
											<FluentIcon :name="row.isFolder ? 'folder' : 'open'" :size="20" />
										</template>
										{{ t('talk_desktop', 'Open') }}
									</NcActionButton>
									<NcActionButton v-if="!row.isFolder" closeAfterClick @click="openInBrowser(getWebLink(row))">
										<template #icon>
											<FluentIcon name="open" :size="20" />
										</template>
										{{ t('talk_desktop', 'Open in the browser') }}
									</NcActionButton>
									<NcActionButton v-if="!row.isFolder" closeAfterClick @click="download(row)">
										<template #icon>
											<FluentIcon name="download" :size="20" />
										</template>
										{{ t('talk_desktop', 'Download') }}
									</NcActionButton>
									<NcActionButton closeAfterClick @click="shareRow = row">
										<template #icon>
											<FluentIcon name="share" :size="20" />
										</template>
										{{ t('talk_desktop', 'Share in a chat') }}
									</NcActionButton>
									<NcActionButton closeAfterClick @click="toggleFavorite(row)">
										<template #icon>
											<FluentIcon name="star" :size="20" :filled="row.favorite" />
										</template>
										{{ row.favorite ? t('talk_desktop', 'Remove from favourites') : t('talk_desktop', 'Add to favourites') }}
									</NcActionButton>
								</NcActions>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</AppStage>

		<NcDialog
			v-if="newFolderOpen"
			:name="t('talk_desktop', 'New folder')"
			size="small"
			isForm
			@update:open="(open) => !open && (newFolderOpen = false)"
			@submit="confirmNewFolder">
			<NcTextField v-model="newFolderName" :label="t('talk_desktop', 'Folder name')" required />
			<template #actions>
				<NcButton variant="tertiary" @click="newFolderOpen = false">
					{{ t('talk_desktop', 'Cancel') }}
				</NcButton>
				<NcButton variant="primary" type="submit" :disabled="!newFolderName.trim() || newFolderName.includes('/')">
					{{ t('talk_desktop', 'Create') }}
				</NcButton>
			</template>
		</NcDialog>

		<ConversationPicker
			v-if="shareRow"
			:name="t('talk_desktop', 'Share {file} in a chat', { file: shareRow.name })"
			:confirmLabel="t('talk_desktop', 'Share')"
			@close="shareRow = null"
			@pick="share" />
	</div>
</template>

<style scoped>
.files-app {
	display: flex;
	flex: 1 1 auto;
	min-width: 0;
}

.files-app__nav {
	margin: 0;
	padding: 0;
}

.files-app__title {
	flex: 1 1 auto;
	margin: 0;
	font-size: 18px;
	font-weight: 700;
}

.files-app__breadcrumbs {
	display: flex;
	flex: 1 1 auto;
	flex-wrap: wrap;
	align-items: center;
	gap: 2px;
	min-width: 0;
}

.files-app__crumb {
	min-height: 0;
	height: 32px;
	margin: 0;
	padding: 0 6px;
	border: none;
	border-radius: var(--border-radius-element);
	background: none;
	color: var(--teamslogic-foreground-2);
	font-size: 16px;
	font-weight: 400;
	cursor: pointer;

	&:hover {
		background-color: var(--color-background-hover);
	}
}

.files-app__crumb--current {
	color: var(--teamslogic-foreground-1);
	font-size: 18px;
	font-weight: 700;
}

.files-app__crumb-separator {
	color: var(--teamslogic-foreground-3);
}

.files-app__content {
	min-height: 100%;
	padding: 8px 20px 20px;
}

.files-app__content--dragging {
	outline: 2px dashed var(--teamslogic-brand-foreground);
	outline-offset: -8px;
	background-color: var(--teamslogic-brand-tint);
}

.files-app__upload {
	display: grid;
	grid-template-columns: 1fr 200px;
	align-items: center;
	gap: 12px;
	margin-block-end: 8px;
	padding: 8px 12px;
	border-radius: var(--border-radius-element);
	background-color: var(--teamslogic-surface);
	box-shadow: var(--teamslogic-shadow-2);
	font-size: 12px;
}

.files-app__empty {
	margin-block-start: 12vh;
}

.files-app__table {
	width: 100%;
	border-collapse: collapse;
	table-layout: fixed;

	th {
		padding: 0;
		border-block-end: 1px solid var(--teamslogic-stroke);
		color: var(--teamslogic-foreground-3);
		font-size: 12px;
		font-weight: 400;
		text-align: start;

		button {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			min-height: 0;
			height: 36px;
			margin: 0;
			padding: 0 8px;
			border: none;
			background: none;
			color: inherit;
			font: inherit;
			cursor: pointer;

			&:hover {
				color: var(--teamslogic-foreground-1);
			}
		}
	}

	td {
		overflow: hidden;
		padding: 0 8px;
		border-block-end: 1px solid var(--teamslogic-stroke);
		color: var(--teamslogic-foreground-2);
		font-size: 13px;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
}

.files-app__sort--up {
	transform: rotate(180deg);
}

.files-app__col-modified {
	width: 140px;
}

.files-app__col-owner {
	width: 180px;
}

.files-app__col-size {
	width: 100px;
}

.files-app__col-actions {
	width: 52px;
}

.files-app__row {
	height: 44px;
	cursor: default;

	&:hover td {
		background-color: var(--teamslogic-surface);
	}

	.files-app__col-actions :deep(.action-item) {
		visibility: hidden;
	}

	&:hover .files-app__col-actions :deep(.action-item),
	&:focus-within .files-app__col-actions :deep(.action-item),
	.files-app__col-actions :deep(.action-item--open) {
		visibility: visible;
	}
}

.files-app__row--selected td {
	background-color: var(--teamslogic-brand-tint) !important;
}

.files-app__name {
	display: flex;
	align-items: center;
	gap: 12px;
	min-width: 0;
}

.files-app__icon {
	flex: 0 0 auto;
	width: 28px;
	height: 28px;
	object-fit: contain;
	border-radius: 2px;
}

.files-app__name-link {
	overflow: hidden;
	min-height: 0;
	margin: 0;
	padding: 0;
	border: none;
	background: none;
	color: var(--teamslogic-foreground-1);
	font-size: 14px;
	font-weight: 400;
	text-align: start;
	white-space: nowrap;
	text-overflow: ellipsis;
	cursor: pointer;

	&:hover {
		color: var(--teamslogic-brand-foreground);
		text-decoration: underline;
	}
}

.files-app__favorite {
	flex: 0 0 auto;
	color: #EAA300;
}
</style>
