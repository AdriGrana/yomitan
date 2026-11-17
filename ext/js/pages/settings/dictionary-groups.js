/*
 * Copyright (C) 2026  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Dictionary groups are a purely organizational layer on top of the flat, ordered
 * `dictionaries` options array. The array order is still what determines lookup priority;
 * groups are kept as contiguous blocks inside that array, so moving a group moves the
 * priority of all of its dictionaries at once.
 *
 * The group named '' is the implicit "Ungrouped" group. It can be positioned like any
 * other group, but it can't be renamed or deleted.
 */

export const UNGROUPED_NAME = '';

export const UNGROUPED_LABEL = 'Ungrouped';

/**
 * Returns a normalized copy of the group list: no duplicate names, and (when there is at least
 * one user-defined group) an entry for the implicit ungrouped group.
 * @param {import('settings').DictionaryGroupOptions[]|undefined} groups
 * @returns {import('settings').DictionaryGroupOptions[]}
 */
export function normalizeDictionaryGroups(groups) {
    /** @type {import('settings').DictionaryGroupOptions[]} */
    const result = [];
    /** @type {Set<string>} */
    const names = new Set();
    let hasUserGroup = false;
    for (const {name, collapsed, enabled} of (Array.isArray(groups) ? groups : [])) {
        if (typeof name !== 'string' || names.has(name)) { continue; }
        names.add(name);
        if (name !== UNGROUPED_NAME) { hasUserGroup = true; }
        result.push({name, collapsed: collapsed === true, enabled: enabled !== false});
    }
    if (!hasUserGroup) { return []; }
    if (!names.has(UNGROUPED_NAME)) {
        result.push({name: UNGROUPED_NAME, collapsed: false, enabled: true});
    }
    return result;
}

/**
 * Sorts the dictionary options in place so that every group forms a contiguous block, in the
 * order given by `groups`. The relative order of dictionaries inside a group is preserved.
 * Dictionaries which refer to a group that doesn't exist become ungrouped.
 * @param {import('settings').DictionaryOptions[]} dictionaries
 * @param {import('settings').DictionaryGroupOptions[]|undefined} groups
 * @returns {boolean} `true` if anything was changed.
 */
export function sortDictionariesByGroup(dictionaries, groups) {
    const normalizedGroups = normalizeDictionaryGroups(groups);
    /** @type {Map<string, number>} */
    const groupIndices = new Map();
    for (let i = 0, ii = normalizedGroups.length; i < ii; ++i) {
        groupIndices.set(normalizedGroups[i].name, i);
    }
    const ungroupedIndex = groupIndices.get(UNGROUPED_NAME) ?? 0;

    let changed = false;
    /** @type {{dictionary: import('settings').DictionaryOptions, groupIndex: number, index: number}[]} */
    const items = [];
    for (let i = 0, ii = dictionaries.length; i < ii; ++i) {
        const dictionary = dictionaries[i];
        let groupIndex = (typeof dictionary.group === 'string' ? groupIndices.get(dictionary.group) : void 0);
        if (typeof groupIndex === 'undefined') {
            groupIndex = ungroupedIndex;
            if (dictionary.group !== UNGROUPED_NAME) {
                dictionary.group = UNGROUPED_NAME;
                changed = true;
            }
        }
        items.push({dictionary, groupIndex, index: i});
    }

    items.sort((a, b) => (a.groupIndex - b.groupIndex) || (a.index - b.index));
    for (let i = 0, ii = items.length; i < ii; ++i) {
        const {dictionary, index} = items[i];
        if (index !== i) { changed = true; }
        dictionaries[i] = dictionary;
    }
    return changed;
}

/**
 * Gets the index at which a new, ungrouped dictionary should be inserted so that the
 * ungrouped block stays contiguous (i.e. the end of the ungrouped block).
 * @param {import('settings').DictionaryOptions[]} dictionaries
 * @param {import('settings').DictionaryGroupOptions[]|undefined} groups
 * @returns {number}
 */
export function getUngroupedInsertIndex(dictionaries, groups) {
    const normalizedGroups = normalizeDictionaryGroups(groups);
    const ungroupedIndex = normalizedGroups.findIndex(({name}) => name === UNGROUPED_NAME);
    if (ungroupedIndex < 0) { return dictionaries.length; }
    /** @type {Set<string>} */
    const earlierGroups = new Set();
    for (let i = 0; i < ungroupedIndex; ++i) {
        earlierGroups.add(normalizedGroups[i].name);
    }
    let result = 0;
    for (const {group} of dictionaries) {
        const isKnown = (typeof group === 'string' && normalizedGroups.some(({name}) => name === group));
        if (!isKnown || group === UNGROUPED_NAME || earlierGroups.has(group)) { ++result; }
    }
    return result;
}
