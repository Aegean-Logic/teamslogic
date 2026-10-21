/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getCanonicalLocale, t } from '@nextcloud/l10n'

const locale = getCanonicalLocale()

/**
 * Read a value saved in localStorage, which may be unavailable
 *
 * @param key - Storage key
 * @param fallback - Value when nothing is stored
 */
export function readStored<T>(key: string, fallback: T): T {
	try {
		const value = localStorage.getItem(key)
		return value === null ? fallback : JSON.parse(value) as T
	} catch {
		return fallback
	}
}

/**
 * Save a value in localStorage, if available
 *
 * @param key - Storage key
 * @param value - Value
 */
export function writeStored(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value))
	} catch {
		// Only a convenience
	}
}

/**
 * Format a time like Teams lists do: the time today, "Yesterday", the weekday this week, else the date
 *
 * @param date - Date
 */
export function formatListTime(date: Date): string {
	const now = new Date()
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	const days = Math.floor((startOfToday.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000)

	if (days <= 0) {
		return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
	}
	if (days === 1) {
		return t('talk_desktop', 'Yesterday')
	}
	if (days < 7) {
		return date.toLocaleDateString(locale, { weekday: 'short' })
	}
	return date.toLocaleDateString(locale, { day: 'numeric', month: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : '2-digit' })
}

/**
 * Format a date and time in full
 *
 * @param date - Date
 */
export function formatDateTime(date: Date): string {
	return date.toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

/**
 * Format a time of day
 *
 * @param date - Date
 */
export function formatTime(date: Date): string {
	return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

/**
 * Format a file size
 *
 * @param bytes - Size in bytes
 */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) {
		return t('talk_desktop', '{size} B', { size: bytes })
	}
	const units = ['KB', 'MB', 'GB', 'TB']
	let size = bytes / 1024
	let unit = 0
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024
		unit++
	}
	return `${size.toLocaleString(locale, { maximumFractionDigits: size < 10 ? 1 : 0 })} ${units[unit]}`
}

/**
 * Open a link on the server in the web browser
 *
 * @param url - URL
 */
export function openInBrowser(url: string) {
	window.open(url, '_blank')
}
