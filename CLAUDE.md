# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

調査システムPWA (Asbestos survey system PWA) for 小田原鉱石株式会社 (Odawara Koseki). A static
site (no build step, no bundler, no npm/package.json) deployed to Firebase Hosting, using
Firebase Authentication (Microsoft/Entra OAuth) and Firestore, plus Microsoft Graph/SharePoint
for file access. Pages are plain HTML/CSS/JS loaded directly by the browser.

## `src/` is the canonical source tree — read this before touching anything

As of the 2026-08-06 repository reorganization, **`src/` is where all new development happens.**
The repo also still carries a frozen legacy version for visual/behavioral comparison. Do not
assume older docs describe the current layout — `docs/project-structure.md` records the target
architecture and is updated as the plan changes, but the concrete state right now is:

- **`src/app.html`** is the canonical, in-progress rebuild. It currently has the full UI shell
  (header, tabs, drawer, project panel, modals) plus a working Microsoft-login connection, but
  the feature tabs (仕上表/建材リスト/写真/調査図/同期/設定/レコード) are still placeholders —
  no finish-table, material-list, photo, or sync business logic has been ported in yet. Treat
  `src/app.html` as the file to extend for all new feature work.
- **`app.html`** (repo root) is the legacy v0.15.x monolith (see `docs/v015-baseline.md`) — a
  single ~400KB self-contained HTML file with all CSS and business logic inline, its own inline
  Firebase init (v10.12.5 via CDN) and MSAL.js for SharePoint/Graph access. It is kept **only as
  a live comparison reference** (what the finished UI/behavior should look like) — it is not the
  target of new work. It still has its own working login independent of `src/`. `camera.html`,
  `404.html`, and `css/` at the root are its supporting files and are likewise reference-only.
- **`archive/v0.15.10/`** is a byte-for-byte frozen copy of the root legacy files (`app.html`,
  `camera.html`, `404.html`, `css/`, `assets/`) taken at reorg time, for permanent before/after
  comparison even if the root copy later changes or is removed. Files under `archive/` are never
  edited — if the legacy baseline needs correcting, that discussion happens before archiving, not
  after.
- **`index.html`** (repo root) is a small static landing page (no `<script>` of its own) that
  just links to `./app.html`. It is the live Firebase Hosting entry point (`firebase.json` has
  `"public": "."` with no rewrites, so `/` serves it by Hosting's default convention), but it is
  not itself an old-vs-new artifact — leave it alone unless specifically asked.
- **`styles/`** (a stray, unreferenced duplicate of `js/`/`config/`) has been deleted. **`src/00_boot.js`
  through `src/90_ui.js`** (empty stub files from an early file-naming plan) have also been
  deleted — both were confirmed to have zero references anywhere in the repo before removal. If
  you see either mentioned in an older doc, it no longer exists.
- Migration direction (per `docs/project-structure.md`): business logic is ported from the root
  `app.html`'s inline scripts into `src/js/<feature>/` modules one feature at a time, without
  changing on-screen behavior mid-move. Don't do a big-bang rewrite; migrate one module at a
  time and keep the visible UI identical unless asked otherwise. The 仕上表 (finish table) tab is
  the next planned feature to port into `src/app.html` and has not started as of this writing.

When asked to change "the app," default to `src/app.html` unless the request is explicitly about
comparing against, or reading, the legacy behavior — in which case use the root `app.html` or
`archive/v0.15.10/app.html` (identical content) as the reference, without editing either.

## Commands

There is no build/lint/test tooling in this repo (no `package.json`). Development is:

- Edit HTML/CSS/JS files directly under `src/` for new work.
- Serve locally with any static file server (e.g. `npx http-server .` or the VS Code Live Server)
  and open `src/app.html` (canonical) or the root `index.html`/`app.html`/`camera.html`/
  `survey-map.html` (legacy reference / untouched entry pages) directly.
- Deploy manually with the Firebase CLI: `firebase deploy --only hosting` (project id
  `odako-chousa-system-pwa`, configured in `.firebaserc` / `firebase.json`, which hosts the
  entire repo root as-is — so `src/app.html` is reachable in production at
  `https://odako-chousa-system-pwa.web.app/src/app.html`).
- Pushing to `main` also auto-deploys to Firebase Hosting via
  `.github/workflows/firebase-hosting-deploy.yml`.

## Architecture

### Pages
- `src/app.html` — canonical in-progress rebuild. UI shell (header/tabs/drawer/project panel/
  modals) and Microsoft login are wired up; feature tabs are still placeholders.
- `index.html` (root) — static landing page linking to the legacy `app.html`; not part of the
  old/new comparison, just leave as-is.
- `app.html`, `camera.html`, `404.html`, `css/` (root) — legacy v0.15.x baseline, kept live only
  as a reference; also frozen as an identical copy under `archive/v0.15.10/`.
- `survey-map.html` (root) — separate placeholder shell for the survey-map feature, not part of
  the legacy bundle above and not yet ported into `src/`.
- `service-worker.js` — currently a no-op placeholder; offline caching strategy is not yet
  decided (see the file's own header comment before implementing caching).

### Config and auth (canonical location: `src/`)
- `src/config/firebase-config.js` — Firebase Web SDK config + `initializeApp`.
- `src/config/microsoft-config.js` — Entra `clientId`/`tenantId`/Graph `scopes`. Login is
  restricted to a single Entra tenant (see `provider.setCustomParameters({ tenant: ... })` in
  `src/js/auth/microsoft-auth.js`).
- `src/config/app-config.js` — app name/version/mode (not yet wired to any displayed version
  string — `src/app.html`'s header version pill is still a static "v0.1.0" in the markup).
- `src/js/auth/microsoft-auth.js` — the actual login/logout/token logic: modular Firebase Auth
  v12.1.0, `OAuthProvider("microsoft.com")` (not MSAL — that's only in the legacy `app.html`).
  Exports `loginWithMicrosoft`, `logoutMicrosoft`, `watchAuthState`, `getGraphAccessToken`. A
  Firebase-only login without a Graph access token is treated as a failed login and signs the
  user back out (see comments in the file for why).
- `src/js/ui/auth-ui.js` — the only place that wires the above into the DOM (`#msAuthBtn`,
  `#msPill`, `#graphTokenPill` in `src/app.html`'s header). Pure UI glue, no auth logic of its
  own. Bound from `src/js/app-init.js` via `bindAuthUiEvents()`, alongside the other
  `bind*Events()` calls for tabs/drawer/project-panel/modal — those other UI modules are separate
  files and are not touched by auth work.
- Nothing secret (Graph access tokens, refresh tokens, client secrets, admin passwords, service
  account keys) is ever committed; the Firebase web API key is a public client key by design.
  The Graph access token obtained at login is kept only in `sessionStorage`
  (`graphAccessToken` key), never persisted or synced.

### Data model (Firestore, as used by the legacy `app.html`; not yet used by `src/app.html`)
Per-project subcollections under `projects/{projectId}`:
- `materialRecords` — 建材レコード (material records)
- `roomRecords` — 仕上表/部屋 records (finish table / room data)
- `photos` — photo records
- Project registry lives at `projects/_registry/projectList`.

Sync policy (per `docs/project-structure.md`): local-first — the on-device copy is authoritative
for editing; Firestore listeners apply only the changed documents after the initial load, not
full re-fetches; failed writes are not auto-retried in a loop — they resend on the next edit or
manual sync. Photos upload automatically on first save, but also don't auto-retry after a
failure. None of this is implemented in `src/` yet.

### Legacy `app.html` internals (root and `archive/v0.15.10/`, reference only)
Business logic is organized as plain global objects/modules defined in inline `<script>` blocks
and wired to markup via `onclick="Module.method()"` attributes (not addEventListener). Key
modules, in rough order of appearance: `ApiClient`, `AuthManager`, `SharePointManager`,
`StateManager`, `StorageManager` (local persistence + debounced save), `MaterialRecordManager`,
`PhotoRecordManager`, `UIManager` (tab switching, top-level render), `ErrorManager`,
`DomainUtils`, `CandidateManager` (material/part candidate suggestions), `FinishTable`,
`MaterialList`, `RecordsModule`, `SettingsModule`, `DrawerModule` (side operation panel),
`HistoryManager`, `AppManager`. `UIManager.renderAll()` is the central re-render entrypoint that
fans out to each feature's own `render()`. This is the behavior new `src/` feature work should
match visually, without copying the inline-onclick/global-object style itself.

### `src/` internals (canonical, in-progress)
Standard ES modules (`type="module"`, real `import`/`export`), `addEventListener`-based, no
inline `onclick`. `src/js/app-init.js` is the single entry point loaded from `src/app.html`; it
calls `bindTabEvents`/`bindDrawerEvents`/`bindProjectPanelEvents`/`bindModalEvents`/
`bindAuthUiEvents` (one `ui/*.js` module each) and then shows the default tab. Each `ui/*.js`
module owns exactly one piece of chrome (tabs, drawer, project panel, modals, auth) and doesn't
reach into the others. Feature tabs (仕上表 etc.) have no dedicated modules yet — that's the next
work, to be added under `src/js/<feature>/` following the same one-module-one-responsibility
pattern, per `docs/project-structure.md`.

## Language

All user-facing strings, comments, and docs in this repo are Japanese. Match that when adding UI
text, comments, or files under `docs/`.
