# English and Spanish interface

## Goal

The board has a complete English and Spanish interface. A person chooses the
language from the **More** menu, and the choice stays on that device/browser
when they return, including when using the installed PWA offline.

## Language model

- Supported locale codes are `en` and `es`.
- English is the default, preserving the language current users already see.
- The preference is stored separately as global `board.locale` in `localStorage`,
  not inside the board backup. Importing somebody else's board must never
  replace the recipient's interface language. It deliberately applies to every
  `?ns=` board in that browser, matching a device-level preference.
- Invalid or missing stored values fall back to English.
- Switching language applies immediately, sets `<html lang>` to `en` or `es`,
  and does not reload, alter cards, projects, stage names, or report history.
- Locale is read and validated before loading a board. A new board means no
  valid board at the active storage key; only then it receives default stage
  names and an onboarding card in the selected locale. Existing/imported boards
  retain those values because they are user data.

## UI

- The More menu includes two explicit choices, **English** and **Español**,
  with the selected one marked. They remain recognisable even when the rest of
  the menu changes language.
- It is the final menu group, after backup/import and a divider: a quiet,
  uppercase mono label `Language` / `Idioma`, then the two full-width choices.
  No flags, globe icon, confirmation, or submenu. Choices use
  `role="menuitemradio"` and `aria-checked`; choosing a new one updates in
  place and returns focus to More. Menu rows remain touchable on small screens.
- Every app-owned label is translated: static markup, buttons, placeholders,
  dialogs and ARIA labels, titles/tooltips, menus, empty states, confirmation
  copy, toasts, relative archive dates, and generated report controls.
- The update notice follows the selected language: English uses **Update**;
  Spanish uses **Actualizar**.
- `<html lang>`, document title, titles/tooltips, and ARIA/live-region text all
  update with the language. The manifest remains English product metadata;
  manifests cannot be changed dynamically per person.
- Keyboard shortcuts and product name remain unchanged.

## Dates and exports

- Week and day labels render with `Intl.DateTimeFormat` using an explicit
  selected locale and timezone.
- Report summaries, generated Markdown headings/status messages, report file
  names, and the unassigned-project label render in the selected locale.
- Historical event text, card titles, project names, and stage names are never
  translated. They are content written by the person, not interface strings.
- Core helpers retain English as their default argument so existing callers and
  tests remain compatible; the app passes the selected locale explicitly.
- `New` is derived from an event type and localized while rendering, never
  rewritten in historic event data. The internal unassigned-project sentinel is
  stable and only gets a localized label at display/export time.

## Implementation

- A small dependency-free translation module owns all interface strings and
  interpolation/plural helpers. Rendering code requests strings by key rather
  than maintaining scattered language conditionals.
- Static elements use translation keys; dynamic renderers use the same module.
- The PWA app shell caches the translation module with the rest of the app.
- If local storage is unavailable, English is the safe fallback and a language
  change remains active for that session.

## Acceptance checks

- A fresh and an existing board begin in English unless `board.locale` is `es`.
- Selecting either language updates the visible UI, document language, tooltip
  text, report date labels, and update notice without changing board data.
- Reloading offline retains the selected language.
- Exported English and Spanish reports use their respective labels while
  preserving user-entered task/project/stage text.
- Import/export does not overwrite the device language preference.
- Unit and DOM interaction tests pass; focused tests cover locale fallback,
  global namespace behaviour, fresh localized onboarding, localized core
  date/report output, and persistence.
