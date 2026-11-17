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
 * A dictionary group can be switched off as a whole. This is stored separately from the
 * dictionaries' own `enabled` flags, so switching a group back on restores exactly the
 * dictionaries that were enabled inside it.
 */

/**
 * Gets the names of the dictionary groups which are switched off.
 * Groups only take effect while at least one user-defined (named) group exists.
 * @param {import('settings').DictionaryGroupOptions[]|undefined} groups
 * @returns {Set<string>}
 */
export function getDisabledDictionaryGroups(groups) {
    /** @type {Set<string>} */
    const result = new Set();
    if (!Array.isArray(groups) || !groups.some(({name}) => name !== '')) { return result; }
    for (const {name, enabled} of groups) {
        if (enabled === false) { result.add(name); }
    }
    return result;
}

/**
 * Whether a dictionary is used for lookups: its own toggle is on and its group isn't switched off.
 * @param {import('settings').DictionaryOptions} dictionary
 * @param {Set<string>} disabledGroups The result of `getDisabledDictionaryGroups`.
 * @returns {boolean}
 */
export function isDictionaryEnabled(dictionary, disabledGroups) {
    return dictionary.enabled && !disabledGroups.has(typeof dictionary.group === 'string' ? dictionary.group : '');
}
