<!--
  - SPDX-FileCopyrightText: 2026 Aegean Logic
  - SPDX-License-Identifier: AGPL-3.0-or-later
  -->

<script setup lang="ts">
import type { Task, TaskChanges, TaskList } from './todo.service.ts'

import { showError } from '@nextcloud/dialogs'
import { getCanonicalLocale, t } from '@nextcloud/l10n'
import { computed, onMounted, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDateTimePickerNative from '@nextcloud/vue/components/NcDateTimePickerNative'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import FluentIcon from '../../AppRail/FluentIcon.vue'
import AppListItem from '../components/AppListItem.vue'
import AppPane from '../components/AppPane.vue'
import AppStage from '../components/AppStage.vue'
import { readStored, writeStored } from '../apps.utils.ts'
import { useAppShown } from '../useAppShown.ts'
import { createTask, createTaskList, deleteTask, loadTasks, updateTask } from './todo.service.ts'

/** Microsoft To Do's smart lists, then the user's own lists by URL */
type View = 'important' | 'planned' | 'all' | string

const locale = getCanonicalLocale()

const lists = ref<TaskList[]>([])
const tasks = ref<Task[]>([])
const loading = ref(true)
const error = ref('')
const view = ref<View>(readStored<View>('teamslogic:todo:view', 'all'))
const newTitle = ref('')
const selectedId = ref<string | null>(null)
const showCompleted = ref(false)
const newListName = ref<string | null>(null)
const confirmDelete = ref(false)

watch(view, (value) => {
	writeStored('teamslogic:todo:view', value)
	selectedId.value = null
})

const SMART_VIEWS: { id: View, icon: 'star' | 'calendar' | 'taskList', label: string }[] = [
	{ id: 'important', icon: 'star', label: t('talk_desktop', 'Important') },
	{ id: 'planned', icon: 'calendar', label: t('talk_desktop', 'Planned') },
	{ id: 'all', icon: 'taskList', label: t('talk_desktop', 'All tasks') },
]

const currentList = computed(() => lists.value.find((list) => list.url === view.value) ?? null)
const viewTitle = computed(() => currentList.value?.name ?? SMART_VIEWS.find((smart) => smart.id === view.value)?.label ?? '')

/** Where a task typed in a smart view goes: the list last added to, else the first one that takes tasks */
const lastListUrl = ref<string | null>(readStored<string | null>('teamslogic:todo:list', null))
const targetList = computed(() => {
	if (currentList.value) {
		return currentList.value.writable ? currentList.value : null
	}
	const writable = lists.value.filter((list) => list.writable)
	return writable.find((list) => list.url === lastListUrl.value) ?? writable[0] ?? null
})

const inView = computed(() => tasks.value.filter((task) => {
	switch (view.value) {
		case 'important':
			return task.important
		case 'planned':
			return task.due !== null
		case 'all':
			return true
		default:
			return task.list.url === view.value
	}
}))

const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
/** Open tasks: by due day (none last), then title */
const openTasks = computed(() => inView.value.filter((task) => !task.done).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || collator.compare(a.title, b.title)))
/** Done tasks: most recently done first */
const doneTasks = computed(() => inView.value.filter((task) => task.done).sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)))

const openCount = (filter: (task: Task) => boolean) => tasks.value.filter((task) => !task.done && filter(task)).length

const selected = computed(() => tasks.value.find((task) => task.id === selectedId.value) ?? null)

/**
 * Load the lists and tasks
 */
async function refresh() {
	try {
		const result = await loadTasks()
		lists.value = result.lists
		tasks.value = result.tasks
		error.value = ''
		if (!['important', 'planned', 'all'].includes(view.value) && !result.lists.some((list) => list.url === view.value)) {
			view.value = 'all'
		}
	} catch (exception) {
		console.error('Could not load the tasks', exception)
		error.value = t('talk_desktop', 'Your tasks could not be loaded.')
	} finally {
		loading.value = false
	}
}

/**
 * Run a change and reload, or say it failed
 *
 * @param change - The change
 * @param failure - What to say if it fails
 */
async function change(change: () => Promise<void>, failure: string) {
	try {
		await change()
	} catch (exception) {
		console.error(failure, exception)
		showError(failure)
	}
	await refresh()
}

/**
 * Add the typed task, to the open list (or the list last added to), planned or important as the view is
 */
async function addTask() {
	const title = newTitle.value.trim()
	const list = targetList.value
	if (!title || !list) {
		return
	}
	newTitle.value = ''
	const today = new Date()
	const changes: TaskChanges = { title }
	if (view.value === 'important') {
		changes.important = true
	}
	if (view.value === 'planned') {
		changes.due = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
	}
	lastListUrl.value = list.url
	writeStored('teamslogic:todo:list', list.url)
	await change(() => createTask(list.url, changes), t('talk_desktop', 'The task could not be added.'))
}

/**
 * Change a task in place
 *
 * @param task - The task
 * @param changes - What changes
 */
async function edit(task: Task, changes: TaskChanges) {
	// Show it at once; the reload brings the saved version
	Object.assign(task, changes)
	await change(() => updateTask(task, changes), t('talk_desktop', 'The task could not be saved.'))
}

/**
 * Save the title or notes of the selected task when the field is left
 *
 * @param field - Which field
 * @param event - The field's change event
 */
function saveField(field: 'title' | 'notes', event: Event) {
	const task = selected.value
	const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value
	if (task && value !== task[field]) {
		edit(task, { [field]: value })
	}
}

/**
 * Delete the selected task, once confirmed
 */
async function remove() {
	const task = selected.value
	confirmDelete.value = false
	if (task) {
		selectedId.value = null
		await change(() => deleteTask(task), t('talk_desktop', 'The task could not be deleted.'))
	}
}

/**
 * Make the new list and open it
 */
async function addList() {
	const name = newListName.value?.trim()
	newListName.value = null
	if (!name) {
		return
	}
	try {
		const url = await createTaskList(name)
		await refresh()
		view.value = url
	} catch (exception) {
		console.error('Could not create the list', exception)
		showError(t('talk_desktop', 'The list could not be created.'))
	}
}

/**
 * A due day as To Do shows it: Today, Tomorrow, or the date
 *
 * @param due - YYYY-MM-DD
 */
function formatDue(due: string) {
	const [year, month, day] = due.split('-').map(Number)
	const date = new Date(year!, month! - 1, day!)
	const today = new Date()
	today.setHours(0, 0, 0, 0)
	const days = Math.round((date.getTime() - today.getTime()) / 86400000)
	if (days === 0) {
		return t('talk_desktop', 'Today')
	}
	if (days === 1) {
		return t('talk_desktop', 'Tomorrow')
	}
	if (days === -1) {
		return t('talk_desktop', 'Yesterday')
	}
	return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
}

/**
 * Whether a due day has passed
 *
 * @param due - YYYY-MM-DD
 */
function isOverdue(due: string) {
	const today = new Date()
	return due < `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

/**
 * The due day as a Date for the date field
 *
 * @param due - YYYY-MM-DD
 */
function dueAsDate(due: string | null) {
	if (!due) {
		return null
	}
	const [year, month, day] = due.split('-').map(Number)
	return new Date(year!, month! - 1, day!)
}

/**
 * The date field's value as a due day
 *
 * @param value - The date, or null when cleared
 */
function dateAsDue(value: Date | null) {
	if (!value || Number.isNaN(value.getTime())) {
		return null
	}
	return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

onMounted(refresh)
// Tasks change elsewhere too (To Do, Google Tasks, the Tasks app, a phone)
useAppShown('todo', refresh)
</script>

<template>
	<div class="todo-app">
		<AppPane :title="t('talk_desktop', 'To Do')">
			<template #actions>
				<NcButton
					variant="tertiary"
					:aria-label="t('talk_desktop', 'New list')"
					:title="t('talk_desktop', 'New list')"
					@click="newListName = ''">
					<template #icon>
						<FluentIcon name="add" :size="20" />
					</template>
				</NcButton>
			</template>

			<ul class="todo-app__views">
				<AppListItem
					v-for="smart in SMART_VIEWS"
					:key="smart.id"
					:active="view === smart.id"
					@click="view = smart.id">
					<template #icon>
						<FluentIcon :name="smart.icon" :size="20" />
					</template>
					<template #title>
						{{ smart.label }}
					</template>
					<template #details>
						{{ openCount(smart.id === 'important' ? (task) => task.important : smart.id === 'planned' ? (task) => task.due !== null : () => true) || '' }}
					</template>
				</AppListItem>
			</ul>
			<h3 v-if="lists.length" class="todo-app__section">
				{{ t('talk_desktop', 'Lists') }}
			</h3>
			<ul class="todo-app__views">
				<AppListItem
					v-for="list in lists"
					:key="list.url"
					:active="view === list.url"
					@click="view = list.url">
					<template #icon>
						<span class="todo-app__dot" :style="{ backgroundColor: list.color }" />
					</template>
					<template #title>
						{{ list.name }}
					</template>
					<template #details>
						{{ openCount((task) => task.list.url === list.url) || '' }}
					</template>
				</AppListItem>
			</ul>
		</AppPane>

		<AppStage :title="viewTitle">
			<div class="todo-app__body">
				<div class="todo-app__main">
					<form v-if="targetList" class="todo-app__add" @submit.prevent="addTask">
						<NcTextField
							v-model="newTitle"
							:label="t('talk_desktop', 'Add a task')"
							:placeholder="currentList ? '' : t('talk_desktop', 'Goes to {list}', { list: targetList.name })">
							<template #icon>
								<FluentIcon name="add" :size="16" />
							</template>
						</NcTextField>
					</form>
					<p v-else-if="currentList && !currentList.writable" class="todo-app__muted">
						{{ t('talk_desktop', 'This list is read only.') }}
					</p>

					<NcLoadingIcon v-if="loading" :size="32" class="todo-app__loading" />
					<NcEmptyContent v-else-if="error" :name="error">
						<template #icon>
							<FluentIcon name="taskList" :size="48" />
						</template>
					</NcEmptyContent>
					<template v-else>
						<ul class="todo-app__tasks">
							<li
								v-for="task in openTasks"
								:key="task.id"
								class="todo-app__task"
								:class="{ 'todo-app__task--active': task.id === selectedId }"
								@click="selectedId = task.id">
								<button
									class="todo-app__check"
									:aria-label="t('talk_desktop', 'Mark as done')"
									:title="t('talk_desktop', 'Mark as done')"
									:disabled="!task.list.writable"
									@click.stop="edit(task, { done: true })">
									<FluentIcon name="checkmark" :size="14" />
								</button>
								<span class="todo-app__task-main">
									<span class="todo-app__title">{{ task.title || t('talk_desktop', 'Untitled task') }}</span>
									<span class="todo-app__meta">
										<span v-if="task.due" :class="{ 'todo-app__overdue': isOverdue(task.due) }">
											<FluentIcon name="calendar" :size="12" /> {{ formatDue(task.due) }}
										</span>
										<span v-if="!currentList">{{ task.list.name }}</span>
									</span>
								</span>
								<button
									class="todo-app__star"
									:class="{ 'todo-app__star--on': task.important }"
									:aria-label="task.important ? t('talk_desktop', 'Remove importance') : t('talk_desktop', 'Mark as important')"
									:aria-pressed="task.important"
									:disabled="!task.list.writable"
									@click.stop="edit(task, { important: !task.important })">
									<FluentIcon name="star" :size="18" :filled="task.important" />
								</button>
							</li>
						</ul>
						<p v-if="!openTasks.length && !doneTasks.length" class="todo-app__muted">
							{{ t('talk_desktop', 'No tasks here yet.') }}
						</p>

						<button v-if="doneTasks.length" class="todo-app__done-toggle" @click="showCompleted = !showCompleted">
							<FluentIcon :name="showCompleted ? 'chevronDown' : 'chevronRight'" :size="16" />
							{{ t('talk_desktop', 'Completed') }} {{ doneTasks.length }}
						</button>
						<ul v-if="showCompleted" class="todo-app__tasks">
							<li
								v-for="task in doneTasks"
								:key="task.id"
								class="todo-app__task todo-app__task--done"
								:class="{ 'todo-app__task--active': task.id === selectedId }"
								@click="selectedId = task.id">
								<button
									class="todo-app__check todo-app__check--on"
									:aria-label="t('talk_desktop', 'Mark as not done')"
									:title="t('talk_desktop', 'Mark as not done')"
									:disabled="!task.list.writable"
									@click.stop="edit(task, { done: false })">
									<FluentIcon name="checkmark" :size="14" />
								</button>
								<span class="todo-app__task-main">
									<span class="todo-app__title">{{ task.title || t('talk_desktop', 'Untitled task') }}</span>
									<span v-if="!currentList" class="todo-app__meta">{{ task.list.name }}</span>
								</span>
							</li>
						</ul>
					</template>
				</div>

				<aside v-if="selected" :key="selected.id" class="todo-app__details">
					<header class="todo-app__details-header">
						<NcTextField
							:modelValue="selected.title"
							:label="t('talk_desktop', 'Title')"
							:disabled="!selected.list.writable"
							@change="saveField('title', $event)" />
						<NcButton variant="tertiary" :aria-label="t('talk_desktop', 'Close')" @click="selectedId = null">
							<template #icon>
								<FluentIcon name="dismiss" :size="20" />
							</template>
						</NcButton>
					</header>
					<NcButton
						:variant="selected.done ? 'secondary' : 'primary'"
						:disabled="!selected.list.writable"
						@click="edit(selected, { done: !selected.done })">
						<template #icon>
							<FluentIcon name="checkmark" :size="20" />
						</template>
						{{ selected.done ? t('talk_desktop', 'Mark as not done') : t('talk_desktop', 'Mark as done') }}
					</NcButton>
					<NcButton
						variant="secondary"
						:disabled="!selected.list.writable"
						:aria-pressed="selected.important"
						@click="edit(selected, { important: !selected.important })">
						<template #icon>
							<FluentIcon name="star" :size="20" :filled="selected.important" />
						</template>
						{{ selected.important ? t('talk_desktop', 'Important') : t('talk_desktop', 'Mark as important') }}
					</NcButton>
					<NcDateTimePickerNative
						:modelValue="dueAsDate(selected.due)"
						type="date"
						:label="t('talk_desktop', 'Due')"
						:disabled="!selected.list.writable"
						@update:modelValue="(value) => edit(selected!, { due: dateAsDue(value) })" />
					<NcTextArea
						:modelValue="selected.notes"
						:label="t('talk_desktop', 'Notes')"
						resize="vertical"
						:disabled="!selected.list.writable"
						@change="saveField('notes', $event)" />
					<p class="todo-app__muted">
						<span class="todo-app__dot" :style="{ backgroundColor: selected.list.color }" />
						{{ selected.list.name }}
						<template v-if="selected.list.connectionId !== null">
							· {{ t('talk_desktop', 'syncs with your connected account') }}
						</template>
					</p>
					<p v-if="selected.createdAt" class="todo-app__muted">
						{{ t('talk_desktop', 'Created {date}', { date: selected.createdAt.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) }) }}
					</p>
					<NcButton v-if="selected.list.writable" variant="error" @click="confirmDelete = true">
						<template #icon>
							<FluentIcon name="trash" :size="20" />
						</template>
						{{ t('talk_desktop', 'Delete task') }}
					</NcButton>
				</aside>
			</div>
		</AppStage>

		<NcDialog
			v-if="newListName !== null"
			:name="t('talk_desktop', 'New list')"
			isForm
			:buttons="[
				{ label: t('talk_desktop', 'Cancel'), callback: () => { newListName = null } },
				{ label: t('talk_desktop', 'Create'), variant: 'primary', type: 'submit' },
			]"
			@submit="addList"
			@update:open="(open) => !open && (newListName = null)">
			<NcTextField v-model="newListName" :label="t('talk_desktop', 'List name')" />
			<p class="todo-app__muted">
				{{ t('talk_desktop', 'A new list is kept in Nextcloud; lists from To Do or Google Tasks are made there.') }}
			</p>
		</NcDialog>

		<NcDialog
			v-if="confirmDelete && selected"
			:name="t('talk_desktop', 'Delete task')"
			:message="t('talk_desktop', 'Delete “{title}”?', { title: selected.title })"
			:buttons="[
				{ label: t('talk_desktop', 'Cancel'), callback: () => { confirmDelete = false } },
				{ label: t('talk_desktop', 'Delete'), variant: 'error', callback: remove },
			]"
			@update:open="(open) => !open && (confirmDelete = false)" />
	</div>
</template>

<style scoped>
.todo-app {
	display: flex;
	flex: 1 1 auto;
	min-width: 0;
}

.todo-app__views {
	margin: 0;
	padding: 0;
}

.todo-app__section {
	margin: 12px 8px 4px;
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
	font-weight: 600;
}

.todo-app__dot {
	display: inline-block;
	width: 12px;
	height: 12px;
	border-radius: 50%;
}

.todo-app__body {
	display: flex;
	min-height: 100%;
}

.todo-app__main {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
	padding: 16px 20px;
}

.todo-app__loading {
	margin-block-start: 24px;
}

.todo-app__tasks {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.todo-app__task {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 52px;
	padding: 6px 12px;
	border-radius: var(--border-radius-large);
	background-color: var(--teamslogic-surface);
	box-shadow: var(--teamslogic-shadow-2);
	cursor: pointer;

	&:hover {
		background-color: var(--teamslogic-surface-hover, var(--color-background-hover));
	}
}

.todo-app__task--active {
	outline: 2px solid var(--color-primary-element);
}

.todo-app__task-main {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	min-width: 0;
}

.todo-app__title {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.todo-app__task--done .todo-app__title {
	color: var(--teamslogic-foreground-3);
	text-decoration: line-through;
}

.todo-app__meta {
	display: flex;
	gap: 8px;
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}

.todo-app__overdue {
	color: var(--color-error-text, var(--color-error));
}

/* To Do's round tick box: empty, with the tick on hover, filled when done */
.todo-app__check {
	display: flex;
	flex: 0 0 auto;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	margin: 0;
	padding: 0;
	border: 2px solid var(--color-primary-element);
	border-radius: 50%;
	background: transparent;
	color: transparent;
	cursor: pointer;

	&:hover:not(:disabled) {
		color: var(--color-primary-element);
	}
}

.todo-app__check--on {
	background-color: var(--color-primary-element);
	color: var(--color-primary-element-text);

	&:hover:not(:disabled) {
		color: var(--color-primary-element-text);
	}
}

.todo-app__star {
	display: flex;
	flex: 0 0 auto;
	margin: 0;
	padding: 4px;
	border: none;
	background: transparent;
	color: var(--teamslogic-foreground-3);
	cursor: pointer;
}

.todo-app__star--on {
	color: var(--color-primary-element);
}

.todo-app__done-toggle {
	display: flex;
	align-self: flex-start;
	align-items: center;
	gap: 4px;
	margin: 8px 0 0;
	padding: 4px 8px;
	border: none;
	border-radius: var(--border-radius);
	background: transparent;
	color: var(--teamslogic-foreground-1);
	font-weight: 600;
	cursor: pointer;
}

.todo-app__details {
	display: flex;
	flex: 0 0 340px;
	flex-direction: column;
	gap: 12px;
	padding: 16px 20px;
	border-inline-start: 1px solid var(--teamslogic-stroke);
	background-color: var(--teamslogic-surface);

	> .button-vue {
		align-self: flex-start;
	}
}

.todo-app__details-header {
	display: flex;
	align-items: flex-end;
	gap: 8px;
}

.todo-app__muted {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0;
	color: var(--teamslogic-foreground-3);
	font-size: 12px;
}
</style>
