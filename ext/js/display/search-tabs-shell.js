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

import {createApiMap, invokeApiMapHandler} from '../core/api-map.js';
import {parseJson} from '../core/json.js';
import {querySelectorNotNull} from '../dom/query-selector.js';
import {getSearchTabKeyAction, SEARCH_TAB_COMMAND, SEARCH_TAB_EVENT, SEARCH_TAB_FRAME_CLASS} from './search-tab-util.js';

const SAVED_STATE_KEY = 'searchTabs';
const DEFAULT_TITLE = 'Yomitan Search';
const NEW_TAB_LABEL = 'New tab';

/**
 * @typedef {object} SearchTab
 * @property {number} id
 * @property {HTMLIFrameElement} frame
 * @property {HTMLElement} node The tab's element in the tab bar.
 * @property {HTMLElement} titleNode
 * @property {HTMLElement} profileNode
 * @property {string} query
 * @property {?number} profile The index of the profile used by the tab, or `null` for the default profile.
 * @property {boolean} ready
 * @property {import('search-tabs').TabCommand[]} pendingCommands Commands received before the tab finished loading.
 */

/**
 * Hosts several independent search pages as tabs.
 * Every tab is the regular search page inside an iframe, so each one has its own
 * query, history, profile and clipboard monitor.
 */
export class SearchTabsShell {
    constructor() {
        /** @type {HTMLElement} */
        this._container = querySelectorNotNull(document, '#search-tabs');
        /** @type {HTMLElement} */
        this._tabList = querySelectorNotNull(document, '#search-tab-list');
        /** @type {HTMLElement} */
        this._frameContainer = querySelectorNotNull(document, '#search-tab-frames');
        /** @type {HTMLButtonElement} */
        this._addButton = querySelectorNotNull(document, '#search-tab-add');
        /** @type {HTMLTemplateElement} */
        this._tabTemplate = querySelectorNotNull(document, '#search-tab-template');
        /** @type {SearchTab[]} */
        this._tabs = [];
        /** @type {?SearchTab} */
        this._activeTab = null;
        /** @type {number} */
        this._nextId = 0;
        /** @type {import('display').SearchMode} */
        this._mode = null;
        /** @type {?MutationObserver} */
        this._themeObserver = null;
        /** @type {import('application').ApiMap} */
        this._apiMap = createApiMap([
            ['searchDisplayControllerGetMode', this._onMessageGetMode.bind(this)],
            ['searchDisplayControllerSetMode', this._onMessageSetMode.bind(this)],
            ['searchDisplayControllerUpdateSearchQuery', this._onMessageUpdateSearchQuery.bind(this)],
            ['searchDisplayControllerSelectSearch', this._onMessageSelectSearch.bind(this)],
        ]);
    }

    /** */
    prepare() {
        document.documentElement.dataset.searchTabsShell = 'true';
        this._mode = this._readMode();

        chrome.runtime.onMessage.addListener(this._onMessage.bind(this));
        this._addButton.addEventListener('click', () => { this._createTab('', null, true, null, null); }, false);
        window.addEventListener('keydown', this._onKeyDown.bind(this), false);
        window.addEventListener('focus', this._onWindowFocus.bind(this), false);

        const savedState = this._loadState();
        if (savedState !== null) {
            for (const {query, profile} of savedState.tabs) {
                this._createTab(query, profile, false, null, null);
            }
            this._activateTab(this._tabs[Math.max(0, Math.min(this._tabs.length - 1, savedState.active))]);
        } else {
            // The first tab takes over whatever the page was opened with (e.g. ?query=...).
            this._createTab('', null, true, null, window.location.search);
        }

        this._container.hidden = false;
        document.body.hidden = false;
        document.documentElement.dataset.loaded = 'true';
    }

    // Messages from the backend, which are always sent to the top frame

    /** @type {import('extension').ChromeRuntimeOnMessageCallback<import('application').ApiMessageAny>} */
    _onMessage({action, params}, _sender, callback) {
        return invokeApiMapHandler(this._apiMap, action, params, [], callback);
    }

    /** @type {import('application').ApiHandler<'searchDisplayControllerGetMode'>} */
    _onMessageGetMode() {
        return this._mode;
    }

    /** @type {import('application').ApiHandler<'searchDisplayControllerSetMode'>} */
    _onMessageSetMode({mode}) {
        this._mode = mode;
        for (const tab of this._tabs) {
            this._sendCommand(tab, {type: 'setMode', mode});
        }
    }

    /** @type {import('application').ApiHandler<'searchDisplayControllerUpdateSearchQuery'>} */
    _onMessageUpdateSearchQuery({text, animate}) {
        if (this._activeTab === null) { return; }
        this._sendCommand(this._activeTab, {type: 'updateSearchQuery', text, animate});
    }

    /** @type {import('application').ApiHandler<'searchDisplayControllerSelectSearch'>} */
    _onMessageSelectSearch() {
        if (this._activeTab === null) { return; }
        this._sendCommand(this._activeTab, {type: 'selectSearch'});
    }

    // Tabs

    /**
     * @param {string} query
     * @param {?number} profile
     * @param {boolean} activate
     * @param {?SearchTab} afterTab The tab after which the new tab is inserted, or `null` to append it.
     * @param {?string} search A full location search string to use instead of `query`.
     * @returns {SearchTab}
     */
    _createTab(query, profile, activate, afterTab, search) {
        const node = /** @type {HTMLElement} */ (/** @type {DocumentFragment} */ (this._tabTemplate.content.cloneNode(true)).firstElementChild);
        /** @type {HTMLElement} */
        const titleNode = querySelectorNotNull(node, '.search-tab-title');
        /** @type {HTMLElement} */
        const profileNode = querySelectorNotNull(node, '.search-tab-profile');
        /** @type {HTMLButtonElement} */
        const closeButton = querySelectorNotNull(node, '.search-tab-close');

        if (search === null) {
            const params = new URLSearchParams();
            if (query.length > 0) { params.set('query', query); }
            search = params.toString();
            if (search.length > 0) { search = `?${search}`; }
        } else {
            query = new URLSearchParams(search).get('query') ?? '';
        }

        const frame = document.createElement('iframe');
        frame.className = SEARCH_TAB_FRAME_CLASS;
        frame.hidden = true;
        frame.dataset.active = 'false';
        if (profile !== null) { frame.dataset.profile = `${profile}`; }
        if (this._mode !== null) { frame.dataset.mode = this._mode; }
        frame.setAttribute('allow', 'clipboard-read; clipboard-write');
        frame.src = `${window.location.pathname}${search}`;

        /** @type {SearchTab} */
        const tab = {id: this._nextId++, frame, node, titleNode, profileNode, query, profile, ready: false, pendingCommands: []};
        this._updateTabLabel(tab);

        frame.addEventListener(SEARCH_TAB_EVENT, (e) => {
            this._onTabEvent(tab, /** @type {CustomEvent<import('search-tabs').TabEvent>} */ (e).detail);
        }, false);
        node.addEventListener('click', () => { this._activateTab(tab); }, false);
        node.addEventListener('auxclick', (e) => {
            if (e.button !== 1) { return; }
            e.preventDefault();
            this._closeTab(tab);
        }, false);
        node.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') { return; }
            e.preventDefault();
            this._activateTab(tab);
        }, false);
        closeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeTab(tab);
        }, false);

        const index = (afterTab !== null ? this._tabs.indexOf(afterTab) + 1 : this._tabs.length);
        this._tabs.splice(index, 0, tab);
        this._tabList.insertBefore(node, index + 1 < this._tabs.length ? this._tabs[index + 1].node : null);
        this._frameContainer.appendChild(frame);

        if (activate) {
            this._activateTab(tab);
        } else {
            this._saveState();
        }
        return tab;
    }

    /**
     * @param {SearchTab} tab
     */
    _activateTab(tab) {
        this._activeTab = tab;
        for (const other of this._tabs) {
            const active = (other === tab);
            other.frame.hidden = !active;
            other.frame.dataset.active = `${active}`;
            other.node.dataset.active = `${active}`;
            other.node.setAttribute('aria-selected', `${active}`);
            this._sendCommand(other, {type: 'setActive', active});
        }
        tab.node.scrollIntoView({block: 'nearest', inline: 'nearest'});
        this._focusTab(tab);
        this._updateTitle();
        this._observeTheme(tab);
        this._saveState();
    }

    /**
     * @param {SearchTab} tab
     */
    _closeTab(tab) {
        const index = this._tabs.indexOf(tab);
        if (index < 0) { return; }
        this._tabs.splice(index, 1);
        tab.node.remove();
        tab.frame.remove();
        if (this._tabs.length === 0) {
            // There is always at least one tab.
            this._createTab('', null, true, null, null);
            return;
        }
        if (this._activeTab === tab) {
            this._activateTab(this._tabs[Math.min(index, this._tabs.length - 1)]);
        } else {
            this._saveState();
        }
    }

    /**
     * @param {number} offset
     */
    _switchTab(offset) {
        const count = this._tabs.length;
        if (this._activeTab === null || count < 2) { return; }
        const index = this._tabs.indexOf(this._activeTab);
        this._activateTab(this._tabs[(((index + offset) % count) + count) % count]);
    }

    /**
     * @param {SearchTab} tab
     * @param {import('search-tabs').TabEvent} event
     */
    _onTabEvent(tab, event) {
        switch (event.type) {
            case 'ready':
                tab.ready = true;
                for (const command of tab.pendingCommands.splice(0)) {
                    this._dispatchCommand(tab, command);
                }
                if (tab === this._activeTab) {
                    this._focusTab(tab);
                    this._observeTheme(tab);
                }
                break;
            case 'query':
                tab.query = event.query;
                this._updateTabLabel(tab);
                if (tab === this._activeTab) { this._updateTitle(); }
                this._saveState();
                break;
            case 'profile':
                tab.profile = event.index;
                tab.profileNode.textContent = event.name ?? '';
                tab.profileNode.hidden = (event.index === null);
                this._saveState();
                break;
            case 'openTab':
                // A tab opened from another one keeps using that tab's profile.
                this._createTab(event.query, tab.profile, !event.background, tab, null);
                break;
            case 'newTab':
                this._createTab('', tab.profile, true, tab, null);
                break;
            case 'closeTab':
                this._closeTab(tab);
                break;
            case 'switchTab':
                this._switchTab(event.offset);
                break;
        }
    }

    /**
     * @param {SearchTab} tab
     * @param {import('search-tabs').TabCommand} command
     */
    _sendCommand(tab, command) {
        if (tab.ready) {
            this._dispatchCommand(tab, command);
        } else if (command.type !== 'setActive') {
            // The active state is read from the frame element when the tab loads.
            tab.pendingCommands.push(command);
        }
    }

    /**
     * @param {SearchTab} tab
     * @param {import('search-tabs').TabCommand} command
     */
    _dispatchCommand(tab, command) {
        const {contentWindow} = tab.frame;
        if (contentWindow === null) { return; }
        contentWindow.dispatchEvent(new CustomEvent(SEARCH_TAB_COMMAND, {detail: command}));
    }

    /**
     * @param {SearchTab} tab
     */
    _focusTab(tab) {
        if (!tab.ready) { return; }
        const {contentWindow} = tab.frame;
        if (contentWindow !== null) { contentWindow.focus(); }
    }

    /**
     * @param {SearchTab} tab
     */
    _updateTabLabel(tab) {
        const label = (tab.query.length > 0 ? tab.query : NEW_TAB_LABEL);
        tab.titleNode.textContent = label;
        tab.node.title = label;
        tab.node.dataset.empty = `${tab.query.length === 0}`;
    }

    /** */
    _updateTitle() {
        const query = (this._activeTab !== null ? this._activeTab.query : '');
        document.title = (query.length > 0 ? `${query} - ${DEFAULT_TITLE}` : DEFAULT_TITLE);
    }

    /**
     * Makes the tab bar use the same theme as the active tab.
     * @param {SearchTab} tab
     */
    _observeTheme(tab) {
        if (this._themeObserver !== null) {
            this._themeObserver.disconnect();
            this._themeObserver = null;
        }
        const tabDocument = tab.frame.contentDocument;
        if (!tab.ready || tabDocument === null) { return; }
        const source = tabDocument.documentElement;
        const update = () => {
            for (const key of ['theme', 'themeRaw', 'browserTheme', 'siteTheme']) {
                const value = source.dataset[key];
                if (typeof value === 'string') {
                    document.documentElement.dataset[key] = value;
                } else {
                    delete document.documentElement.dataset[key];
                }
            }
        };
        update();
        this._themeObserver = new MutationObserver(update);
        this._themeObserver.observe(source, {attributes: true});
    }

    // Input

    /**
     * @param {KeyboardEvent} e
     */
    _onKeyDown(e) {
        const action = getSearchTabKeyAction(e);
        if (action === null) { return; }
        e.preventDefault();
        switch (action) {
            case 'newTab': this._createTab('', this._activeTab !== null ? this._activeTab.profile : null, true, this._activeTab, null); break;
            case 'closeTab':
                if (this._activeTab !== null) { this._closeTab(this._activeTab); }
                break;
            case 'nextTab': this._switchTab(1); break;
            case 'previousTab': this._switchTab(-1); break;
        }
    }

    /** */
    _onWindowFocus() {
        // Keyboard input should go to the active search rather than to the shell.
        if (this._activeTab !== null && document.activeElement === document.body) {
            this._focusTab(this._activeTab);
        }
    }

    // State

    /**
     * @returns {import('display').SearchMode}
     */
    _readMode() {
        try {
            const mode = sessionStorage.getItem('mode');
            return (mode === 'popup' || mode === 'action-popup') ? mode : null;
        } catch (e) {
            return null;
        }
    }

    /** */
    _saveState() {
        /** @type {import('search-tabs').SavedState} */
        const state = {
            tabs: this._tabs.map(({query, profile}) => ({query, profile})),
            active: (this._activeTab !== null ? this._tabs.indexOf(this._activeTab) : 0),
        };
        try {
            sessionStorage.setItem(SAVED_STATE_KEY, JSON.stringify(state));
        } catch (e) {
            // NOP
        }
    }

    /**
     * Restores the tabs after a reload of the page.
     * @returns {?import('search-tabs').SavedState}
     */
    _loadState() {
        try {
            const value = sessionStorage.getItem(SAVED_STATE_KEY);
            if (value === null) { return null; }
            /** @type {unknown} */
            const state = parseJson(value);
            if (typeof state !== 'object' || state === null) { return null; }
            const {tabs, active} = /** @type {{tabs: unknown, active: unknown}} */ (state);
            if (!Array.isArray(tabs) || tabs.length === 0) { return null; }
            /** @type {import('search-tabs').SavedTab[]} */
            const validTabs = [];
            for (const tab of /** @type {unknown[]} */ (tabs)) {
                if (typeof tab !== 'object' || tab === null) { continue; }
                const {query, profile} = /** @type {{query: unknown, profile: unknown}} */ (tab);
                validTabs.push({
                    query: (typeof query === 'string' ? query : ''),
                    profile: (typeof profile === 'number' && Number.isInteger(profile) && profile >= 0 ? profile : null),
                });
            }
            if (validTabs.length === 0) { return null; }
            return {tabs: validTabs, active: (typeof active === 'number' && Number.isInteger(active) ? active : 0)};
        } catch (e) {
            return null;
        }
    }
}
