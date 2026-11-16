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
 * The search page can host several independent searches as tabs. The top-level page (the "shell")
 * only shows the tab bar; every tab is the regular search page embedded in an iframe. The two sides
 * are same-origin and talk to each other with DOM events:
 * - a tab dispatches `SEARCH_TAB_EVENT` on its own iframe element (which lives in the shell document);
 * - the shell dispatches `SEARCH_TAB_COMMAND` on the tab's window.
 */

export const SEARCH_TAB_FRAME_CLASS = 'search-tab-frame';

export const SEARCH_TAB_EVENT = 'yomitanSearchTabEvent';

export const SEARCH_TAB_COMMAND = 'yomitanSearchTabCommand';

/**
 * Returns the iframe element hosting this document if this document is a search tab, otherwise `null`.
 * @returns {?HTMLIFrameElement}
 */
export function getSearchTabFrameElement() {
    try {
        if (window.parent === window) { return null; }
        // `frameElement` belongs to the parent document's realm, so `instanceof` can't be used on it.
        const {frameElement} = window;
        if (frameElement === null || !frameElement.classList.contains(SEARCH_TAB_FRAME_CLASS)) { return null; }
        return /** @type {HTMLIFrameElement} */ (frameElement);
    } catch (e) {
        // Cross-origin parent
        return null;
    }
}

/**
 * Whether the page should act as the tab shell rather than as a search page.
 * @returns {boolean}
 */
export function isSearchTabShellPage() {
    if (window.parent !== window) { return false; }
    // The search page shown inside the browser action popup is too small for tabs.
    const params = new URLSearchParams(window.location.search);
    return params.get('action-popup') !== 'true';
}

/**
 * Maps a keyboard event to a tab action. `code` is used so that the shortcuts don't depend on the keyboard layout.
 * @param {KeyboardEvent} e
 * @returns {?import('search-tabs').TabKeyAction}
 */
export function getSearchTabKeyAction(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { return null; }
    switch (e.code) {
        case 'KeyT': return 'newTab';
        case 'KeyW': return 'closeTab';
        case 'Period': return 'nextTab';
        case 'Comma': return 'previousTab';
        default: return null;
    }
}
