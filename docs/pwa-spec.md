# Web + PWA delivery

## Goal

Let people use one canonical web URL, install the board as an app, work offline
after the first visit, and deliberately move to a newly published version.
The board remains private and single-browser: no account, backend, sync, or
networked board data is introduced.

## Delivery

- GitHub Pages publishes a staged static build on each push to `main`. The
  workflow stamps the commit SHA into the service worker cache revision, so
  every deployed app change is discoverable as an update.
- The canonical URL is `https://brainforwarding.github.io/kanban.html/`.
- A web app manifest makes the site installable.
- A service worker precaches the app shell (`index.html`, `styles.css`,
  `core.js`, and `app.js`) so an already visited board opens offline.

## Update behaviour

1. A service worker checks for a changed app shell when the app starts.
2. If a new worker is waiting, the UI shows a small, persistent Spanish notice:
   a localized notice: `Update available` / `Update` in English and
   `Hay una actualización disponible` / `Actualizar` in Spanish.
3. The update button asks the waiting worker to activate, then reloads only after it
   takes control. This prevents a mixed old/new asset set.
4. Until the person chooses it, their current session continues unchanged.
5. A first visit still requires an internet connection; subsequent visits work
   offline with the version already cached.

## Data and migration

- Board data stays in the existing `localStorage` keys (`board.v2` and named
  `?ns=` variants). The service worker never caches, reads, or sends it.
- A future code update must preserve the existing storage migration path.
- Data from the old downloaded `file://` app cannot be read by the web origin.
  The migration is deliberately explicit: **Export backup** in the downloaded
  app, then **Import backup** at the hosted URL.

## Offline/cache rules

- The active worker serves its complete app shell from its own cache, including
  navigation. A new worker precaches the next complete shell separately and
  waits for an explicit update; this avoids mixing new HTML with old JavaScript.
- Versioned cache names are removed during worker activation.
- The worker claims clients only after the person accepts the update, then the
  client reloads once on `controllerchange`.
- Same-origin static assets are cache-first after installation; a changed
  service worker version refreshes the full cache together.
- Requests outside the app shell are not intercepted.

## Scope and acceptance checks

- GitHub Pages workflow deploys successfully from `main`.
- The manifest validates and the browser offers installation on a supported
  browser.
- After one online visit, turning off the network still opens the board.
- Deploying a changed version results in exactly one localized update notice;
  accepting it reloads into the new version.
- Existing board content remains after updating.
- Existing unit and DOM tests continue to pass.
- Manual PWA verification covers first install (no notice), offline reload,
  a named `?ns=` board, and an update that preserves `localStorage`.

## Out of scope

- Accounts, cloud backups, sharing, cross-device sync, push notifications, and
  automatic background updates.
