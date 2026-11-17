# Yomitan mod

This branch (`mod`) is a personal fork of [Yomitan](https://github.com/yomidevs/yomitan) with a few additions for people who use many dictionaries. It is not an official Yomitan release.

## Additions

### Dictionary groups ([#796](https://github.com/yomidevs/yomitan/issues/796))

In _Settings → Dictionaries_, dictionaries can be organized into named groups, each shown as a tab.

- The **All** tab shows every dictionary in priority order, grouped. Each group's tab shows only that group.
- **+ New group** creates a group. Dragging a dictionary onto a group's tab, or **Move to group…** in its menu, puts it into the group.
- The order of the tabs is the priority of the groups: drag a tab to move a whole group up or down (the arrows and the group's menu work too).
- A group's switch turns the whole group off without touching its dictionaries' own switches, so turning it back on restores exactly the dictionaries that were selected before.
- Groups can be renamed and deleted (their dictionaries are kept).

### Fallback dictionaries ([#1821](https://github.com/yomidevs/yomitan/issues/1821))

A dictionary can be marked **Only show as fallback** (dictionary menu or details). Its definitions are then only shown for terms which none of the regular dictionaries have.

### Add a note from a single dictionary ([#797](https://github.com/yomidevs/yomitan/issues/797))

When a term has definitions from several dictionaries, each dictionary gets its own small add button which creates an Anki note containing only that dictionary's definitions. This can be turned off in _Settings → Anki_.

### Tabs in the search page

The search page can hold several searches as tabs.

- Every tab has its own query, history, profile (the profile selector only affects its tab) and clipboard monitor switch. Only the visible tab reacts to the clipboard.
- Ctrl+click or middle click on a link to another term opens it in a new tab.

| Shortcut        | Action                                                    |
| --------------- | --------------------------------------------------------- |
| Alt+T           | New tab; with text selected, searches for it in a new tab |
| Alt+W           | Close tab                                                 |
| Alt+. and Alt+, | Next and previous tab                                     |

## Installing

```
npm ci
npm run build:libs
```

Then open `chrome://extensions`, enable _Developer mode_, choose _Load unpacked_ and select the `ext` folder.

The mod is a separate extension from the store version of Yomitan and starts without settings or dictionaries. Both can be moved over with _Settings → Backup_ (export the settings and the dictionary collection in the store version, then import them here).
