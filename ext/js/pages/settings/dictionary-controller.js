/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2020-2022  Yomichan Authors
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

import * as ajvSchemas0 from '../../../lib/validate-schemas.js';
import {EventListenerCollection} from '../../core/event-listener-collection.js';
import {readResponseJson} from '../../core/json.js';
import {log} from '../../core/log.js';
import {deferPromise} from '../../core/utilities.js';
import {compareRevisions} from '../../dictionary/dictionary-data-util.js';
import {DictionaryWorker} from '../../dictionary/dictionary-worker.js';
import {querySelectorNotNull} from '../../dom/query-selector.js';
import {normalizeDictionaryGroups, sortDictionariesByGroup, UNGROUPED_LABEL, UNGROUPED_NAME} from './dictionary-groups.js';

const ajvSchemas = /** @type {import('dictionary-importer').CompiledSchemaValidators} */ (/** @type {unknown} */ (ajvSchemas0));

class DictionaryEntry {
    /**
     * @param {DictionaryController} dictionaryController
     * @param {DocumentFragment} fragment
     * @param {number} index
     * @param {import('dictionary-importer').Summary} dictionaryInfo
     * @param {string | null} updateDownloadUrl
     * @param {import('dictionary-database').DictionaryCountGroup|null} dictionaryDatabaseCounts
     */
    constructor(dictionaryController, fragment, index, dictionaryInfo, updateDownloadUrl, dictionaryDatabaseCounts) {
        /** @type {DictionaryController} */
        this._dictionaryController = dictionaryController;
        /** @type {number} */
        this._index = index;
        /** @type {import('dictionary-importer').Summary} */
        this._dictionaryInfo = dictionaryInfo;
        /** @type {string | null} */
        this._updateDownloadUrl = updateDownloadUrl;
        /** @type {EventListenerCollection} */
        this._eventListeners = new EventListenerCollection();
        /** @type {?import('dictionary-database').DictionaryCountGroup} */
        this._databaseCounts = dictionaryDatabaseCounts;
        /** @type {ChildNode[]} */
        this._nodes = [...fragment.childNodes];
        /** @type {HTMLElement} */
        this._rowNode = querySelectorNotNull(fragment, '.dictionary-row');
        /** @type {HTMLElement} */
        this._indexNode = querySelectorNotNull(fragment, '.dictionary-list-index');
        /** @type {HTMLInputElement} */
        this._enabledCheckbox = querySelectorNotNull(fragment, '.dictionary-enabled');
        /** @type {HTMLButtonElement} */
        this._upButton = querySelectorNotNull(fragment, '#dictionary-move-up');
        /** @type {HTMLButtonElement} */
        this._downButton = querySelectorNotNull(fragment, '#dictionary-move-down');
        /** @type {HTMLButtonElement} */
        this._menuButton = querySelectorNotNull(fragment, '.dictionary-menu-button');
        /** @type {HTMLButtonElement} */
        this._outdatedButton = querySelectorNotNull(fragment, '.dictionary-outdated-button');
        /** @type {HTMLButtonElement} */
        this._integrityButtonCheck = querySelectorNotNull(fragment, '.dictionary-integrity-button-check');
        /** @type {HTMLButtonElement} */
        this._integrityButtonWarning = querySelectorNotNull(fragment, '.dictionary-integrity-button-warning');
        /** @type {HTMLButtonElement} */
        this._integrityButtonError = querySelectorNotNull(fragment, '.dictionary-integrity-button-error');
        /** @type {HTMLButtonElement} */
        this._updatesAvailable = querySelectorNotNull(fragment, '.dictionary-update-available');
        /** @type {HTMLElement} */
        this._aliasNode = querySelectorNotNull(fragment, '.dictionary-alias');
        /** @type {HTMLElement} */
        this._versionNode = querySelectorNotNull(fragment, '.dictionary-revision');
        /** @type {HTMLElement} */
        this._titleContainer = querySelectorNotNull(fragment, '.dictionary-item-title-container');
        /** @type {HTMLElement} */
        this._fallbackLabel = querySelectorNotNull(fragment, '.dictionary-fallback-label');
        /** @type {boolean} */
        this._fallbackOnly = false;
    }

    /** @type {number} */
    get index() {
        return this._index;
    }

    /**
     * @param {boolean} value
     */
    setFallbackOnly(value) {
        this._fallbackOnly = value;
        this._fallbackLabel.hidden = !value;
    }

    /** @type {string} */
    get dictionaryTitle() {
        return this._dictionaryInfo.title;
    }

    /**
     * @param {string} groupName
     * @param {boolean} hidden
     */
    prepare(groupName, hidden) {
        const index = this._index;
        const {revision, version, importSuccess} = this._dictionaryInfo;

        this._rowNode.dataset.index = `${index}`;
        this._rowNode.dataset.groupName = groupName;
        this._rowNode.hidden = hidden;
        this._indexNode.textContent = `${index + 1}`;
        this._aliasNode.dataset.setting = `dictionaries[${index}].alias`;
        this._versionNode.textContent = `rev.${revision}`;
        this._outdatedButton.hidden = (version >= 3);
        this._enabledCheckbox.dataset.setting = `dictionaries[${index}].enabled`;
        this._showUpdatesAvailableButton();
        this._eventListeners.addEventListener(this._enabledCheckbox, 'settingChanged', this._onEnabledChanged.bind(this), false);
        this._eventListeners.addEventListener(this._menuButton, 'menuOpen', this._onMenuOpen.bind(this), false);
        this._eventListeners.addEventListener(this._menuButton, 'menuClose', this._onMenuClose.bind(this), false);
        this._eventListeners.addEventListener(this._upButton, 'click', (() => { this._move(-1); }).bind(this), false);
        this._eventListeners.addEventListener(this._downButton, 'click', (() => { this._move(1); }).bind(this), false);
        this._eventListeners.addEventListener(this._outdatedButton, 'click', this._onOutdatedButtonClick.bind(this), false);
        this._eventListeners.addEventListener(this._integrityButtonCheck, 'click', this._onIntegrityButtonClick.bind(this), false);
        this._eventListeners.addEventListener(this._integrityButtonWarning, 'click', this._onIntegrityButtonClick.bind(this), false);
        this._eventListeners.addEventListener(this._integrityButtonError, 'click', this._onIntegrityButtonClick.bind(this), false);
        this._eventListeners.addEventListener(this._updatesAvailable, 'click', this._onUpdateButtonClick.bind(this), false);

        if (importSuccess === false) {
            this._integrityButtonError.hidden = false;
        }

        this.setCounts(this._databaseCounts);
    }

    /** */
    cleanup() {
        this._eventListeners.removeAllEventListeners();
        for (const node of this._nodes) {
            if (node.parentNode !== null) {
                node.parentNode.removeChild(node);
            }
        }
        this._nodes = [];
    }

    /**
     * @param {import('dictionary-database').DictionaryCountGroup?} databaseCounts
     */
    setCounts(databaseCounts) {
        if (!databaseCounts) {
            return;
        }
        this._databaseCounts = databaseCounts;
        let countsMismatch = false;

        if (!this._dictionaryInfo.counts) {
            log.warn('Check Integrity count not compare dictionary counts of ' + this._dictionaryInfo.title);
            return;
        }

        for (const value of Object.values(this._zipCounts(databaseCounts, this._dictionaryInfo.counts))) {
            if (value[0] !== value[1]) {
                countsMismatch = true;
            }
        }

        if (this._integrityButtonError.hidden) {
            this._integrityButtonWarning.hidden = !countsMismatch;
            this._integrityButtonCheck.hidden = countsMismatch;
        }
    }

    /**
     * @returns {import('dictionary-database').DictionaryCountGroup | null}
     */
    get databaseCounts() {
        return this._databaseCounts;
    }

    /**
     * @param {boolean} value
     */
    setEnabled(value) {
        this._enabledCheckbox.checked = value;
    }

    /** */
    hideUpdatesAvailableButton() {
        this._updatesAvailable.hidden = true;
    }

    /**
     * @returns {Promise<boolean>}
     */
    async checkForUpdate() {
        this._updatesAvailable.hidden = true;
        const {isUpdatable, indexUrl, revision: currentRevision, downloadUrl: currentDownloadUrl} = this._dictionaryInfo;
        if (!isUpdatable || !indexUrl || !currentDownloadUrl) { return false; }
        const response = await fetch(indexUrl);

        /** @type {unknown} */
        const index = await readResponseJson(response);

        if (!ajvSchemas.dictionaryIndex(index)) {
            throw new Error('Invalid dictionary index');
        }

        const validIndex = /** @type {import('dictionary-data').Index} */ (index);
        const {revision: latestRevision, downloadUrl: latestDownloadUrl} = validIndex;

        if (!compareRevisions(currentRevision, latestRevision)) {
            return false;
        }

        const downloadUrl = latestDownloadUrl ?? currentDownloadUrl;

        this._updateDownloadUrl = downloadUrl;
        this._showUpdatesAvailableButton();
        return true;
    }

    /**
     * @returns {string | null}
     */
    get updateDownloadUrl() {
        return this._updateDownloadUrl;
    }

    /**
     * @param {string} alias
     */
    updateAliasSettings(alias) {
        this._aliasNode.textContent = alias;
        this._aliasNode.dispatchEvent(new CustomEvent('change', {bubbles: true}));
    }

    // Private

    /** */
    _showUpdatesAvailableButton() {
        if (this._updateDownloadUrl === null || this._dictionaryController.isDictionaryInTaskQueue(this.dictionaryTitle)) {
            return;
        }
        this._updatesAvailable.dataset.downloadUrl = this._updateDownloadUrl;
        this._updatesAvailable.hidden = false;
    }

    /**
     * @param {import('popup-menu').MenuOpenEvent} e
     */
    _onMenuOpen(e) {
        const bodyNode = e.detail.menu.bodyNode;
        const count = this._dictionaryController.dictionaryOptionCount;
        this._setMenuActionEnabled(bodyNode, 'moveTo', count > 1);
        const deleteDisabled = this._dictionaryController.isDictionaryInTaskQueue(this.dictionaryTitle);
        this._setMenuActionEnabled(bodyNode, 'delete', !deleteDisabled);
        const fallbackItem = bodyNode.querySelector('[data-menu-action="toggleFallbackOnly"]');
        if (fallbackItem !== null) {
            fallbackItem.textContent = (this._fallbackOnly ? 'Always show (not a fallback)' : 'Only show as fallback');
            /** @type {HTMLElement} */ (fallbackItem).hidden = !this._dictionaryInfo.counts?.terms.total;
        }
    }

    /**
     * @param {import('popup-menu').MenuCloseEvent} e
     */
    _onMenuClose(e) {
        switch (e.detail.action) {
            case 'delete':
                this._delete();
                break;
            case 'showDetails':
                this._showDetails();
                break;
            case 'moveTo':
                this._showMoveToModal();
                break;
            case 'setGroup':
                void this._dictionaryController.showSetGroupModal(this._index, this.dictionaryTitle);
                break;
            case 'toggleFallbackOnly':
                void this._dictionaryController.setDictionaryFallbackOnly(this._index, !this._fallbackOnly);
                break;
            case 'rename':
                this._showRenameModal();
                break;
        }
    }

    /**
     * @param {import('dictionary-database').DictionaryCountGroup} databaseCounts
     * @param {import('dictionary-importer').SummaryCounts} summaryCounts
     * @returns {Record<string, [number, number]>}
     */
    _zipCounts(databaseCounts, summaryCounts) {
        return {
            terms: [databaseCounts.terms, summaryCounts?.terms?.total],
            termMeta: [databaseCounts.termMeta, summaryCounts?.termMeta?.total],
            kanji: [databaseCounts.kanji, summaryCounts?.kanji?.total],
            kanjiMeta: [databaseCounts.kanjiMeta, summaryCounts?.kanjiMeta?.total],
            tagMeta: [databaseCounts.tagMeta, summaryCounts?.tagMeta?.total],
            media: [databaseCounts.media, summaryCounts?.media?.total],
        };
    }

    /**
     * @param {import('dom-data-binder').SettingChangedEvent} e
     */
    _onEnabledChanged(e) {
        const {detail: {value}} = e;
        this._titleContainer.dataset.enabled = `${value}`;
        void this._dictionaryController.updateDictionariesEnabled();
    }

    /** */
    _onOutdatedButtonClick() {
        this._showDetails();
    }

    /** */
    _onUpdateButtonClick() {
        const downloadUrl = this._updatesAvailable.dataset.downloadUrl;
        this._dictionaryController.updateDictionary(this.dictionaryTitle, downloadUrl);
    }

    /** */
    _onIntegrityButtonClick() {
        this._showDetails();
    }

    /** */
    _showDetails() {
        const {title, revision, version, counts, prefixWildcardsSupported} = this._dictionaryInfo;

        const modal = this._dictionaryController.modalController.getModal('dictionary-details');
        if (modal === null) { return; }

        /** @type {HTMLElement} */
        const titleElement = querySelectorNotNull(modal.node, '.dictionary-title');
        /** @type {HTMLElement} */
        const versionElement = querySelectorNotNull(modal.node, '.dictionary-revision');
        /** @type {HTMLElement} */
        const outdateElement = querySelectorNotNull(modal.node, '.dictionary-outdated-notification');
        /** @type {HTMLInputElement} */
        const wildcardSupportedElement = querySelectorNotNull(modal.node, '.dictionary-prefix-wildcard-searches-supported');
        /** @type {HTMLElement} */
        const detailsTableElement = querySelectorNotNull(modal.node, '.dictionary-details-table');
        /** @type {HTMLElement} */
        const partsOfSpeechFilterSetting = querySelectorNotNull(modal.node, '.dictionary-parts-of-speech-filter-setting');
        /** @type {HTMLElement} */
        const partsOfSpeechFilterToggle = querySelectorNotNull(partsOfSpeechFilterSetting, '.dictionary-parts-of-speech-filter-toggle');
        /** @type {HTMLElement} */
        const useDeinflectionsSetting = querySelectorNotNull(modal.node, '.dictionary-use-deinflections-setting');
        /** @type {HTMLElement} */
        const useDeinflectionsToggle = querySelectorNotNull(useDeinflectionsSetting, '.dictionary-use-deinflections-toggle');

        titleElement.textContent = title;
        versionElement.textContent = `rev.${revision}`;
        outdateElement.hidden = (version >= 3);
        wildcardSupportedElement.checked = prefixWildcardsSupported;
        partsOfSpeechFilterSetting.hidden = !counts?.terms.total;
        partsOfSpeechFilterToggle.dataset.setting = `dictionaries[${this._index}].partsOfSpeechFilter`;

        useDeinflectionsSetting.hidden = !counts?.terms.total;
        useDeinflectionsToggle.dataset.setting = `dictionaries[${this._index}].useDeinflections`;

        /** @type {?HTMLElement} */
        const fallbackOnlySetting = modal.node.querySelector('.dictionary-fallback-only-setting');
        /** @type {?HTMLElement} */
        const fallbackOnlyToggle = modal.node.querySelector('.dictionary-fallback-only-toggle');
        if (fallbackOnlySetting !== null && fallbackOnlyToggle !== null) {
            fallbackOnlySetting.hidden = !counts?.terms.total;
            fallbackOnlyToggle.dataset.setting = `dictionaries[${this._index}].fallbackOnly`;
            modal.node.dataset.index = `${this._index}`;
        }

        this._setupDetails(detailsTableElement);

        modal.setVisible(true);
    }

    /**
     * @param {Element} detailsTable
     * @returns {boolean}
     */
    _setupDetails(detailsTable) {
        /** @type {Partial<Record<keyof (typeof this._dictionaryInfo & typeof this._dictionaryInfo.counts), string>>} */
        const targets = {
            author: 'Author',
            url: 'URL',
            description: 'Description',
            attribution: 'Attribution',
            sourceLanguage: 'Source Language',
            targetLanguage: 'Target Language',
            terms: 'Term Count',
            termMeta: 'Term Meta Count',
            kanji: 'Kanji Count',
            kanjiMeta: 'Kanji Meta Count',
            tagMeta: 'Tag Count',
            media: 'Media Count',
            frequencyMode: 'Frequency Mode',
            prefixWildcardsSupported: 'Prefix Wildcards Enabled',
            importSuccess: 'Import Success',
        };

        const dictionaryInfo = {...this._dictionaryInfo, ...this._dictionaryInfo.counts};
        const fragment = document.createDocumentFragment();
        let any = false;
        for (const [key, label] of /** @type {([keyof (typeof this._dictionaryInfo & typeof this._dictionaryInfo.counts), string])[]} */ (Object.entries(targets))) {
            const info = dictionaryInfo[key];
            let displayText = ((_info) => {
                if (typeof _info === 'string') { return _info; }
                if (_info && typeof _info === 'object' && 'total' in _info) {
                    return _info.total ? `${_info.total}` : false;
                }
                if (typeof _info === 'boolean') { return _info.toString(); }
                return false;
            })(info);
            if (!displayText) { continue; }

            const details = /** @type {HTMLElement} */ (this._dictionaryController.instantiateTemplate('dictionary-details-entry'));
            details.dataset.type = key;

            /** @type {HTMLElement} */
            const labelElement = querySelectorNotNull(details, '.dictionary-details-entry-label');
            /** @type {HTMLElement} */
            const infoElement = querySelectorNotNull(details, '.dictionary-details-entry-info');

            labelElement.textContent = `${label}:`;
            if (this._databaseCounts && this._databaseCounts[key]) {
                displayText = 'Expected: ' + displayText + ' (Database: ' + this._databaseCounts[key] + ')';
            }
            infoElement.textContent = displayText;
            fragment.appendChild(details);

            any = true;
        }

        detailsTable.textContent = '';
        detailsTable.appendChild(fragment);
        return any;
    }

    /** */
    _delete() {
        void this._dictionaryController.deleteDictionary(this.dictionaryTitle);
    }

    /**
     * @param {number} offset
     */
    _move(offset) {
        void this._dictionaryController.moveDictionaryByOffset(this._index, offset);
    }

    /**
     * @param {Element} menu
     * @param {string} action
     * @param {boolean} enabled
     */
    _setMenuActionEnabled(menu, action, enabled) {
        const element = /** @type {?HTMLButtonElement} */ (menu.querySelector(`[data-menu-action="${action}"]`));
        if (element === null) { return; }
        element.disabled = !enabled;
    }

    /** */
    _showMoveToModal() {
        const {title} = this._dictionaryInfo;
        const count = this._dictionaryController.dictionaryOptionCount;
        const modal = this._dictionaryController.modalController.getModal('dictionary-move-location');
        if (modal === null) { return; }
        /** @type {HTMLInputElement} */
        const input = querySelectorNotNull(modal.node, '#dictionary-move-location');
        /** @type {HTMLElement} */
        const titleNode = querySelectorNotNull(modal.node, '.dictionary-title');

        modal.node.dataset.index = `${this._index}`;
        titleNode.textContent = title;
        input.value = `${this._index + 1}`;
        input.max = `${count}`;

        modal.setVisible(true);
    }

    /** */
    _showRenameModal() {
        const {title} = this._dictionaryInfo;
        const modal = this._dictionaryController.modalController.getModal('dictionary-set-alias');
        if (modal === null) { return; }
        /** @type {HTMLInputElement} */
        const input = querySelectorNotNull(modal.node, '#dictionary-alias-input');
        /** @type {HTMLElement} */
        const titleNode = querySelectorNotNull(modal.node, '.dictionary-title');

        modal.node.dataset.index = `${this._index}`;
        titleNode.textContent = title;
        input.value = this._aliasNode.textContent || title;

        modal.setVisible(true);
    }
}

class DictionaryExtraInfo {
    /**
     * @param {DictionaryController} dictionaryController
     * @param {import('dictionary-database').DictionaryCountGroup} totalCounts
     * @param {import('dictionary-database').DictionaryCountGroup} remainders
     * @param {number} totalRemainder
     */
    constructor(dictionaryController, totalCounts, remainders, totalRemainder) {
        /** @type {DictionaryController} */
        this._dictionaryController = dictionaryController;
        /** @type {import('dictionary-database').DictionaryCountGroup} */
        this._totalCounts = totalCounts;
        /** @type {import('dictionary-database').DictionaryCountGroup} */
        this._remainders = remainders;
        /** @type {number} */
        this._totalRemainder = totalRemainder;
        /** @type {EventListenerCollection} */
        this._eventListeners = new EventListenerCollection();
        /** @type {ChildNode[]} */
        this._nodes = [];
    }

    /**
     * @param {HTMLElement} container
     */
    prepare(container) {
        const fragment = this._dictionaryController.instantiateTemplateFragment('dictionary-extra');
        for (const node of fragment.childNodes) {
            this._nodes.push(node);
        }

        /** @type {HTMLButtonElement} */
        const dictionaryIntegrityButton = querySelectorNotNull(fragment, '.dictionary-integrity-button-warning');

        const titleNode = fragment.querySelector('.dictionary-total-count');
        this._setTitle(titleNode);
        this._eventListeners.addEventListener(dictionaryIntegrityButton, 'click', this._onIntegrityButtonClick.bind(this), false);

        container.appendChild(fragment);
    }

    /** */
    cleanup() {
        this._eventListeners.removeAllEventListeners();
        for (const node of this._nodes) {
            if (node.parentNode !== null) {
                node.parentNode.removeChild(node);
            }
        }
        this._nodes.length = 0;
    }

    // Private

    /** */
    _onIntegrityButtonClick() {
        this._showDetails();
    }

    /** */
    _showDetails() {
        const modal = this._dictionaryController.modalController.getModal('dictionary-extra-data');
        if (modal === null) { return; }

        const titleNode = modal.node.querySelector('.dictionary-total-count');
        this._setTitle(titleNode);

        /** @type {HTMLElement} */
        const detailsTableElement = querySelectorNotNull(modal.node, '.dictionary-details-table');
        this._setupDetails(detailsTableElement);

        modal.setVisible(true);
    }

    /**
     * @param {Element} detailsTable
     * @returns {boolean}
     */
    _setupDetails(detailsTable) {
        /** @type {Partial<Record<keyof (typeof this._totalCounts), string>>} */
        const targets = {
            terms: 'Term Count',
            termMeta: 'Term Meta Count',
            kanji: 'Kanji Count',
            kanjiMeta: 'Kanji Meta Count',
            tagMeta: 'Tag Count',
            media: 'Media Count',
        };

        const fragment = document.createDocumentFragment();
        let any = false;
        for (const [key, label] of (Object.entries(targets))) {
            if (!this._remainders[key]) {
                continue;
            }
            const details = /** @type {HTMLElement} */ (this._dictionaryController.instantiateTemplate('dictionary-details-entry'));
            details.dataset.type = key;

            /** @type {HTMLElement} */
            const labelElement = querySelectorNotNull(details, '.dictionary-details-entry-label');
            /** @type {HTMLElement} */
            const infoElement = querySelectorNotNull(details, '.dictionary-details-entry-info');

            labelElement.textContent = `${label}:`;
            infoElement.textContent = this._remainders[key].toString();
            fragment.appendChild(details);

            any = true;
        }

        detailsTable.textContent = '';
        detailsTable.appendChild(fragment);
        return any;
    }

    /**
     * @param {?Element} node
     */
    _setTitle(node) {
        if (node === null) { return; }
        node.textContent = `${this._totalRemainder} item${this._totalRemainder !== 1 ? 's' : ''}`;
    }
}

export class DictionaryController {
    /**
     * @param {import('./settings-controller.js').SettingsController} settingsController
     * @param {import('./modal-controller.js').ModalController} modalController
     * @param {import('./status-footer.js').StatusFooter} statusFooter
     */
    constructor(settingsController, modalController, statusFooter) {
        /** @type {import('./settings-controller.js').SettingsController} */
        this._settingsController = settingsController;
        /** @type {import('./modal-controller.js').ModalController} */
        this._modalController = modalController;
        /** @type {HTMLElement} */
        this._dictionaryModalBody = querySelectorNotNull(document, '#dictionaries-modal-body');
        /** @type {import('./status-footer.js').StatusFooter} */
        this._statusFooter = statusFooter;
        /** @type {?import('dictionary-importer').Summary[]} */
        this._dictionaries = null;
        /** @type {DictionaryEntry[]} */
        this._dictionaryEntries = [];
        /** @type {?import('core').TokenObject} */
        this._databaseStateToken = null;
        /** @type {boolean} */
        this._checkingUpdates = false;
        /** @type {boolean} */
        this._checkingIntegrity = false;
        /** @type {?HTMLButtonElement} */
        this._checkUpdatesButton = document.querySelector('#dictionary-check-updates');
        /** @type {?HTMLButtonElement} */
        this._checkIntegrityButton = document.querySelector('#dictionary-check-integrity');
        /** @type {HTMLElement} */
        this._dictionaryEntryContainer = querySelectorNotNull(document, '#dictionary-list');
        /** @type {?HTMLElement} */
        this._dictionaryInstallCountNode = document.querySelector('#dictionary-install-count');
        /** @type {?HTMLElement} */
        this._dictionaryEnabledCountNode = document.querySelector('#dictionary-enabled-count');
        /** @type {?NodeListOf<HTMLElement>} */
        this._noDictionariesInstalledWarnings = null;
        /** @type {?NodeListOf<HTMLElement>} */
        this._noDictionariesEnabledWarnings = null;
        /** @type {?import('./modal.js').Modal} */
        this._deleteDictionaryModal = null;
        /** @type {?import('./modal.js').Modal} */
        this._updateDictionaryModal = null;
        /** @type {HTMLInputElement} */
        this._allCheckbox = querySelectorNotNull(document, '#all-dictionaries-enabled');
        /** @type {?DictionaryExtraInfo} */
        this._extraInfo = null;
        /** @type {import('dictionary-controller.js').DictionaryTask[]} */
        this._dictionaryTaskQueue = [];
        /** @type {boolean} */
        this._isTaskQueueRunning = false;
        /** @type {(() => void) | null} */
        this._onDictionariesUpdate = null;
        /** @type {{name: string, node: HTMLElement, checkbox: HTMLInputElement, countNode: HTMLElement}[]} */
        this._groupHeaders = [];
        /** @type {EventListenerCollection} */
        this._groupHeaderEventListeners = new EventListenerCollection();
        /** @type {?({type: 'dictionary', index: number, node: HTMLElement}|{type: 'group', name: string, node: HTMLElement})} */
        this._dragState = null;
        /** @type {?HTMLElement} */
        this._dropIndicatorNode = null;
    }

    /** @type {import('./modal-controller.js').ModalController} */
    get modalController() {
        return this._modalController;
    }

    /** @type {number} */
    get dictionaryOptionCount() {
        return this._dictionaryEntries.length;
    }

    /** */
    async prepare() {
        this._noDictionariesInstalledWarnings = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.no-dictionaries-installed-warning'));
        this._noDictionariesEnabledWarnings = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.no-dictionaries-enabled-warning'));
        this._deleteDictionaryModal = this._modalController.getModal('dictionary-confirm-delete');
        this._updateDictionaryModal = this._modalController.getModal('dictionary-confirm-update');
        /** @type {HTMLButtonElement} */
        const dictionaryDeleteButton = querySelectorNotNull(document, '#dictionary-confirm-delete-button');
        /** @type {HTMLButtonElement} */
        const dictionaryUpdateButton = querySelectorNotNull(document, '#dictionary-confirm-update-button');

        /** @type {HTMLButtonElement} */
        const dictionaryMoveButton = querySelectorNotNull(document, '#dictionary-move-button');

        /** @type {HTMLButtonElement} */
        const dictionaryResetAliasButton = querySelectorNotNull(document, '#dictionary-reset-alias-button');
        /** @type {HTMLButtonElement} */
        const dictionarySetAliasButton = querySelectorNotNull(document, '#dictionary-set-alias-button');

        this._settingsController.application.on('databaseUpdated', this._onDatabaseUpdated.bind(this));
        this._settingsController.on('optionsChanged', this._onOptionsChanged.bind(this));
        this._allCheckbox.addEventListener('change', this._onAllCheckboxChange.bind(this), false);
        dictionaryDeleteButton.addEventListener('click', this._onDictionaryConfirmDelete.bind(this), false);
        dictionaryUpdateButton.addEventListener('click', this._onDictionaryConfirmUpdate.bind(this), false);

        dictionaryMoveButton.addEventListener('click', this._onDictionaryMoveButtonClick.bind(this), false);

        dictionarySetAliasButton.addEventListener('click', this._onDictionarySetAliasButtonClick.bind(this), false);
        dictionaryResetAliasButton.addEventListener('click', this._onDictionaryResetAliasButtonClick.bind(this), false);

        if (this._checkUpdatesButton !== null) {
            this._checkUpdatesButton.addEventListener('click', this._onCheckUpdatesButtonClick.bind(this), false);
        }
        if (this._checkIntegrityButton !== null) {
            this._checkIntegrityButton.addEventListener('click', this._onCheckIntegrityButtonClick.bind(this), false);
        }

        this._prepareGroups();

        /** @type {?HTMLInputElement} */
        const fallbackOnlyToggle = document.querySelector('.dictionary-fallback-only-toggle');
        if (fallbackOnlyToggle !== null) {
            fallbackOnlyToggle.addEventListener('settingChanged', (e) => {
                const {detail: {value}} = /** @type {import('dom-data-binder').SettingChangedEvent} */ (e);
                const modal = this._modalController.getModal('dictionary-details');
                const index = Number.parseInt(modal?.node.dataset.index ?? '', 10);
                if (!Number.isNaN(index)) { this._onDictionaryFallbackOnlyChanged(index, value === true); }
            }, false);
        }

        this._updateDictionaryEntryCount();

        await this._onDatabaseUpdated();
    }

    /**
     * @param {string} dictionaryTitle
     */
    async deleteDictionary(dictionaryTitle) {
        const modal = /** @type {import('./modal.js').Modal} */ (this._deleteDictionaryModal);
        modal.node.dataset.dictionaryTitle = dictionaryTitle;
        /** @type {Element} */
        const nameElement = querySelectorNotNull(modal.node, '#dictionary-confirm-delete-name');
        nameElement.textContent = dictionaryTitle;
        /** @type {HTMLElement | null} */
        const usedProfilesText = modal.node.querySelector('#dictionary-confirm-delete-used-profiles-text');
        if (usedProfilesText === null) { return; }
        /** @type {HTMLElement | null} */
        const usedProfilesList = modal.node.querySelector('#dictionary-confirm-delete-used-profiles');
        if (usedProfilesList === null) { return; }
        const usedProfileNames = await this.getProfileNamesUsingDictionary(dictionaryTitle);
        if (usedProfileNames.length > 0) {
            usedProfilesText.hidden = false;
            usedProfilesList.hidden = false;
            usedProfilesList.textContent = '';
            for (const profileName of usedProfileNames) {
                const li = document.createElement('li');
                li.textContent = profileName;
                usedProfilesList.appendChild(li);
            }
        } else {
            usedProfilesText.hidden = true;
            usedProfilesList.hidden = true;
        }
        modal.setVisible(true);
    }

    /**
     * @param {string} dictionaryTitle
     * @returns {Promise<string[]>}
     */
    async getProfileNamesUsingDictionary(dictionaryTitle) {
        const options = await this._settingsController.getOptionsFull();
        const {profiles} = options;
        /** @type {string[]} */
        const profileNames = [];
        for (const profile of profiles) {
            const dictionaryOptions = profile.options.dictionaries.find((dict) => dict.name === dictionaryTitle);
            if (dictionaryOptions?.enabled) {
                profileNames.push(profile.name);
            }
        }
        return profileNames;
    }

    /**
     * @param {string} dictionaryTitle
     * @param {string|undefined} downloadUrl
     */
    updateDictionary(dictionaryTitle, downloadUrl) {
        const modal = this._updateDictionaryModal;
        if (modal === null) { return; }
        modal.node.dataset.downloadUrl = downloadUrl;
        modal.node.dataset.dictionaryTitle = dictionaryTitle;
        /** @type {Element} */
        const nameElement = querySelectorNotNull(modal.node, '#dictionary-confirm-update-name');
        nameElement.textContent = dictionaryTitle;
        modal.setVisible(true);
    }

    /**
     * @param {number} currentIndex
     * @param {number} targetIndex
     */
    async moveDictionaryOptions(currentIndex, targetIndex) {
        const options = await this._settingsController.getOptions();
        const {dictionaries} = options;
        if (
            currentIndex < 0 || currentIndex >= dictionaries.length ||
            targetIndex < 0 || targetIndex >= dictionaries.length ||
            currentIndex === targetIndex
        ) {
            return;
        }

        // The dictionary joins the group of whichever dictionary currently occupies the target position.
        const targetGroup = dictionaries[targetIndex].group;
        const item = dictionaries.splice(currentIndex, 1)[0];
        item.group = targetGroup;
        dictionaries.splice(targetIndex, 0, item);

        await this._saveDictionaryLayout(options, options.dictionaryGroups);
    }

    /**
     * Moves a dictionary one step up or down. When the dictionary is at the edge of its group,
     * it moves into the neighbouring group instead.
     * @param {number} index
     * @param {number} offset Either -1 or 1.
     */
    async moveDictionaryByOffset(index, offset) {
        const options = await this._settingsController.getOptions();
        const {dictionaries} = options;
        const groups = normalizeDictionaryGroups(options.dictionaryGroups);
        if (index < 0 || index >= dictionaries.length) { return; }
        const item = dictionaries[index];
        const neighborIndex = index + offset;
        const neighbor = (neighborIndex >= 0 && neighborIndex < dictionaries.length ? dictionaries[neighborIndex] : null);
        if (neighbor !== null && (groups.length === 0 || neighbor.group === item.group)) {
            dictionaries.splice(index, 1);
            dictionaries.splice(neighborIndex, 0, item);
        } else {
            const groupIndex = groups.findIndex(({name}) => name === item.group);
            const targetGroupIndex = groupIndex + offset;
            if (groupIndex < 0 || targetGroupIndex < 0 || targetGroupIndex >= groups.length) { return; }
            const targetGroup = groups[targetGroupIndex];
            // Sorting keeps the dictionary at the boundary, so it lands at the near edge of the new group.
            item.group = targetGroup.name;
            targetGroup.collapsed = false;
        }
        await this._saveDictionaryLayout(options, groups);
    }

    /**
     * @param {number} index
     * @param {string} dictionaryTitle
     */
    async showSetGroupModal(index, dictionaryTitle) {
        const modal = this._modalController.getModal('dictionary-set-group');
        if (modal === null) { return; }
        const options = await this._settingsController.getOptions();
        const groups = normalizeDictionaryGroups(options.dictionaryGroups);
        const currentGroup = (index >= 0 && index < options.dictionaries.length ? options.dictionaries[index].group : UNGROUPED_NAME);

        /** @type {HTMLElement} */
        const titleNode = querySelectorNotNull(modal.node, '.dictionary-title');
        /** @type {HTMLSelectElement} */
        const select = querySelectorNotNull(modal.node, '#dictionary-set-group-select');
        /** @type {HTMLInputElement} */
        const newInput = querySelectorNotNull(modal.node, '#dictionary-set-group-new-input');
        /** @type {HTMLElement} */
        const errorNode = querySelectorNotNull(modal.node, '#dictionary-set-group-error');

        const fragment = document.createDocumentFragment();
        const groupNames = (groups.length > 0 ? groups.map(({name}) => name) : [UNGROUPED_NAME]);
        for (const name of groupNames) {
            const option = document.createElement('option');
            option.value = name;
            option.dataset.kind = 'group';
            option.textContent = (name === UNGROUPED_NAME ? UNGROUPED_LABEL : name);
            option.selected = (name === currentGroup);
            fragment.appendChild(option);
        }
        const newOption = document.createElement('option');
        newOption.value = '';
        newOption.dataset.kind = 'new';
        newOption.textContent = 'New group\u2026';
        // With no groups to choose from, creating one is the only useful choice.
        newOption.selected = (groups.length === 0);
        fragment.appendChild(newOption);
        select.textContent = '';
        select.appendChild(fragment);

        modal.node.dataset.index = `${index}`;
        titleNode.textContent = dictionaryTitle;
        newInput.value = '';
        errorNode.hidden = true;
        this._onSetGroupSelectChange();

        modal.setVisible(true);
        if (groups.length === 0) { newInput.focus(); }
    }

    /**
     * @param {string} name
     * @returns {Element}
     */
    instantiateTemplate(name) {
        return this._settingsController.instantiateTemplate(name);
    }

    /**
     * @param {string} name
     * @returns {DocumentFragment}
     */
    instantiateTemplateFragment(name) {
        return this._settingsController.instantiateTemplateFragment(name);
    }

    /** */
    async updateDictionariesEnabled() {
        const options = await this._settingsController.getOptions();
        this._updateDictionariesEnabledWarnings(options);
    }

    /**
     * @param {string} name
     * @param {boolean} enabled
     * @param {string} styles
     * @returns {import('settings').DictionaryOptions}
     */
    static createDefaultDictionarySettings(name, enabled, styles) {
        return {
            name,
            alias: name,
            enabled,
            allowSecondarySearches: false,
            definitionsCollapsible: 'not-collapsible',
            partsOfSpeechFilter: true,
            useDeinflections: true,
            group: UNGROUPED_NAME,
            fallbackOnly: false,
            styles: styles ?? '',
        };
    }

    /**
     * @param {import('./settings-controller.js').SettingsController} settingsController
     * @param {import('dictionary-importer').Summary[]|undefined} dictionaries
     * @param {import('settings').Options|undefined} optionsFull
     * @param {boolean} modifyGlobalSettings
     * @param {boolean} newDictionariesEnabled
     */
    static async ensureDictionarySettings(settingsController, dictionaries, optionsFull, modifyGlobalSettings, newDictionariesEnabled) {
        if (typeof dictionaries === 'undefined') {
            dictionaries = await settingsController.getDictionaryInfo();
        }
        if (typeof optionsFull === 'undefined') {
            optionsFull = await settingsController.getOptionsFull();
        }

        /** @type {import('settings-modifications').Modification[]} */
        const targets = [];
        const {profiles} = optionsFull;
        for (let i = 0, ii = profiles.length; i < ii; ++i) {
            let modified = false;
            const missingDictionaries = [...dictionaries];
            const dictionaryOptionsArray = profiles[i].options.dictionaries;
            for (let j = dictionaryOptionsArray.length - 1; j >= 0; --j) {
                const {name} = dictionaryOptionsArray[j];
                const missingDictionariesNameIndex = missingDictionaries.findIndex((x) => x.title === name);
                if (missingDictionariesNameIndex !== -1) {
                    missingDictionaries.splice(missingDictionariesNameIndex, 1);
                } else {
                    dictionaryOptionsArray.splice(j, 1);
                    modified = true;
                }
            }

            for (const {title, styles} of missingDictionaries) {
                const value = DictionaryController.createDefaultDictionarySettings(title, newDictionariesEnabled, styles);
                dictionaryOptionsArray.push(value);
                modified = true;
            }

            // Keep every dictionary group contiguous (e.g. new dictionaries join the ungrouped block).
            if (sortDictionariesByGroup(dictionaryOptionsArray, profiles[i].options.dictionaryGroups)) {
                modified = true;
            }

            if (modified) {
                targets.push({
                    action: 'set',
                    path: `profiles[${i}].options.dictionaries`,
                    value: dictionaryOptionsArray,
                });
            }
        }

        if (modifyGlobalSettings && targets.length > 0) {
            await settingsController.modifyGlobalSettings(targets);
        }
    }

    // Private

    /**
     * @param {import('settings-controller').EventArgument<'optionsChanged'>} details
     */
    _onOptionsChanged({options}) {
        this._updateDictionariesEnabledWarnings(options);
        if (this._dictionaries !== null) {
            void this._updateEntries();
        }
    }

    /** */
    async _onDatabaseUpdated() {
        /** @type {?import('core').TokenObject} */
        const token = {};
        this._databaseStateToken = token;
        this._dictionaries = null;
        const dictionaries = await this._settingsController.getDictionaryInfo();
        if (this._databaseStateToken !== token) { return; }
        this._dictionaries = dictionaries;

        await this._updateEntries();

        if (this._onDictionariesUpdate) {
            this._onDictionariesUpdate();
        }
    }

    /** */
    _onAllCheckboxChange() {
        const allCheckbox = /** @type {HTMLInputElement} */ (this._allCheckbox);
        const value = allCheckbox.checked;
        allCheckbox.checked = !value;
        void this._setAllDictionariesEnabled(value);
    }

    /** */
    async _updateEntries() {
        const dictionaries = this._dictionaries;
        if (dictionaries === null) { return; }
        this._updateMainDictionarySelectOptions(dictionaries);

        /** @type {Map<string, string | null>} */
        const dictionaryUpdateDownloadUrlMap = new Map();
        for (const entry of this._dictionaryEntries) {
            dictionaryUpdateDownloadUrlMap.set(entry.dictionaryTitle, entry.updateDownloadUrl);
            entry.cleanup();
        }
        this._dictionaryEntries = [];
        this._updateDictionaryEntryCount();

        if (this._dictionaryInstallCountNode !== null) {
            this._dictionaryInstallCountNode.textContent = `${dictionaries.length}`;
        }

        const hasDictionary = (dictionaries.length > 0);
        for (const node of /** @type {NodeListOf<HTMLElement>} */ (this._noDictionariesInstalledWarnings)) {
            node.hidden = hasDictionary;
        }

        await DictionaryController.ensureDictionarySettings(this._settingsController, dictionaries, void 0, true, false);

        const options = await this._settingsController.getOptions();
        if (sortDictionariesByGroup(options.dictionaries, options.dictionaryGroups)) {
            await this._settingsController.modifyProfileSettings([{
                action: 'set',
                path: 'dictionaries',
                value: options.dictionaries,
            }]);
        }

        this._createEntries(dictionaries, options, dictionaryUpdateDownloadUrlMap, new Map());
        this._updateDictionariesEnabledWarnings(options);
    }

    /**
     * @param {import('settings').ProfileOptions} options
     */
    _updateCurrentEntries(options) {
        const dictionariesModalBodyScrollY = this._dictionaryModalBody.scrollTop;
        const dictionaries = this._dictionaries;
        if (dictionaries === null) { return; }

        for (const dictionaryEntry of this._dictionaryEntries) {
            dictionaryEntry.cleanup();
        }

        /** @type {Map<string, string | null>} */
        const dictionaryUpdateDownloadUrlMap = new Map();
        /** @type {Map<string, import('dictionary-database').DictionaryCountGroup | null>} */
        const dictionaryDatabaseCountsMap = new Map();
        for (const entry of this._dictionaryEntries) {
            dictionaryUpdateDownloadUrlMap.set(entry.dictionaryTitle, entry.updateDownloadUrl);
            dictionaryDatabaseCountsMap.set(entry.dictionaryTitle, entry.databaseCounts);
            entry.cleanup();
        }

        this._createEntries(dictionaries, options, dictionaryUpdateDownloadUrlMap, dictionaryDatabaseCountsMap);
        this._dictionaryModalBody.scroll({top: dictionariesModalBodyScrollY});
    }

    /**
     * Rebuilds the dictionary list, including the group headers when groups are in use.
     * `options.dictionaries` must already be sorted by group.
     * @param {import('dictionary-importer').Summary[]} dictionaries
     * @param {import('settings').ProfileOptions} options
     * @param {Map<string, string | null>} dictionaryUpdateDownloadUrlMap
     * @param {Map<string, import('dictionary-database').DictionaryCountGroup | null>} dictionaryDatabaseCountsMap
     */
    _createEntries(dictionaries, options, dictionaryUpdateDownloadUrlMap, dictionaryDatabaseCountsMap) {
        for (const entry of this._dictionaryEntries) {
            entry.cleanup();
        }
        this._dictionaryEntries = [];
        this._cleanupGroupHeaders();

        /** @type {Map<string, import('dictionary-importer').Summary>} */
        const dictionaryInfoMap = new Map();
        for (const dictionary of dictionaries) {
            dictionaryInfoMap.set(dictionary.title, dictionary);
        }

        const dictionaryOptionsArray = options.dictionaries;
        const groups = normalizeDictionaryGroups(options.dictionaryGroups);
        /** @type {Map<string, boolean>} */
        const collapsedGroups = new Map();
        for (let i = 0, ii = groups.length; i < ii; ++i) {
            collapsedGroups.set(groups[i].name, groups[i].collapsed);
        }

        let groupIndex = 0;
        const createHeadersUntil = (/** @type {number} */ endIndex) => {
            for (; groupIndex < endIndex; ++groupIndex) {
                this._createGroupHeader(groups[groupIndex], groupIndex, groups.length);
            }
        };

        for (let i = 0, ii = dictionaryOptionsArray.length; i < ii; ++i) {
            const {name, group} = dictionaryOptionsArray[i];
            if (groups.length > 0) {
                // Headers are created lazily so that empty groups still show up in their place.
                const index = groups.findIndex((g) => g.name === group);
                createHeadersUntil(index + 1);
            }
            const dictionaryInfo = dictionaryInfoMap.get(name);
            if (typeof dictionaryInfo === 'undefined') { continue; }
            const updateDownloadUrl = dictionaryUpdateDownloadUrlMap.get(name) ?? null;
            const dictionaryDatabaseCounts = dictionaryDatabaseCountsMap.get(name) ?? null;
            const hidden = (collapsedGroups.get(group) === true);
            const entry = this._createDictionaryEntry(i, dictionaryInfo, updateDownloadUrl, dictionaryDatabaseCounts, group, hidden);
            entry.setFallbackOnly(dictionaryOptionsArray[i].fallbackOnly === true);
        }
        createHeadersUntil(groups.length);

        this._updateDictionaryEntryCount();
        this._updateGroupHeaders(options);
    }

    /**
     * @param {import('settings').ProfileOptions} options
     */
    _updateDictionariesEnabledWarnings(options) {
        const {dictionaries} = options;
        let enabledDictionaryCountValid = 0;
        let enabledDictionaryCount = 0;
        const dictionaryCount = dictionaries.length;
        if (this._dictionaries !== null) {
            const enabledDictionaries = new Set();
            for (const {name, enabled} of dictionaries) {
                if (enabled) {
                    ++enabledDictionaryCount;
                    enabledDictionaries.add(name);
                }
            }

            for (const {title} of this._dictionaries) {
                if (enabledDictionaries.has(title)) {
                    ++enabledDictionaryCountValid;
                }
            }
        }

        const hasEnabledDictionary = (enabledDictionaryCountValid > 0);
        if (hasEnabledDictionary) {
            this._settingsController.trigger('dictionaryEnabled', {});
        }
        for (const node of /** @type {NodeListOf<HTMLElement>} */ (this._noDictionariesEnabledWarnings)) {
            node.hidden = hasEnabledDictionary;
        }

        if (this._dictionaryEnabledCountNode !== null) {
            this._dictionaryEnabledCountNode.textContent = `${enabledDictionaryCountValid}`;
        }

        /** @type {HTMLInputElement} */ (this._allCheckbox).checked = (enabledDictionaryCount >= dictionaryCount);

        const entries = this._dictionaryEntries;
        for (let i = 0, ii = Math.min(entries.length, dictionaryCount); i < ii; ++i) {
            entries[i].setEnabled(dictionaries[i].enabled);
        }

        this._updateGroupHeaders(options);
    }

    /**
     * @param {MouseEvent} e
     */
    _onDictionaryConfirmDelete(e) {
        e.preventDefault();

        const modal = /** @type {import('./modal.js').Modal} */ (this._deleteDictionaryModal);
        modal.setVisible(false);

        const dictionaryTitle = modal.node.dataset.dictionaryTitle;
        if (typeof dictionaryTitle !== 'string') { return; }
        delete modal.node.dataset.dictionaryTitle;

        void this._enqueueTask({type: 'delete', dictionaryTitle});
        this._hideUpdatesAvailableButton(dictionaryTitle);
    }

    /**
     * @param {MouseEvent} e
     */
    _onDictionaryConfirmUpdate(e) {
        e.preventDefault();

        const modal = /** @type {import('./modal.js').Modal} */ (this._updateDictionaryModal);
        modal.setVisible(false);

        const dictionaryTitle = modal.node.dataset.dictionaryTitle;
        const downloadUrl = modal.node.dataset.downloadUrl;
        if (typeof dictionaryTitle !== 'string') { return; }
        delete modal.node.dataset.dictionaryTitle;

        void this._enqueueTask({type: 'update', dictionaryTitle, downloadUrl});
        this._hideUpdatesAvailableButton(dictionaryTitle);
    }

    /**
     * @param {string} dictionaryTitle
     */
    _hideUpdatesAvailableButton(dictionaryTitle) {
        for (const entry of this._dictionaryEntries) {
            if (entry.dictionaryTitle === dictionaryTitle) {
                entry.hideUpdatesAvailableButton();
                break;
            }
        }
    }

    /**
     * @param {MouseEvent} e
     */
    _onCheckIntegrityButtonClick(e) {
        e.preventDefault();
        void this._checkIntegrity();
    }

    /**
     * @param {MouseEvent} e
     */
    _onCheckUpdatesButtonClick(e) {
        e.preventDefault();
        void this._checkForUpdates();
    }

    /** */
    _onDictionaryMoveButtonClick() {
        const modal = /** @type {import('./modal.js').Modal} */ (this._modalController.getModal('dictionary-move-location'));
        const index = modal.node.dataset.index ?? '';
        const indexNumber = Number.parseInt(index, 10);
        if (Number.isNaN(indexNumber)) { return; }

        /** @type {HTMLInputElement} */
        const targetStringInput = querySelectorNotNull(document, '#dictionary-move-location');
        const targetString = targetStringInput.value;
        const target = Number.parseInt(targetString, 10) - 1;

        if (!Number.isFinite(target) || !Number.isFinite(indexNumber) || indexNumber === target) { return; }

        void this.moveDictionaryOptions(indexNumber, target);
    }

    /** */
    _onDictionaryResetAliasButtonClick() {
        const modal = /** @type {import('./modal.js').Modal} */ (this._modalController.getModal('dictionary-set-alias'));
        const index = modal.node.dataset.index ?? '';
        const indexNumber = Number.parseInt(index, 10);
        if (Number.isNaN(indexNumber)) { return; }

        /** @type {HTMLInputElement} */
        const input = querySelectorNotNull(modal.node, '#dictionary-alias-input');
        input.value = this._dictionaryEntries[indexNumber].dictionaryTitle;
    }

    /** */
    _onDictionarySetAliasButtonClick() {
        const modal = /** @type {import('./modal.js').Modal} */ (this._modalController.getModal('dictionary-set-alias'));
        const index = modal.node.dataset.index ?? '';
        const indexNumber = Number.parseInt(index, 10);
        if (Number.isNaN(indexNumber)) { return; }

        /** @type {HTMLInputElement} */
        const input = querySelectorNotNull(modal.node, '#dictionary-alias-input');
        const inputValue = input.value.trim();
        if (inputValue) {
            this._dictionaryEntries[indexNumber].updateAliasSettings(inputValue);
        }
    }

    /**
     * @param {import('dictionary-importer').Summary[]} dictionaries
     */
    _updateMainDictionarySelectOptions(dictionaries) {
        for (const select of document.querySelectorAll('[data-setting="general.mainDictionary"]')) {
            const fragment = document.createDocumentFragment();

            let option = document.createElement('option');
            option.className = 'text-muted';
            option.value = '';
            option.textContent = 'Not selected';
            fragment.appendChild(option);

            for (const {title, sequenced} of dictionaries) {
                if (!sequenced) { continue; }
                option = document.createElement('option');
                option.value = title;
                option.textContent = title;
                fragment.appendChild(option);
            }

            select.textContent = ''; // Empty
            select.appendChild(fragment);
        }
    }

    /** */
    async _checkForUpdates() {
        if (this._dictionaries === null || this._checkingIntegrity || this._checkingUpdates || this._isTaskQueueRunning) { return; }
        let hasUpdates;
        try {
            this._checkingUpdates = true;
            this._setButtonsEnabled(false);

            const updateChecks = this._dictionaryEntries.map((entry) => entry.checkForUpdate());
            const updateCount = (await Promise.all(updateChecks)).reduce((sum, value) => (sum + (value ? 1 : 0)), 0);
            if (this._checkUpdatesButton !== null) {
                hasUpdates = !!updateCount;
                this._checkUpdatesButton.textContent = hasUpdates ? `${updateCount} update${updateCount > 1 ? 's' : ''}` : 'No updates';
            }
        } finally {
            this._setButtonsEnabled(true);
            if (this._checkUpdatesButton !== null && !hasUpdates) {
                this._checkUpdatesButton.disabled = true;
            }
            this._checkingUpdates = false;
        }
    }

    /** */
    async _checkIntegrity() {
        if (this._dictionaries === null || this._checkingIntegrity || this._checkingUpdates || this._isTaskQueueRunning) { return; }

        try {
            this._checkingIntegrity = true;
            this._setButtonsEnabled(false);

            const token = this._databaseStateToken;
            const dictionaryTitles = this._dictionaryEntries.map(({dictionaryTitle}) => dictionaryTitle);
            const {counts, total} = await new DictionaryWorker().getDictionaryCounts(dictionaryTitles, true);
            if (this._databaseStateToken !== token) { return; }

            for (let i = 0, ii = Math.min(counts.length, this._dictionaryEntries.length); i < ii; ++i) {
                const entry = this._dictionaryEntries[i];
                entry.setCounts(counts[i]);
            }

            this._setCounts(counts, /** @type {import('dictionary-database').DictionaryCountGroup} */ (total));
        } finally {
            this._setButtonsEnabled(true);
            this._checkingIntegrity = false;
        }
    }

    /**
     * @param {import('dictionary-database').DictionaryCountGroup[]} dictionaryCounts
     * @param {import('dictionary-database').DictionaryCountGroup} totalCounts
     */
    _setCounts(dictionaryCounts, totalCounts) {
        const remainders = Object.assign({}, totalCounts);
        const keys = Object.keys(remainders);

        for (const counts of dictionaryCounts) {
            for (const key of keys) {
                remainders[key] -= counts[key];
            }
        }

        let totalRemainder = 0;
        for (const key of keys) {
            totalRemainder += remainders[key];
        }

        if (this._extraInfo !== null) {
            this._extraInfo.cleanup();
            this._extraInfo = null;
        }

        if (totalRemainder > 0 && this._dictionaryEntryContainer !== null) {
            this._extraInfo = new DictionaryExtraInfo(this, totalCounts, remainders, totalRemainder);
            this._extraInfo.prepare(this._dictionaryEntryContainer);
        }
    }

    /**
     * @param {number} index
     * @param {import('dictionary-importer').Summary} dictionaryInfo
     * @param {string|null} updateDownloadUrl
     * @param {import('dictionary-database').DictionaryCountGroup|null} dictionaryDatabaseCounts
     * @param {string} groupName
     * @param {boolean} hidden
     * @returns {DictionaryEntry}
     */
    _createDictionaryEntry(index, dictionaryInfo, updateDownloadUrl, dictionaryDatabaseCounts, groupName, hidden) {
        const fragment = this.instantiateTemplateFragment('dictionary');

        const entry = new DictionaryEntry(this, fragment, index, dictionaryInfo, updateDownloadUrl, dictionaryDatabaseCounts);
        this._dictionaryEntries.push(entry);
        entry.prepare(groupName, hidden);

        const container = /** @type {HTMLElement} */ (this._dictionaryEntryContainer);
        const relative = container.querySelector('.dictionary-item-bottom');
        container.insertBefore(fragment, relative);

        this._updateDictionaryEntryCount();
        return entry;
    }

    /**
     * @param {number} index
     * @param {boolean} value
     */
    async setDictionaryFallbackOnly(index, value) {
        await this._settingsController.modifyProfileSettings([{action: 'set', path: `dictionaries[${index}].fallbackOnly`, value}]);
        this._onDictionaryFallbackOnlyChanged(index, value);
    }

    /**
     * @param {number} index
     * @param {boolean} value
     */
    _onDictionaryFallbackOnlyChanged(index, value) {
        const entry = this._dictionaryEntries.find((e) => e.index === index);
        if (typeof entry !== 'undefined') { entry.setFallbackOnly(value); }
    }


    /**
     * @param {string} dictionaryTitle
     * @returns {boolean}
     */
    isDictionaryInTaskQueue(dictionaryTitle) {
        return this._dictionaryTaskQueue.some((task) => task.dictionaryTitle === dictionaryTitle);
    }

    /**
     * @param {import('dictionary-controller.js').DictionaryTask} task
     */
    _enqueueTask(task) {
        if (this.isDictionaryInTaskQueue(task.dictionaryTitle)) { return; }
        this._dictionaryTaskQueue.push(task);
        void this._runTaskQueue();
    }


    /** */
    async _runTaskQueue() {
        if (this._isTaskQueueRunning) { return; }
        this._isTaskQueueRunning = true;
        while (this._dictionaryTaskQueue.length > 0) {
            const task = this._dictionaryTaskQueue[0];
            if (task.type === 'delete') {
                await this._deleteDictionary(task.dictionaryTitle);
            } else if (task.type === 'update') {
                await this._updateDictionary(task.dictionaryTitle, task.downloadUrl);
            }
            void this._dictionaryTaskQueue.shift();
        }
        this._isTaskQueueRunning = false;
    }

    /**
     * @param {string} dictionaryTitle
     */
    async _deleteDictionary(dictionaryTitle) {
        if (this._checkingIntegrity) { return; }

        const index = this._dictionaryEntries.findIndex((entry) => entry.dictionaryTitle === dictionaryTitle);
        if (index < 0) { return; }

        const statusFooter = this._statusFooter;
        const progressSelector = '.dictionary-delete-progress';
        const progressContainers = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(`#dictionaries-modal ${progressSelector}`));
        const progressBars = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(`${progressSelector} .progress-bar`));
        const infoLabels = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(`${progressSelector} .progress-info`));
        const statusLabels = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(`${progressSelector} .progress-status`));
        const prevention = this._settingsController.preventPageExit();
        try {
            this._setButtonsEnabled(false);

            /**
             * @param {import('dictionary-database').DeleteDictionaryProgressData} details
             */
            const onProgress = ({processed, count, storeCount, storesProcesed}) => {
                const percent = (
                    (count > 0 && storesProcesed > 0) ?
                    (processed / count) * (storesProcesed / storeCount) * 100 :
                    0
                );
                const cssString = `${percent}%`;
                const statusString = `${percent.toFixed(0)}%`;
                for (const progressBar of progressBars) { progressBar.style.width = cssString; }
                for (const label of statusLabels) { label.textContent = statusString; }
            };

            onProgress({processed: 0, count: 1, storeCount: 1, storesProcesed: 0});

            for (const progress of progressContainers) { progress.hidden = false; }
            for (const label of infoLabels) { label.textContent = 'Deleting dictionary...'; }
            if (statusFooter !== null) { statusFooter.setTaskActive(progressSelector, true); }

            await this._deleteDictionaryInternal(dictionaryTitle, onProgress);
            await this._deleteDictionarySettings(dictionaryTitle);
        } catch (e) {
            log.error(e);
        } finally {
            prevention.end();
            for (const progress of progressContainers) { progress.hidden = true; }
            if (statusFooter !== null) { statusFooter.setTaskActive(progressSelector, false); }
            this._setButtonsEnabled(true);
            this._triggerStorageChanged();
        }
    }

    /**
     * @param {string} dictionaryTitle
     * @param {string|undefined} downloadUrl
     */
    async _updateDictionary(dictionaryTitle, downloadUrl) {
        if (this._checkingIntegrity || this._checkingUpdates || this._dictionaries === null) { return; }

        const dictionaryInfo = this._dictionaries.find((entry) => entry.title === dictionaryTitle);
        if (typeof dictionaryInfo === 'undefined') { throw new Error('Dictionary not found'); }
        downloadUrl = downloadUrl ?? dictionaryInfo.downloadUrl;
        if (typeof downloadUrl !== 'string') { throw new Error('Attempted to update dictionary without download URL'); }

        const options = await this._settingsController.getOptionsFull();
        const {profiles} = options;

        /** @type {import('settings-controller.js').ProfilesDictionarySettings} */
        const profilesDictionarySettings = {};

        for (const profile of profiles) {
            const dictionaries = profile.options.dictionaries;
            for (let i = 0; i < dictionaries.length; ++i) {
                if (dictionaries[i].name === dictionaryTitle) {
                    profilesDictionarySettings[profile.id] = {...dictionaries[i], index: i};
                    break;
                }
            }
        }

        await this._deleteDictionary(dictionaryTitle);
        /** @type {import('core').DeferredPromiseDetails<void>} */
        const {promise: importPromise, resolve} = deferPromise();
        this._settingsController.trigger('importDictionaryFromUrl', {url: downloadUrl, profilesDictionarySettings, onImportDone: resolve});
        await importPromise;
    }

    /**
     * @param {boolean} value
     */
    _setButtonsEnabled(value) {
        value = !value;
        for (const node of /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('.dictionary-database-mutating-input'))) {
            node.disabled = value;
        }
    }

    /**
     * @param {string} dictionaryTitle
     * @param {import('dictionary-worker').DeleteProgressCallback} onProgress
     */
    async _deleteDictionaryInternal(dictionaryTitle, onProgress) {
        await new DictionaryWorker().deleteDictionary(dictionaryTitle, onProgress);
        /** @type {import('core').DeferredPromiseDetails<void>} */
        const {promise: dictionariesUpdatePromise, resolve} = deferPromise();
        this._onDictionariesUpdate = resolve;
        void this._settingsController.application.api.triggerDatabaseUpdated('dictionary', 'delete');
        await dictionariesUpdatePromise;
        this._onDictionariesUpdate = null;
    }

    /**
     * @param {string} dictionaryTitle
     */
    async _deleteDictionarySettings(dictionaryTitle) {
        const optionsFull = await this._settingsController.getOptionsFull();
        const {profiles} = optionsFull;
        /** @type {import('settings-modifications').Modification[]} */
        const targets = [];
        for (let i = 0, ii = profiles.length; i < ii; ++i) {
            const {options: {dictionaries}} = profiles[i];
            for (let j = 0, jj = dictionaries.length; j < jj; ++j) {
                if (dictionaries[j].name !== dictionaryTitle) { continue; }
                const path = `profiles[${i}].options.dictionaries`;
                targets.push({
                    action: 'splice',
                    path,
                    start: j,
                    deleteCount: 1,
                    items: [],
                });
            }
        }
        await this._settingsController.modifyGlobalSettings(targets);
    }

    /** */
    _triggerStorageChanged() {
        this._settingsController.application.triggerStorageChanged();
    }

    /** */
    _updateDictionaryEntryCount() {
        /** @type {HTMLElement} */ (this._dictionaryEntryContainer).dataset.count = `${this._dictionaryEntries.length}`;
    }

    /**
     * @param {boolean} value
     */
    async _setAllDictionariesEnabled(value) {
        const options = await this._settingsController.getOptions();
        const {dictionaries} = options;

        /** @type {import('settings-modifications').Modification[]} */
        const targets = [];
        for (let i = 0, ii = dictionaries.length; i < ii; ++i) {
            targets.push({
                action: 'set',
                path: `dictionaries[${i}].enabled`,
                value,
            });
        }
        await this._settingsController.modifyProfileSettings(targets);

        await this.updateDictionariesEnabled();
    }

    // Dictionary groups

    /** */
    _prepareGroups() {
        /** @type {?HTMLButtonElement} */
        const addGroupButton = document.querySelector('#dictionary-add-group-button');
        if (addGroupButton !== null) {
            addGroupButton.addEventListener('click', () => { this._showGroupNameModal(null); }, false);
        }

        /** @type {?HTMLButtonElement} */
        const groupNameButton = document.querySelector('#dictionary-group-name-button');
        /** @type {?HTMLInputElement} */
        const groupNameInput = document.querySelector('#dictionary-group-name-input');
        if (groupNameButton !== null && groupNameInput !== null) {
            groupNameButton.addEventListener('click', () => { void this._onGroupNameConfirm(); }, false);
            groupNameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.isComposing) { void this._onGroupNameConfirm(); }
            }, false);
        }

        /** @type {?HTMLSelectElement} */
        const setGroupSelect = document.querySelector('#dictionary-set-group-select');
        /** @type {?HTMLButtonElement} */
        const setGroupButton = document.querySelector('#dictionary-set-group-button');
        /** @type {?HTMLInputElement} */
        const setGroupNewInput = document.querySelector('#dictionary-set-group-new-input');
        if (setGroupSelect !== null && setGroupButton !== null && setGroupNewInput !== null) {
            setGroupSelect.addEventListener('change', this._onSetGroupSelectChange.bind(this), false);
            setGroupButton.addEventListener('click', () => { void this._onSetGroupConfirm(); }, false);
            setGroupNewInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.isComposing) { void this._onSetGroupConfirm(); }
            }, false);
        }

        const container = this._dictionaryEntryContainer;
        container.addEventListener('dragstart', this._onDragStart.bind(this), false);
        container.addEventListener('dragover', this._onDragOver.bind(this), false);
        container.addEventListener('dragleave', this._onDragLeave.bind(this), false);
        container.addEventListener('drop', this._onDrop.bind(this), false);
        container.addEventListener('dragend', this._onDragEnd.bind(this), false);
    }

    /**
     * Normalizes and saves the group list and the dictionary order, then redraws the list.
     * @param {import('settings').ProfileOptions} options A local copy of the options, whose `dictionaries` may have been modified.
     * @param {import('settings').DictionaryGroupOptions[]} groups
     */
    async _saveDictionaryLayout(options, groups) {
        options.dictionaryGroups = normalizeDictionaryGroups(groups);
        sortDictionariesByGroup(options.dictionaries, options.dictionaryGroups);

        await this._settingsController.modifyProfileSettings([
            {action: 'set', path: 'dictionaryGroups', value: options.dictionaryGroups},
            {action: 'set', path: 'dictionaries', value: options.dictionaries},
        ]);

        /** @type {import('settings-controller').EventArgument<'dictionarySettingsReordered'>} */
        const event = {source: this};
        this._settingsController.trigger('dictionarySettingsReordered', event);

        this._updateCurrentEntries(options);
    }

    /**
     * @param {string} name
     * @param {import('settings').DictionaryGroupOptions[]} groups
     * @param {?string} ignoreName A name which is allowed to be reused (the group being renamed).
     * @returns {?string} An error message, or `null` if the name is valid.
     */
    _validateGroupName(name, groups, ignoreName) {
        if (name.length === 0) { return 'The group name can\u2019t be empty.'; }
        if (name.toLowerCase() === UNGROUPED_LABEL.toLowerCase()) { return `\u201c${UNGROUPED_LABEL}\u201d is reserved for dictionaries without a group.`; }
        if (name !== ignoreName && groups.some((group) => group.name === name)) { return 'A group with this name already exists.'; }
        return null;
    }

    /** */
    _cleanupGroupHeaders() {
        this._groupHeaderEventListeners.removeAllEventListeners();
        for (const {node} of this._groupHeaders) {
            if (node.parentNode !== null) { node.parentNode.removeChild(node); }
        }
        this._groupHeaders = [];
    }

    /**
     * @param {import('settings').DictionaryGroupOptions} group
     * @param {number} groupIndex
     * @param {number} groupCount
     */
    _createGroupHeader(group, groupIndex, groupCount) {
        const {name, collapsed} = group;
        const isUngrouped = (name === UNGROUPED_NAME);
        const node = /** @type {HTMLElement} */ (this.instantiateTemplate('dictionary-group-header'));
        /** @type {HTMLButtonElement} */
        const collapseButton = querySelectorNotNull(node, '.dictionary-group-collapse-button');
        /** @type {HTMLInputElement} */
        const checkbox = querySelectorNotNull(node, '.dictionary-group-enabled');
        /** @type {HTMLElement} */
        const nameNode = querySelectorNotNull(node, '.dictionary-group-name');
        /** @type {HTMLElement} */
        const countNode = querySelectorNotNull(node, '.dictionary-group-count');
        /** @type {HTMLButtonElement} */
        const upButton = querySelectorNotNull(node, '.dictionary-group-move-up');
        /** @type {HTMLButtonElement} */
        const downButton = querySelectorNotNull(node, '.dictionary-group-move-down');
        /** @type {HTMLButtonElement} */
        const menuButton = querySelectorNotNull(node, '.dictionary-group-menu-button');

        node.dataset.groupName = name;
        node.dataset.collapsed = `${collapsed}`;
        node.dataset.ungrouped = `${isUngrouped}`;
        nameNode.textContent = (isUngrouped ? UNGROUPED_LABEL : name);
        const isFirst = (groupIndex <= 0);
        const isLast = (groupIndex >= groupCount - 1);
        upButton.disabled = isFirst;
        downButton.disabled = isLast;

        const listeners = this._groupHeaderEventListeners;
        listeners.addEventListener(collapseButton, 'click', () => { void this._setGroupCollapsed(name, !collapsed); }, false);
        listeners.addEventListener(checkbox, 'change', () => { void this._setGroupEnabled(name, checkbox.checked); }, false);
        listeners.addEventListener(upButton, 'click', () => { void this._moveGroup(name, groupIndex - 1); }, false);
        listeners.addEventListener(downButton, 'click', () => { void this._moveGroup(name, groupIndex + 1); }, false);
        listeners.addEventListener(menuButton, 'menuOpen', (/** @type {import('popup-menu').MenuOpenEvent} */ e) => {
            const bodyNode = e.detail.menu.bodyNode;
            /** @type {[action: string, enabled: boolean][]} */
            const actions = [
                ['rename', !isUngrouped],
                ['delete', !isUngrouped],
                ['moveToTop', !isFirst],
                ['moveToBottom', !isLast],
            ];
            for (const [action, enabled] of actions) {
                const element = /** @type {?HTMLButtonElement} */ (bodyNode.querySelector(`[data-menu-action="${action}"]`));
                if (element !== null) { element.disabled = !enabled; }
            }
        }, false);
        listeners.addEventListener(menuButton, 'menuClose', (/** @type {import('popup-menu').MenuCloseEvent} */ e) => {
            switch (e.detail.action) {
                case 'rename': this._showGroupNameModal(name); break;
                case 'moveToTop': void this._moveGroup(name, 0); break;
                case 'moveToBottom': void this._moveGroup(name, groupCount - 1); break;
                case 'enableAll': void this._setGroupEnabled(name, true); break;
                case 'disableAll': void this._setGroupEnabled(name, false); break;
                case 'delete': void this._deleteGroup(name); break;
            }
        }, false);

        const container = this._dictionaryEntryContainer;
        container.insertBefore(node, container.querySelector('.dictionary-item-bottom'));
        this._groupHeaders.push({name, node, checkbox, countNode});
    }

    /**
     * Updates the counts and the enable toggle of every group header.
     * @param {import('settings').ProfileOptions} options
     */
    _updateGroupHeaders(options) {
        for (const {name, checkbox, countNode} of this._groupHeaders) {
            let count = 0;
            let enabledCount = 0;
            for (const {group, enabled} of options.dictionaries) {
                if (group !== name) { continue; }
                ++count;
                if (enabled) { ++enabledCount; }
            }
            countNode.textContent = (count > 0 ? `(${enabledCount} of ${count} enabled)` : '(empty)');
            checkbox.checked = (count > 0 && enabledCount >= count);
            checkbox.disabled = (count === 0);
        }
    }

    /**
     * @param {string} name
     * @param {boolean} collapsed
     */
    async _setGroupCollapsed(name, collapsed) {
        const options = await this._settingsController.getOptions();
        const groups = normalizeDictionaryGroups(options.dictionaryGroups);
        const group = groups.find((g) => g.name === name);
        if (typeof group === 'undefined') { return; }
        group.collapsed = collapsed;
        await this._saveDictionaryLayout(options, groups);
    }

    /**
     * @param {string} name
     * @param {boolean} value
     */
    async _setGroupEnabled(name, value) {
        const options = await this._settingsController.getOptions();
        const {dictionaries} = options;
        /** @type {import('settings-modifications').Modification[]} */
        const targets = [];
        for (let i = 0, ii = dictionaries.length; i < ii; ++i) {
            if (dictionaries[i].group !== name) { continue; }
            targets.push({action: 'set', path: `dictionaries[${i}].enabled`, value});
        }
        if (targets.length > 0) {
            await this._settingsController.modifyProfileSettings(targets);
        }
        await this.updateDictionariesEnabled();
    }

    /**
     * Moves a group (and therefore the priority of all of its dictionaries) to a new position.
     * @param {string} name
     * @param {number} targetIndex
     */
    async _moveGroup(name, targetIndex) {
        const options = await this._settingsController.getOptions();
        const groups = normalizeDictionaryGroups(options.dictionaryGroups);
        const index = groups.findIndex((g) => g.name === name);
        targetIndex = Math.max(0, Math.min(groups.length - 1, targetIndex));
        if (index < 0 || index === targetIndex) { return; }
        const group = groups.splice(index, 1)[0];
        groups.splice(targetIndex, 0, group);
        await this._saveDictionaryLayout(options, groups);
    }

    /**
     * Deletes a group. Its dictionaries are kept and become ungrouped.
     * @param {string} name
     */
    async _deleteGroup(name) {
        if (name === UNGROUPED_NAME) { return; }
        const options = await this._settingsController.getOptions();
        const groups = normalizeDictionaryGroups(options.dictionaryGroups).filter((g) => g.name !== name);
        for (const dictionary of options.dictionaries) {
            if (dictionary.group === name) { dictionary.group = UNGROUPED_NAME; }
        }
        await this._saveDictionaryLayout(options, groups);
    }

    /**
     * @param {?string} groupName The group to rename, or `null` to add a new group.
     */
    _showGroupNameModal(groupName) {
        const modal = this._modalController.getModal('dictionary-group-name');
        if (modal === null) { return; }
        /** @type {HTMLElement} */
        const titleNode = querySelectorNotNull(modal.node, '#dictionary-group-name-modal-title');
        /** @type {HTMLInputElement} */
        const input = querySelectorNotNull(modal.node, '#dictionary-group-name-input');
        /** @type {HTMLElement} */
        const errorNode = querySelectorNotNull(modal.node, '#dictionary-group-name-error');

        if (groupName === null) {
            delete modal.node.dataset.groupName;
        } else {
            modal.node.dataset.groupName = groupName;
        }
        titleNode.textContent = (groupName === null ? 'Add Dictionary Group' : 'Rename Dictionary Group');
        input.value = groupName ?? '';
        errorNode.hidden = true;

        modal.setVisible(true);
        input.focus();
        input.select();
    }

    /** */
    async _onGroupNameConfirm() {
        const modal = this._modalController.getModal('dictionary-group-name');
        if (modal === null) { return; }
        /** @type {HTMLInputElement} */
        const input = querySelectorNotNull(modal.node, '#dictionary-group-name-input');
        /** @type {HTMLElement} */
        const errorNode = querySelectorNotNull(modal.node, '#dictionary-group-name-error');

        const oldName = modal.node.dataset.groupName ?? null;
        const newName = input.value.trim();
        const options = await this._settingsController.getOptions();
        const groups = normalizeDictionaryGroups(options.dictionaryGroups);

        const error = this._validateGroupName(newName, groups, oldName);
        if (error !== null) {
            errorNode.textContent = error;
            errorNode.hidden = false;
            return;
        }
        modal.setVisible(false);

        if (oldName === null) {
            // New groups start at the top, where they are immediately visible.
            groups.unshift({name: newName, collapsed: false});
        } else {
            const group = groups.find((g) => g.name === oldName);
            if (typeof group === 'undefined' || oldName === newName) { return; }
            group.name = newName;
            for (const dictionary of options.dictionaries) {
                if (dictionary.group === oldName) { dictionary.group = newName; }
            }
        }
        await this._saveDictionaryLayout(options, groups);
    }

    /** */
    _onSetGroupSelectChange() {
        /** @type {?HTMLSelectElement} */
        const select = document.querySelector('#dictionary-set-group-select');
        /** @type {?HTMLElement} */
        const newContainer = document.querySelector('#dictionary-set-group-new-container');
        if (select === null || newContainer === null) { return; }
        const option = select.selectedOptions.item(0);
        newContainer.hidden = !(option !== null && option.dataset.kind === 'new');
    }

    /** */
    async _onSetGroupConfirm() {
        const modal = this._modalController.getModal('dictionary-set-group');
        if (modal === null) { return; }
        /** @type {HTMLSelectElement} */
        const select = querySelectorNotNull(modal.node, '#dictionary-set-group-select');
        /** @type {HTMLInputElement} */
        const newInput = querySelectorNotNull(modal.node, '#dictionary-set-group-new-input');
        /** @type {HTMLElement} */
        const errorNode = querySelectorNotNull(modal.node, '#dictionary-set-group-error');

        const index = Number.parseInt(modal.node.dataset.index ?? '', 10);
        const selectedOption = select.selectedOptions.item(0);
        if (Number.isNaN(index) || selectedOption === null) { return; }

        const options = await this._settingsController.getOptions();
        const {dictionaries} = options;
        const groups = normalizeDictionaryGroups(options.dictionaryGroups);
        if (index < 0 || index >= dictionaries.length) { return; }

        let groupName = selectedOption.value;
        if (selectedOption.dataset.kind === 'new') {
            groupName = newInput.value.trim();
            const error = this._validateGroupName(groupName, groups, null);
            if (error !== null) {
                errorNode.textContent = error;
                errorNode.hidden = false;
                return;
            }
            groups.unshift({name: groupName, collapsed: false});
        }
        modal.setVisible(false);

        const item = dictionaries[index];
        if (item.group === groupName) { return; }
        // Append to the end of the target group.
        dictionaries.splice(index, 1);
        item.group = groupName;
        dictionaries.push(item);
        await this._saveDictionaryLayout(options, groups);
    }

    // Drag and drop

    /**
     * @param {EventTarget|null} target
     * @returns {?HTMLElement}
     */
    _getDragNode(target) {
        if (!(target instanceof Element)) { return null; }
        const node = /** @type {?HTMLElement} */ (target.closest('.dictionary-row, .dictionary-group-header'));
        return (node !== null && node.parentNode === this._dictionaryEntryContainer ? node : null);
    }

    /**
     * @param {DragEvent} e
     */
    _onDragStart(e) {
        const node = this._getDragNode(e.target);
        if (node === null || e.dataTransfer === null) { return; }
        if (node.classList.contains('dictionary-row')) {
            const index = Number.parseInt(node.dataset.index ?? '', 10);
            if (Number.isNaN(index)) { return; }
            this._dragState = {type: 'dictionary', index, node};
        } else {
            this._dragState = {type: 'group', name: node.dataset.groupName ?? UNGROUPED_NAME, node};
        }
        e.dataTransfer.effectAllowed = 'move';
        // Firefox requires data to be set for the drag to start.
        e.dataTransfer.setData('text/plain', '');
        // Deferred so that the drag image is captured before the node is dimmed.
        setTimeout(() => {
            if (this._dragState !== null && this._dragState.node === node) { node.dataset.dragSource = 'true'; }
        }, 0);
    }

    /**
     * @param {DragEvent} e
     * @returns {?{node: HTMLElement, position: 'before'|'after'|'into'}}
     */
    _getDropTarget(e) {
        const state = this._dragState;
        const node = this._getDragNode(e.target);
        if (state === null || node === null || node === state.node) { return null; }
        const isHeader = node.classList.contains('dictionary-group-header');
        if (state.type === 'dictionary') {
            if (isHeader) { return {node, position: 'into'}; }
            const rect = node.getBoundingClientRect();
            return {node, position: (e.clientY < rect.top + rect.height / 2 ? 'before' : 'after')};
        }
        // Dragging a group: any row of another group stands for that group.
        const targetName = node.dataset.groupName ?? UNGROUPED_NAME;
        if (targetName === state.name) { return null; }
        const header = this._groupHeaders.find(({name}) => name === targetName);
        return (typeof header !== 'undefined' ? {node: header.node, position: 'into'} : null);
    }

    /**
     * @param {?{node: HTMLElement, position: 'before'|'after'|'into'}} dropTarget
     */
    _setDropIndicator(dropTarget) {
        const previous = this._dropIndicatorNode;
        if (previous !== null && (dropTarget === null || dropTarget.node !== previous)) {
            delete previous.dataset.dropPosition;
        }
        this._dropIndicatorNode = (dropTarget !== null ? dropTarget.node : null);
        if (dropTarget !== null) {
            dropTarget.node.dataset.dropPosition = dropTarget.position;
        }
    }

    /**
     * @param {DragEvent} e
     */
    _onDragOver(e) {
        if (this._dragState === null) { return; }
        const dropTarget = this._getDropTarget(e);
        this._setDropIndicator(dropTarget);
        if (dropTarget === null) { return; }
        e.preventDefault();
        if (e.dataTransfer !== null) { e.dataTransfer.dropEffect = 'move'; }
    }

    /**
     * @param {DragEvent} e
     */
    _onDragLeave(e) {
        const {relatedTarget} = e;
        if (relatedTarget instanceof Node && this._dictionaryEntryContainer.contains(relatedTarget)) { return; }
        this._setDropIndicator(null);
    }

    /**
     * @param {DragEvent} e
     */
    _onDrop(e) {
        const state = this._dragState;
        if (state === null) { return; }
        const dropTarget = this._getDropTarget(e);
        this._endDrag();
        if (dropTarget === null) { return; }
        e.preventDefault();

        const {node, position} = dropTarget;
        const targetGroupName = node.dataset.groupName ?? UNGROUPED_NAME;
        if (state.type === 'group') {
            void this._moveGroupToGroup(state.name, targetGroupName);
        } else if (position === 'into') {
            void this._dropDictionaryIntoGroup(state.index, targetGroupName);
        } else {
            const targetIndex = Number.parseInt(node.dataset.index ?? '', 10);
            if (Number.isNaN(targetIndex)) { return; }
            void this._dropDictionaryNextTo(state.index, targetIndex, position);
        }
    }

    /** */
    _onDragEnd() {
        this._endDrag();
    }

    /** */
    _endDrag() {
        if (this._dragState !== null) {
            delete this._dragState.node.dataset.dragSource;
            this._dragState = null;
        }
        this._setDropIndicator(null);
    }

    /**
     * @param {string} name
     * @param {string} targetName The group whose position the moved group takes.
     */
    async _moveGroupToGroup(name, targetName) {
        const options = await this._settingsController.getOptions();
        const groups = normalizeDictionaryGroups(options.dictionaryGroups);
        const targetIndex = groups.findIndex((g) => g.name === targetName);
        if (targetIndex < 0) { return; }
        await this._moveGroup(name, targetIndex);
    }

    /**
     * Moves a dictionary to the top of a group.
     * @param {number} index
     * @param {string} groupName
     */
    async _dropDictionaryIntoGroup(index, groupName) {
        const options = await this._settingsController.getOptions();
        const {dictionaries} = options;
        const groups = normalizeDictionaryGroups(options.dictionaryGroups);
        if (index < 0 || index >= dictionaries.length || !groups.some((g) => g.name === groupName)) { return; }
        const item = dictionaries.splice(index, 1)[0];
        item.group = groupName;
        // Sorting by group keeps relative order, so the front of the array is the front of the group.
        dictionaries.unshift(item);
        await this._saveDictionaryLayout(options, groups);
    }

    /**
     * Moves a dictionary directly before or after another one, joining that dictionary's group.
     * @param {number} index
     * @param {number} targetIndex
     * @param {'before'|'after'} position
     */
    async _dropDictionaryNextTo(index, targetIndex, position) {
        const options = await this._settingsController.getOptions();
        const {dictionaries} = options;
        if (
            index < 0 || index >= dictionaries.length ||
            targetIndex < 0 || targetIndex >= dictionaries.length ||
            index === targetIndex
        ) {
            return;
        }
        const target = dictionaries[targetIndex];
        const item = dictionaries.splice(index, 1)[0];
        item.group = target.group;
        const insertIndex = dictionaries.indexOf(target) + (position === 'after' ? 1 : 0);
        dictionaries.splice(insertIndex, 0, item);
        await this._saveDictionaryLayout(options, options.dictionaryGroups);
    }
}
