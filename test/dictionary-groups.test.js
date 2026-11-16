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

import {describe, expect, test} from 'vitest';
import {getUngroupedInsertIndex, normalizeDictionaryGroups, sortDictionariesByGroup} from '../ext/js/pages/settings/dictionary-groups.js';

/**
 * @param {string} name
 * @param {string} group
 * @returns {import('settings').DictionaryOptions}
 */
function createDictionary(name, group) {
    return {
        name,
        alias: name,
        enabled: true,
        allowSecondarySearches: false,
        definitionsCollapsible: 'not-collapsible',
        partsOfSpeechFilter: true,
        useDeinflections: true,
        group,
        fallbackOnly: false,
    };
}

/**
 * @param {import('settings').DictionaryOptions[]} dictionaries
 * @returns {string[]}
 */
function summarize(dictionaries) {
    return dictionaries.map(({name, group}) => `${group}/${name}`);
}

describe('Dictionary groups', () => {
    test('normalizeDictionaryGroups', () => {
        expect(normalizeDictionaryGroups(void 0)).toStrictEqual([]);
        expect(normalizeDictionaryGroups([])).toStrictEqual([]);
        // Without user-defined groups there is nothing to organize.
        expect(normalizeDictionaryGroups([{name: '', collapsed: true}])).toStrictEqual([]);
        // The ungrouped group is appended when missing; duplicates are dropped.
        expect(normalizeDictionaryGroups([
            {name: 'A', collapsed: true},
            {name: 'B', collapsed: false},
            {name: 'A', collapsed: false},
        ])).toStrictEqual([
            {name: 'A', collapsed: true},
            {name: 'B', collapsed: false},
            {name: '', collapsed: false},
        ]);
        // The position of the ungrouped group is kept.
        expect(normalizeDictionaryGroups([
            {name: '', collapsed: false},
            {name: 'A', collapsed: false},
        ]).map(({name}) => name)).toStrictEqual(['', 'A']);
    });

    test('sortDictionariesByGroup leaves ungrouped setups untouched', () => {
        const dictionaries = [createDictionary('1', ''), createDictionary('2', ''), createDictionary('3', '')];
        expect(sortDictionariesByGroup(dictionaries, [])).toBe(false);
        expect(summarize(dictionaries)).toStrictEqual(['/1', '/2', '/3']);
    });

    test('sortDictionariesByGroup makes groups contiguous and keeps relative order', () => {
        const groups = [{name: 'B', collapsed: false}, {name: '', collapsed: false}, {name: 'A', collapsed: false}];
        const dictionaries = [
            createDictionary('1', 'A'),
            createDictionary('2', ''),
            createDictionary('3', 'B'),
            createDictionary('4', 'A'),
            createDictionary('5', 'B'),
            createDictionary('6', ''),
        ];
        expect(sortDictionariesByGroup(dictionaries, groups)).toBe(true);
        expect(summarize(dictionaries)).toStrictEqual(['B/3', 'B/5', '/2', '/6', 'A/1', 'A/4']);
        expect(sortDictionariesByGroup(dictionaries, groups)).toBe(false);
    });

    test('sortDictionariesByGroup ungroups dictionaries of unknown groups', () => {
        const groups = [{name: 'A', collapsed: false}];
        const dictionaries = [createDictionary('1', 'Missing'), createDictionary('2', 'A')];
        expect(sortDictionariesByGroup(dictionaries, groups)).toBe(true);
        expect(summarize(dictionaries)).toStrictEqual(['A/2', '/1']);

        const dictionaries2 = [createDictionary('1', 'Missing')];
        expect(sortDictionariesByGroup(dictionaries2, [])).toBe(true);
        expect(summarize(dictionaries2)).toStrictEqual(['/1']);
    });

    test('getUngroupedInsertIndex', () => {
        const dictionaries = [createDictionary('1', 'B'), createDictionary('2', ''), createDictionary('3', 'A')];
        expect(getUngroupedInsertIndex(dictionaries, [])).toBe(3);
        expect(getUngroupedInsertIndex(dictionaries, [{name: 'B', collapsed: false}, {name: '', collapsed: false}, {name: 'A', collapsed: false}])).toBe(2);
        expect(getUngroupedInsertIndex([createDictionary('1', 'A')], [{name: '', collapsed: false}, {name: 'A', collapsed: false}])).toBe(0);
        expect(getUngroupedInsertIndex(dictionaries, [{name: 'B', collapsed: false}, {name: 'A', collapsed: false}])).toBe(3);
    });
});
