# TrackSweeper — repo map & workflow (Claude memory)

**TrackSweeper** is a GPS-tracking system for bike-lane sweepers, built on a fork of
**Traccar** (open-source GPS tracking). The related repos live under
`C:\Users\cedri\Documents\GitHub`. (The `eCVT-*` and `hydrofoil` folders there are
unrelated projects — ignore them.)

> The human single-source-of-truth for architecture & ops is **`handoff.md`** in the
> **private** `tracksweeper-docs` repo. Consult it for anything beyond the repo map / git
> workflow below. Do **not** copy infra/credentials/IPs into committed memory — some of
> these repos may be public.

## Repos (all under github.com/CedricE11)
- **tracksweeper** — umbrella: the Traccar **Java server** (Gradle). Active branch
  `sweeper-features`. Pulls the frontend in as a **git submodule** at `traccar-web`
  (`.gitmodules` -> tracksweeper-web, branch `sweeper-features-v6.12`, `ignore = all`).
  **Builds/deploys use the submodule** for the frontend. `CUSTOMIZATIONS.md` at the root
  lists every change on top of vanilla Traccar — use it as a smoke-test checklist after
  upstream merges.
- **tracksweeper-web** — standalone clone of the React/Vite **frontend** (same repo the
  submodule points to). Active branch `sweeper-features-v6.12`. Remotes: `origin` =
  CedricE11/tracksweeper-web (the fork), `upstream` = the original Traccar repo.
- **tracksweeper-docs** — **private** cross-cutting docs. Branch `main`. `handoff.md` is
  the living system handbook; also electronics wiring (KiCad), config schema, test notes.
- **tracksweeper-lilygo-client** — ESP32 **firmware** (PlatformIO/Arduino) for the
  **LilyGO T-SIM7000G** tracker. Posts GPS to the Traccar server via the **OSMAND**
  protocol (port 5055). Branch `main`.
- _(not cloned here)_ **tracksweeper-sidecar** — Python/FastAPI companion service for
  firmware management & serial flashing (referenced in handoff.md).

The frontend code therefore exists in **three working copies**: the GitHub remote, the
standalone `tracksweeper-web` clone, and the `tracksweeper/traccar-web` submodule. A change
must reach the submodule to affect the umbrella build.

## Version scheme (frontend)
App version `6.12.2-swp.x.y.z` lives in the frontend's `package.json`. Bumped **once per
commit** (not per change-within-session). Default bump = increment the last component (`z`).

## Web-change workflow (IMPORTANT)
A frontend fix only reaches the umbrella build after the submodule is moved up:
1. Commit + push in the web repo (branch `sweeper-features-v6.12`), bumping `package.json`.
2. In the umbrella, advance the submodule and record the new pointer:
   - `git -C ...\tracksweeper\traccar-web pull --ff-only origin sweeper-features-v6.12`
     (the submodule branch has **no upstream** set, so pull explicitly)
   - `git -C ...\tracksweeper add traccar-web`  (umbrella `git status` hides submodule
     changes because of `ignore = all`, so stage it explicitly)
   - `git -C ...\tracksweeper commit -m "Update traccar-web submodule to vX.Y.Z (...)"`

## Gotchas
- **Line endings**: working trees are CRLF but committed blobs are LF. Any git without
  `autocrlf` (CI, Linux, sandboxes) reports *every* file as modified — an artifact, not
  real changes. Stage specific files; never `git add -A`. Prefer byte-level writes that
  preserve LF; a CRLF round-trip can corrupt large files.
- **Collaborators**: **Cedric** — owner, mechanical engineer (GitHub `CedricE11`).
  **Philippe** — Cedric's **dad**; infra/backend/firmware (GitHub `cognoquest`, commits as
  "Philippe"; works in Cowork). **Anton Tananaev** = upstream Traccar author (via the
  `upstream` remote), NOT a collaborator on the fork.

_This file is mirrored across the tracksweeper-* repos (full version in `tracksweeper` and
`tracksweeper-web`; short stubs in `tracksweeper-docs` and `tracksweeper-lilygo-client`) —
keep them in sync. State as of 2026-06-22: web repo at v6.12.2-swp.1.0.1; umbrella submodule
pointer updated to match._
