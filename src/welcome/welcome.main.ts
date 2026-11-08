/*!
 * SPDX-FileCopyrightText: 2023 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { t } from '@nextcloud/l10n'
import { appData } from '../app/AppData.js'
import { refetchAppData } from '../app/appData.service.js'
import { getAppConfigValue, initAppConfig, setAppConfigValue } from '../shared/appConfig.service.ts'
import { initGlobals } from '../shared/globals/globals.js'
import { applyAxiosInterceptors } from '../shared/setupWebPage.js'

import '@global-styles/dist/icons.css'

const quitButton = document.querySelector<HTMLButtonElement>('.quit')!
quitButton.addEventListener('click', () => window.TALK_DESKTOP.quit())

if (__CHANNEL__ !== 'stable') {
	document.querySelector<HTMLDivElement>('.footer')!.textContent = __VERSION_TAG__
}

window.systemInfo = await window.TALK_DESKTOP.getSystemInfo()

quitButton.classList.remove('hidden')
if (window.systemInfo.isMac) {
	quitButton.classList.add('quit_mac')
}

appData.restore()

initGlobals()
applyAxiosInterceptors()

/**
 * TeamsLogic: re-fetch appData until the server answers. Upstream retries silently forever, so a
 * server that is down leaves the user on this screen with no clue. After a failed attempt (or
 * 6 seconds without an answer) this says which server isn't answering, counts down to the next
 * attempt, and offers Try again and Change server. Change server signs out, so the sign-in
 * window opens with the server address to edit.
 */
async function connectToServer() {
	const wrapper = document.querySelector<HTMLDivElement>('.wrapper')!
	const problem = document.querySelector<HTMLDivElement>('.problem')!
	const title = problem.querySelector<HTMLParagraphElement>('.problem__title')!
	const text = problem.querySelector<HTMLParagraphElement>('.problem__text')!
	const retry = problem.querySelector<HTMLParagraphElement>('.problem__retry')!
	const tryAgainButton = problem.querySelector<HTMLButtonElement>('.problem__try-again')!
	const changeServerButton = problem.querySelector<HTMLButtonElement>('.problem__change-server')!
	// @ts-expect-error - appData is not typed yet
	const server = (appData.serverUrl as string).replace(/^https?:\/\//, '')

	tryAgainButton.textContent = t('talk_desktop', 'Try again')
	changeServerButton.textContent = t('talk_desktop', 'Change server')

	let choose: (choice: 'retry' | 'change') => void = () => {}
	tryAgainButton.addEventListener('click', () => choose('retry'))
	changeServerButton.addEventListener('click', () => choose('change'))

	const showProblem = (titleText: string, message: string) => {
		title.textContent = titleText
		text.textContent = message
		problem.classList.remove('hidden')
		wrapper.classList.add('wrapper_problem')
	}

	const slowTimer = setTimeout(() => {
		showProblem(t('talk_desktop', 'Connecting to {server} …', { server }), t('talk_desktop', 'The server is taking a long time to answer.'))
		retry.textContent = ''
	}, 6_000)

	let delay = 5_000
	try {
		for (;;) {
			// Change server also works while an attempt is still waiting for an answer
			tryAgainButton.disabled = true
			const changeChosen = new Promise<'change'>((resolve) => {
				choose = (choice) => choice === 'change' && resolve('change')
			})
			const result = await Promise.race([
				refetchAppData(appData, true).then(() => 'connected' as const, (error) => error as { response?: { status?: number } }),
				changeChosen,
			])
			if (result === 'connected') {
				return
			}
			if (result === 'change') {
				appData.reset().persist()
				return
			}
			const status = result.response?.status
			if (status === 401) {
				// The saved sign-in is no longer valid: sign in again
				appData.reset().persist()
				return
			}
			clearTimeout(slowTimer)
			showProblem(
				t('talk_desktop', 'Can\'t connect to {server}', { server }),
				status
					? t('talk_desktop', 'The server answered with an error ({status}). It may be under maintenance.', { status })
					: t('talk_desktop', 'The server isn\'t answering. Check your internet connection, or ask your administrator whether the server is running.'),
			)

			tryAgainButton.disabled = false
			const choice = await new Promise<'retry' | 'change'>((resolve) => {
				let seconds = Math.round(delay / 1000)
				const tick = () => {
					retry.textContent = t('talk_desktop', 'Trying again in {seconds} s', { seconds })
					seconds -= 1
				}
				tick()
				const interval = setInterval(() => (seconds > 0 ? tick() : choose('retry')), 1_000)
				choose = (choice) => {
					clearInterval(interval)
					resolve(choice)
				}
			})
			choose = () => {}

			if (choice === 'change') {
				appData.reset().persist()
				return
			}
			retry.textContent = t('talk_desktop', 'Connecting …')
			delay = Math.min(delay * 2, 60_000)
		}
	} finally {
		clearTimeout(slowTimer)
	}
}

if (appData.credentials) {
	await window.TALK_DESKTOP.enableWebRequestInterceptor(appData.serverUrl, { credentials: appData.credentials })
	await connectToServer()
}

if (appData.credentials) {
	// Init accounts in case this is the first run with the new config
	// TODO: replace with a proper migration when the migration system supports it
	await initAppConfig()
	const accounts = getAppConfigValue('accounts')
	if (!accounts?.length) {
		// @ts-expect-error - appData is not typed yet
		await setAppConfigValue('accounts', [`${appData.credentials.user}@${appData.serverUrl.replace(/^https?:\/\//, '')}`])
	}
}

window.TALK_DESKTOP.sendAppData(appData.toJSON())
