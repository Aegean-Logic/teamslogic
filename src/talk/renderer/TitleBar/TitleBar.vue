<!--
  - SPDX-FileCopyrightText: 2022 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import FluentIcon from '../AppRail/FluentIcon.vue'
import DevMenu from './components/DevMenu.vue'
import MainMenu from './components/MainMenu.vue'
import TitleBarSearch from './components/TitleBarSearch.vue'
import UserMenu from './components/UserMenu.vue'
import { useDevMode } from '../../../shared/useDevMode.ts'
import { useAppConfigStore } from '../Settings/appConfig.store.ts'
import { useHeartbeat } from '../UserStatus/useHeartbeat.ts'
import { useUserStatusStore } from '../UserStatus/userStatus.store.ts'

useUserStatusStore()
useHeartbeat()
useAppConfigStore()

const channel = __CHANNEL__

const OS = window.systemInfo

const { isDevMode } = useDevMode()

// Talk routes with the history, so these step through the opened conversations like in Teams
const goBack = () => window.history.back()
const goForward = () => window.history.forward()
</script>

<template>
	<header class="title-bar" :class="{ 'title-bar--mac': OS.isMac }">
		<div class="title-bar__inner">
			<div class="title-bar__start">
				<button class="title-bar__nav-button" :title="t('talk_desktop', 'Back')" @click="goBack">
					<FluentIcon name="arrowLeft" :size="20" />
				</button>
				<button class="title-bar__nav-button" :title="t('talk_desktop', 'Forward')" @click="goForward">
					<FluentIcon name="arrowRight" :size="20" />
				</button>

				<div v-if="channel !== 'stable'" class="title-bar__channel">
					{{ channel }}
				</div>
			</div>

			<TitleBarSearch class="title-bar__search" />

			<div class="title-bar__end">
				<div v-if="isDevMode" class="title-bar__item">
					<DevMenu />
				</div>

				<div class="title-bar__item title-bar__main-menu-container">
					<MainMenu />
				</div>

				<div class="title-bar__item">
					<UserMenu />
				</div>
			</div>
		</div>
	</header>
</template>

<style scoped>
.title-bar {
	display: flex;
	height: var(--header-height);
	margin-bottom: calc(-1 * var(--header-height));
	box-sizing: border-box;
	background-color: var(--teamslogic-chrome);
	color: var(--teamslogic-foreground-1);
	user-select: none;
}

.title-bar__inner {
	flex: 1;
	display: grid;
	/* Teams centres the search box between the app rail edge and the window controls */
	grid-template-columns: 1fr minmax(0, 680px) 1fr;
	align-items: center;
	gap: 8px;
	height: 100%;
	/* Save space for native title bar buttons */
	/* Note: titlebar-area-x always represents left offset */
	/* Logical properties cannot be used here */
	margin-inline: env(titlebar-area-x, 0) auto;
	max-width: env(titlebar-area-width, 100%);
	padding-inline: calc((var(--teamslogic-rail-width) - 32px) / 2) 4px;
	-webkit-app-region: drag;
}

.title-bar--mac .title-bar__inner {
	/* Room for the traffic lights */
	padding-inline-start: 80px;
}

.title-bar__start,
.title-bar__end {
	display: flex;
	align-items: center;
	gap: 4px;
	min-width: 0;
}

.title-bar__end {
	justify-content: flex-end;
}

.title-bar__start > *,
.title-bar__end > * {
	-webkit-app-region: no-drag;
}

.title-bar__nav-button {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	min-height: 0;
	margin: 0;
	padding: 0;
	border: none;
	border-radius: 4px;
	background: none;
	color: var(--teamslogic-foreground-2);
	cursor: pointer;

	&:hover {
		background-color: var(--teamslogic-chrome-hover);
		color: var(--teamslogic-brand-foreground);
	}
}

.title-bar__item {
	width: var(--header-height); /* Make it square */
	display: flex;
	justify-content: center;
}

.title-bar__channel {
	margin-inline-start: 8px;
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
	text-transform: capitalize;
	-webkit-app-region: drag;
}

.title-bar__main-menu-container {
	/* Increase the trigger button size to fill the title bar except for 4px paddings */
	/* Aligns NcAction's popover with the title bar with 4px distance */
	/* TODO: instead, either add distance prop to NcActions or decrease the title bar size to 34px + 4px * 2 */
	--default-clickable-area: 40px;
}
</style>
