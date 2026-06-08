# Admin Impersonation — Design

**Date:** 2026-06-03
**Owner:** Kevin
**Status:** Approved (pending spec review)

## Goal

Let an admin start a "View as Joe W" session that makes the rest of
the app behave as though Joe W were logged in. Used to diagnose tech
reports of weird earnings, missing units, photo upload issues, etc.,
where the admin needs to see exactly what the tech sees and
optionally take corrective actions in the tech's identity.

## Scope

- One admin → one tech at a time. No multi-level (admin → tech →
  tech).
- Admin and tech are both pulled from the existing Techs sheet
  (admins are techs with `isAdmin=TRUE`).
- Impersonation is initiated from a new `/admin/techs` page and
  always exited via a persistent banner.

## Out of scope (v1)

- Impersonating another admin (allowed mechanically — same flow —
  but no special UI).
- Time-limited auto-exit. Sessions live the standard 30-day TTL
  while impersonating; if Kevin wants a 30-min auto-exit later, add
  a timestamp + middleware check.
- Per-write attribution logging at the route level. v1 logs only
  impersonation start + exit events. Per-write logging can be added
  later by hooking the same `logImpersonationEvent` helper into the
  mutation routes; deferred to keep the surface area small.

## Data model

### Session shape (extend existing `SessionData` in `lib/types.ts`)

```ts
export interface SessionData {
  // Existing — represent the EFFECTIVE identity (the tech the app
  // treats the request as coming from).
  techId: string;
  name: string;
  loggedInAt: number;
  isAdmin?: boolean;
  // New — only set while impersonating. Carries the admin's real
  // identity so we can exit back to it and so the impersonation log
  // knows who actually clicked.
  impersonatorTechId?: string;
  impersonatorName?: string;
}
```

All existing code that reads `session.techId` / `session.name` /
`session.isAdmin` continues to work unchanged. When impersonating,
those fields contain the impersonated tech's identity (so writes are
attributed correctly, the tech UI renders, and admin routes refuse
access as expected).

### New sheet tab: `Impersonation Log`

One row per impersonation event (start or exit).

| Col | Field | Type | Notes |
|---|---|---|---|
| A | Log ID | string | `IMP-2026-NNNNN` |
| B | Timestamp | ISO ts | when the event fired |
| C | Event Type | enum | `Start` / `Exit` |
| D | Admin Tech ID | string | the real admin |
| E | Admin Name | string | display name at event time |
| F | Target Tech ID | string | tech being impersonated |
| G | Target Name | string | display name at event time |
| H | Notes | string | optional free text (e.g., why) |

Validation on column C: dropdown `Start`/`Exit`.

## API

### `POST /api/admin/impersonate`

- Admin-only (`requireAdmin()`).
- Body: `{ targetTechId: string }`.
- Looks up target tech in `loadAllTechs()`. Must exist and be
  `active=true`. Refusing inactive techs prevents staleness.
- Updates the cookie with the impersonation fields set:
  - `techId` → target.techId
  - `name` → target.name
  - `isAdmin` → target.isAdmin (so impersonating another admin
    preserves admin powers — uncommon but consistent)
  - `impersonatorTechId` → caller's real techId
  - `impersonatorName` → caller's real name
- Writes a `Start` row to the Impersonation Log.
- Returns `{ ok: true }`.

### `POST /api/admin/impersonate/exit`

- Bypasses the admin check (since the EFFECTIVE identity isn't
  admin while impersonating — the bypass key is "this cookie has
  `impersonatorTechId` set").
- Resolves the real admin by re-looking up `impersonatorTechId` in
  the Techs sheet to get the current name and admin status (in case
  they changed since impersonation started).
- Updates the cookie:
  - `techId` → real admin's techId
  - `name` → real admin's name
  - `isAdmin` → real admin's isAdmin (will be true)
  - Clears `impersonatorTechId` / `impersonatorName`.
- Writes an `Exit` row to the Impersonation Log.
- Returns `{ ok: true }`.

### Safety guardrails

- Server-side: `requireAdmin()` continues to gate all `/api/admin/*`
  routes against the effective identity. Under impersonation that's
  the tech (non-admin), so admin routes 403. Correct: you stop
  being able to admin things while pretending to be a tech.
- The exit route is the one exception — it doesn't require admin,
  it requires `session.impersonatorTechId` to be set. This is the
  only escape hatch.
- The impersonation log is append-only via the `appendRow` helper.
  No update / delete API.

## UI

### `<ImpersonationBanner />` — new component

Rendered inside `AppShell` (or whatever top-level layout wraps every
authenticated page). Reads the session via the existing
`getSession()` on the server side, passes to the component as
props (a server-side wrapper, so the banner state never gets out of
sync with the cookie).

Visual: full-width sticky bar at the top of the viewport. Yellow
background (`bg-yellow-300`, matching the 2-year banner). Text:
"⚠ Viewing as {impersonatedName} — [Exit impersonation]". The Exit
button POSTs `/api/admin/impersonate/exit` then full-reloads to
`/admin/techs`.

When NOT impersonating, the banner is null.

### `/admin/techs` — new page

- Admin-only.
- Lists every active tech in alphabetical order.
- Each row shows: name, techId, isAdmin badge, "View as {name}"
  button.
- Button POSTs `/api/admin/impersonate` with the target techId, then
  navigates to `/jobs` (so the admin lands where a tech would
  start).
- Includes a "Recent impersonations" list at the bottom — last 10
  log entries showing who impersonated whom and when. Lightweight
  audit visibility from the admin dashboard.

### `AppShell` wiring

Existing `components/AppShell.tsx` is the authenticated layout. Add
`<ImpersonationBanner />` as the first child of the shell so it's
always at the top regardless of route.

## State machine

```
   ┌──────────────────────────────┐
   │  Admin (impersonator=unset)  │
   └────────────┬─────────────────┘
                │ POST /api/admin/impersonate { targetTechId }
                ▼
   ┌──────────────────────────────────────┐
   │  Tech (effective)                    │
   │  impersonator=Kevin                  │  → /jobs etc. behave as tech
   │  isAdmin=false                       │
   │  banner visible                       │
   └────────────┬─────────────────────────┘
                │ POST /api/admin/impersonate/exit
                ▼
   ┌──────────────────────────────┐
   │  Admin (impersonator=unset)  │  ← back to /admin/techs
   └──────────────────────────────┘
```

## Migration

- One-off script `scripts/init-impersonation-tab.mjs` adds the
  `Impersonation Log` tab to the production sheet (same pattern as
  the audit init script).
- Existing sessions remain valid — the new optional fields are
  absent on old cookies, so the bridge code treats them as
  "not impersonating," which is correct.

## Acceptance / done criteria

1. An admin can navigate to `/admin/techs`, tap "View as Joe W,"
   and find themselves looking at Joe's `/jobs` page exactly as Joe
   would see it.
2. The yellow banner persists across every page while
   impersonating.
3. Tapping "Exit impersonation" returns the admin to their normal
   admin identity and lands on `/admin/techs`.
4. While impersonating, `/admin/*` URLs return 403 (except the
   exit endpoint).
5. Every impersonation start and exit writes a row to the
   `Impersonation Log` sheet.
6. New units / audit items created while impersonating are
   attributed to the impersonated tech (e.g., `loggedBy = "Joe W"`
   in the Units Serviced row).
7. The `/admin/techs` page shows the last 10 log entries below the
   tech list.
8. `tsc --noEmit`, `next lint`, and `next build` all pass.

## Open / deferred items

- **Per-write attribution logging**: deferred. If Kevin asks for
  the granularity later, add a one-line call to
  `logImpersonationEvent({ type: 'Write', entity, entityId })` in
  each mutation route.
- **Time-limited auto-exit**: deferred.
- **Impersonation history filter on the log page** (search by
  admin / target): deferred.
