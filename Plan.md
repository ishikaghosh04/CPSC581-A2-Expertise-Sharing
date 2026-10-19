# CAD expertise sharing project

## Overview

What can two people understand by moving together around or through a 3D object that they couldn't understand as easily by watching someone move a mouse? That's what we set out to solve in this project.

A 1-on-1, browser-based CAD lighting teaching demo. The object of study is *whether embodied input helps teach spatial/visual skills*, so the app itself only needs to support the teaching loop well enough to demo. The core research point is embodied input — head tracking for camera perspective, phone tilt for aiming the light, finger-count gestures for intensity — layered on top of a solid keyboard/mouse base.

**Role:** An expert sets up a complete camera view + lighting for a simple 3D room scene; a novice tries to replicate it without seeing the expert's light source; then the expert reviews the novice's attempt and gives feedback. Objects in the room are shared context and never change.

## Session flow

1. Expert starts a session → gets a join code.
2. Novice joins by code (laptop browser; phone joins the same room in phase 2).
3. Expert frames the camera, moves/aims the spotlight, sets intensity → presses **Publish task**.
4. Server renders the expert's view *offscreen with the light source hidden* → sends the reference image and retains that task's camera/light state server-side for private expert diffs and opt-in novice hints.
5. (Undecided if will add) Novice works live: orbits their camera and manipulates their own light to make their view match the reference picture. The expert sees **both scenes side-by-side, live**, but there is **no numeric guidance** — the reference image is the only guide, and "match it by eye" is part of the task.
6. Novice submits → expert compares the target and novice attempt, with per-task state differences visible only to the expert. The expert can send feedback attached to a submission; the novice sees an unread notice and can review it alongside the attempt. Text chat works both ways, and the expert gets varied, selectable feedback suggestions from the shared comparison logic.

## Controls (phase 1, keyboard/mouse)

- Camera: OrbitControls.
- Light: gizmos — a translate gizmo on a handle representing the light, plus the spotlight's target to aim it. Intensity: low/medium/high slider.
- Reset button for each (camera reset, light reset).

## Stack

TypeScript monorepo, no DB (in-memory sessions):

| Part | Technology | Purpose |
| ---- | ---------- | ------- |
| Frontend | Vite + vanilla TypeScript (`apps/web`) | Expert/novice screens, controls, reference image, chat. |
| 3D scene | Three.js (`apps/web`) | Room, objects, spotlight, shadows, gizmos. |
| Server | Node + Express + Socket.IO (`apps/server`) | Session rooms by join code, live state sync, task publishing. |
| Shared protocol | TypeScript package (`packages/shared`) | CameraState, LightState, TaskPayload, message types — single source of truth for client and server. |
| State | In-memory session store | Sessions, roles, task state, submissions. No DB for v1. |

## Tech notes for phase 2 inputs

- Hand + head tracking: MediaPipe Hand Landmarker + Face Landmarker via webcam.
- Phone aiming: Browser Device Orientation API — tilting the phone aims the light. Requires HTTPS (secure context) and an iOS motion permission prompt; plan for a small local HTTPS dev setup before testing on phones. Device orientation does not reliably track physical position.
- Voice commands (optional): Web Speech API, small command set; browser support varies.
- Audio feedback: Web Audio tones that change as the novice approaches the target.

## Build order

Each step leaves a working milestone:

1. **Scaffold** — monorepo layout, server, join-by-code, role screens (expert/novice).
2. **3D scene** — room, floor, simple object, spotlight with shadows; camera orbit; gizmo light editing; intensity slider; resets.
3. **Publish pipeline** — offscreen hidden-light render → reference image on the novice screen; task state stored in memory. [We are done this step!]
4. **Chat** — text chat both ways; expert views both submissions side-by-side at submit time.
5. **Embodied inputs** (phase 2), one at a time, phone aiming first — because whether it feels natural affects the design. Keep light position on buttons/keyboard while testing.
   - Phone orientation: tilting the phone aims the light, with a "set neutral position" button.
   - Hand tracking: 1/2/3 fingers → low/medium/high intensity; require a briefly stable gesture to prevent accidental changes.
   - Head tracking: map small head movements to a limited camera movement; sensitivity and reset controls.
   - Voice commands (optional): "left," "right," "up," "down," and brightness levels.
6. **Feedback and accessibility polish** — the novice may request one state-based hint at a time; per-feature keyboard/on-screen fallbacks; allow seated use, pausing, and disabling camera movement.
