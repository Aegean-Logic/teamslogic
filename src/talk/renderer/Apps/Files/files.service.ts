/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Node } from '@nextcloud/files'
import type { FileStat, ResponseDataDetailed, SearchResult } from 'webdav'

import axios from '@nextcloud/axios'
import { defaultRemoteURL, defaultRootPath, getClient, getDefaultPropfind, getFavoriteNodes, getRecentSearch, resultToNode } from '@nextcloud/files/dav'
import { generateOcsUrl, generateUrl } from '@nextcloud/router'

export type FileRow = {
	id: number
	name: string
	/** Path in the user's files, e.g. /Documents/Budget.xlsx */
	path: string
	mime: string
	isFolder: boolean
	modified: Date
	size: number | null
	owner: string
	favorite: boolean
	etag: string
	hasPreview: boolean
}

const FOLDER_MIME = 'httpd/unix-directory'

// A client at the DAV root: SEARCH only works there, and the node parser expects full DAV paths
const client = getClient(defaultRemoteURL)

/**
 * DAV path of a path in the user's files
 *
 * @param path - e.g. /Documents
 */
const davPath = (path: string) => defaultRootPath + path

/**
 * Describe a file of a WebDAV result
 *
 * @param node - The node
 */
function nodeToRow(node: Node): FileRow {
	const attributes = node.attributes as Record<string, unknown>
	return {
		id: node.fileid ?? 0,
		name: node.displayname || node.basename,
		path: node.path,
		mime: node.type === 'folder' ? FOLDER_MIME : (node.mime || 'application/octet-stream'),
		isFolder: node.type === 'folder',
		modified: node.mtime ?? new Date(0),
		size: node.size ?? null,
		owner: String(attributes['owner-display-name'] ?? node.owner ?? ''),
		favorite: Number(attributes.favorite) === 1,
		etag: String(attributes.etag ?? ''),
		hasPreview: attributes['has-preview'] === true || attributes['has-preview'] === 'true',
	}
}

/**
 * List a folder of the user's files
 *
 * @param path - Folder path, e.g. / or /Documents
 */
export async function listFolder(path: string): Promise<FileRow[]> {
	const folder = davPath(path).replace(/\/$/, '')
	const response = await client.getDirectoryContents(folder, { details: true, data: getDefaultPropfind() }) as ResponseDataDetailed<FileStat[]>
	return response.data
		.filter((stat) => stat.filename.replace(/\/$/, '') !== folder)
		.map((stat) => nodeToRow(resultToNode(stat)))
}

/**
 * Files changed in the last two weeks, newest first
 */
export async function listRecent(): Promise<FileRow[]> {
	const since = Math.round(Date.now() / 1000) - 14 * 86400
	const response = await client.search('/', { details: true, data: getRecentSearch(since) }) as ResponseDataDetailed<SearchResult>
	return response.data.results
		.map((stat) => nodeToRow(resultToNode(stat)))
		.sort((a, b) => b.modified.getTime() - a.modified.getTime())
}

/**
 * The user's favourite files and folders
 */
export async function listFavorites(): Promise<FileRow[]> {
	const nodes = await getFavoriteNodes({ client })
	return nodes.map(nodeToRow)
}

/**
 * Files and folders others shared with the user
 */
export async function listSharedWithMe(): Promise<FileRow[]> {
	const response = await axios.get(generateOcsUrl('apps/files_sharing/api/v1/shares'), {
		params: { shared_with_me: true, include_tags: true },
	})
	const shares = response.data.ocs.data as {
		file_source: number
		file_target: string
		item_type: 'file' | 'folder'
		mimetype: string
		item_mtime?: number
		stime: number
		item_size?: number
		displayname_owner: string
		has_preview?: boolean
		tags?: string[]
	}[]
	// A file shared several times (to the user and to their groups) is listed once
	const unique = new Map(shares.map((share) => [share.file_source, share]))
	return [...unique.values()].map((share) => ({
		id: share.file_source,
		name: share.file_target.split('/').pop() || share.file_target,
		path: share.file_target,
		mime: share.item_type === 'folder' ? FOLDER_MIME : share.mimetype,
		isFolder: share.item_type === 'folder',
		modified: new Date((share.item_mtime ?? share.stime) * 1000),
		size: share.item_size ?? null,
		owner: share.displayname_owner,
		favorite: share.tags?.includes('_$!<Favorite>!$_') ?? false,
		etag: '',
		hasPreview: share.has_preview ?? false,
	})).sort((a, b) => b.modified.getTime() - a.modified.getTime())
}

/**
 * Create a folder
 *
 * @param path - Path of the new folder
 */
export async function createFolder(path: string) {
	await client.createDirectory(davPath(path))
}

/**
 * Upload a file into a folder, renamed like "name (2).ext" when the name is taken
 *
 * @param folder - Folder path
 * @param file - The file
 * @param onProgress - Progress callback, 0 to 1
 */
export async function uploadFile(folder: string, file: File, onProgress: (progress: number) => void) {
	const dot = file.name.lastIndexOf('.')
	const [stem, extension] = dot > 0 ? [file.name.slice(0, dot), file.name.slice(dot)] : [file.name, '']
	const base = folder.replace(/\/$/, '')
	const content = await file.arrayBuffer()

	for (let attempt = 1; attempt < 100; attempt++) {
		const name = attempt === 1 ? file.name : `${stem} (${attempt})${extension}`
		const written = await client.putFileContents(davPath(`${base}/${name}`), content, {
			overwrite: false,
			contentLength: file.size,
			onUploadProgress: ({ loaded, total }) => onProgress(total ? loaded / total : 0),
		})
		if (written) {
			return name
		}
	}
	throw new Error('No free file name')
}

/**
 * Add or remove a favourite
 *
 * @param path - File path
 * @param favorite - Whether it should be a favourite
 */
export async function setFavorite(path: string, favorite: boolean) {
	await client.customRequest(davPath(path), {
		method: 'PROPPATCH',
		headers: { 'Content-Type': 'application/xml' },
		data: `<?xml version="1.0"?><d:propertyupdate xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:set><d:prop><oc:favorite>${favorite ? 1 : 0}</oc:favorite></d:prop></d:set></d:propertyupdate>`,
	})
}

/**
 * Save a file to the computer (the app asks where)
 *
 * @param row - The file
 */
export async function downloadFile(row: FileRow) {
	const content = await client.getFileContents(davPath(row.path)) as ArrayBuffer
	const url = URL.createObjectURL(new Blob([content], { type: row.mime }))
	const link = document.createElement('a')
	link.href = url
	link.download = row.name
	link.click()
	setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/**
 * Share a file into a Talk conversation; it appears in the chat
 *
 * @param path - File path
 * @param token - Conversation token
 */
export async function shareToConversation(path: string, token: string) {
	// Share type 10 is a Talk room
	await axios.post(generateOcsUrl('apps/files_sharing/api/v1/shares'), { shareType: 10, shareWith: token, path })
}

/**
 * Link to a file in Nextcloud, where the Aegean Office apps open documents
 *
 * @param row - The file
 */
export function getWebLink(row: FileRow) {
	return generateUrl('/f/{id}', { id: row.id })
}

/**
 * Thumbnail or type icon of a file
 *
 * @param row - The file
 */
export function getIconUrl(row: FileRow) {
	if (row.hasPreview && !row.isFolder) {
		return generateUrl('/core/preview?fileId={id}&x=64&y=64&a=1&etag={etag}', { id: row.id, etag: row.etag })
	}
	return window.OC.MimeType.getIconUrl(row.mime)
}
