/*
 * SPDX-FileCopyrightText: 2026 Aegean Logic
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/*
 * Calling and chatting with a contact. Contacts aren't Nextcloud users, so Talk invites them as guests by email:
 * they get a link to join. A contact with only a phone number is handed to the computer's own dialler (tel:),
 * as Talk has no phone dial-out without a SIP bridge.
 */

import type { Contact } from './people.service.ts'

import { t } from '@nextcloud/l10n'
import { useShellStore } from '../../AppRail/shell.store.ts'
import { CONVERSATION_TYPE, createConversation } from '../talk.api.ts'

/**
 * Whether a contact can be called or messaged at all
 *
 * @param contact - The contact
 */
export function canReach(contact: Contact): { call: boolean, chat: boolean } {
	return { call: contact.emails.length > 0 || contact.phones.length > 0, chat: contact.emails.length > 0 }
}

/**
 * Start a Talk conversation with a contact, by email, and join its call or show its chat
 *
 * @param contact - The contact
 * @param call - Join the call (camera off, as from Calls), or only open the chat
 */
export async function talkWithContact(contact: Contact, call: boolean) {
	const email = contact.emails[0]?.value
	if (!email) {
		const phone = contact.phones[0]?.value
		if (call && phone) {
			window.open(`tel:${phone.replace(/[^\d+]/g, '')}`, '_blank', 'noopener')
		}
		return
	}
	const conversation = await createConversation({
		roomType: CONVERSATION_TYPE.GROUP,
		roomName: contact.displayName || email,
		participants: { emails: [email] },
	})
	await useShellStore().openChat(conversation.token, { directCall: call })
}

/**
 * What calling a contact does, for a hint
 *
 * @param contact - The contact
 */
export function callHint(contact: Contact): string {
	if (contact.emails.length) {
		return t('talk_desktop', '{email} gets an email with a link to join the call', { email: contact.emails[0]!.value })
	}
	return t('talk_desktop', 'Calls {phone} with your computer\'s phone app', { phone: contact.phones[0]?.value ?? '' })
}
