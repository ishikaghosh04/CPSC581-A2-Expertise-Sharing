# Expertise Sharing — Interactive 3D Lighting

**CPSC 581 · Project 2 · University of Calgary**

A browser-based, two-person expertise-sharing prototype for teaching 3D lighting and camera composition through hands-on interaction. An **expert** creates a reference scene, and a **novice** tries to recreate its appearance. In addition to mouse and keyboard controls, the application explores embodied interaction through **webcam head tracking, hand gestures, voice commands, and iPhone motion tracking**.

## Features

| Feature | Description |
| --- | --- |
| Expert–novice sessions | Create a session as an expert and join it as a novice using a five-character code. |
| Interactive 3D scene | Orbit the camera, move or aim a spotlight, adjust its brightness, and reset the camera or light. |
| Reference tasks | The expert publishes a reference image for the novice to reproduce. |
| Head tracking | Move your head in front of a webcam to change the camera viewpoint. |
| Hand gestures | Hold up one, two, or three fingers to select low, medium, or high brightness. |
| Voice commands | Say “low brightness,” “medium brightness,” or “high brightness” to adjust the spotlight. |
| iPhone motion control | Rotate an iPhone to aim the spotlight using device orientation, with calibration and stop controls. |
| Feedback and collaboration | Session chat, task history, attempt submission, expert feedback, optional hints, and audio progress cues. |

## Requirements

- **Node.js 24 or later** and npm.
- A modern desktop browser with WebGL support. **Chrome or Edge** is recommended for voice commands.
- A webcam for head and hand tracking; a microphone for voice commands.
- For phone control: an **iPhone with Safari**, and an **HTTPS URL** to the development app (the steps below use Cloudflare Tunnel).
- An internet connection for downloading dependencies and the MediaPipe models used by tracking features.

> The app is a development prototype. Sessions and task data are stored **in memory**, so restarting the server clears them.

## Installation and startup

Clone the repository and enter its directory:

```bash
git clone https://github.com/ishikaghosh04/CPSC581-A2-Expertise-Sharing.git
cd CPSC581-A2-Expertise-Sharing
```

Install dependencies:

```bash
npm install
```

Start the frontend and Socket.IO backend together:

```bash
npm run dev
```

On **Windows PowerShell**, if script execution restrictions prevent `npm` from running, use:

```powershell
npm.cmd install
npm.cmd run dev
```

By default:

| Service | Local address |
| --- | --- |
| Web application (Vite) | `http://localhost:5173` |
| Node/Socket.IO server | `http://localhost:3000` |

Open the Vite URL shown in the terminal. If port `5173` is occupied, Vite may choose a different port; use the port actually displayed.

The Vite development server proxies `/socket.io` requests to the backend on port `3000`, so **both processes must remain running**.

## How to use the application

### 1. Create and join a session

1. On the expert's computer, open the web app and select **Create session (expert)**.
2. Copy the five-character session code displayed at the top of the workspace.
3. On another browser or computer, open the app, enter that code, and select **Join as novice**.
4. Keep both participants connected to the same running server.

For a local demonstration, the expert and novice can use separate browser windows. To connect from another device, the app must be accessible from that device; `localhost` on one computer is not the address of another computer.

### 2. Publish a reference task

1. As the expert, use the 3D workspace to position the camera and adjust the spotlight.
2. Select **Move light** or **Aim light** to manipulate the appropriate light handle.
3. Choose **Low**, **Medium**, or **High** brightness.
4. Click **Publish task** and confirm when prompted.
5. The novice receives the reference image and attempts to recreate the scene by adjusting their own view and light.
6. The novice clicks **Submit attempt** when ready. The expert can review the attempt and provide feedback.

The workspace also provides **Reset camera** and **Reset light** controls. Participants can communicate through **Session chat**. The novice can request optional hints and select an attribute for audio progress feedback (camera position, camera aim, light position, light aim, or brightness).

## Interaction methods

### Mouse and keyboard

- Drag/orbit in the 3D scene to change the camera viewpoint.
- Use **Move light** and **Aim light** to change the spotlight's position or target.
- Select **Low**, **Medium**, or **High** in the **Mouse & keyboard** lighting tab.
- Use keyboard shortcuts **1**, **2**, and **3** for low, medium, and high brightness, respectively.
- Use **Reset camera** or **Reset light** to restore the corresponding default.

### Webcam head tracking

1. Connect a webcam and allow the browser to access it.
2. Click **Enable head tracking** in the workspace.
3. Face the camera in a comfortable, neutral position as tracking starts.
4. Move your head **left, right, up, or down** to change your view of the 3D scene.
5. Click **Disable head tracking** when finished.

Head tracking uses **MediaPipe Face Landmarker**. The app uses the shared tracking-camera preview, which can also be used for hand tracking. If you enable both features, they share the webcam stream.

### Hand-gesture brightness control

1. Open the **Hand gestures** lighting tab.
2. Click **Start hand tracking** / **Enable hand tracking** and grant webcam permission.
3. Choose **Left hand** (default) or **Either hand**.
4. Hold your hand in view and raise the desired number of fingers:

   | Fingers | Brightness |
   | --- | --- |
   | 1 | Low |
   | 2 | Medium |
   | 3 | High |

5. Hold the gesture steady for approximately **700 ms** to apply it. Watch the preview, finger-count indicator, and hold-progress feedback.
6. Disable hand tracking or click **Stop Camera** when finished using webcam features.

Hand gestures use **MediaPipe Hand Landmarker**. The stability delay helps avoid unintended brightness changes.

### Voice-command brightness control

1. Open the **Voice** lighting tab.
2. Click **Turn microphone on** and allow microphone access.
3. Speak one of the supported commands clearly:
   - **“low brightness”**
   - **“medium brightness”**
   - **“high brightness”**
4. Watch the recognition status and audio activity display.
5. Turn the microphone off when finished.

Voice control uses the browser's **Web Speech API**. Speech recognition availability depends on the browser; Chrome or Edge is recommended. The implemented voice commands control **brightness**, not camera or light movement.

### iPhone spotlight aiming (Cloudflare Tunnel)

The iPhone controller is a separate page at **`/phone-controller.html`**. It uses the browser's Device Orientation API to send the phone's orientation to the same session through Socket.IO.

**On your computer:**

1. Start the application with `npm run dev` (or `npm.cmd run dev` in PowerShell).
2. Create an expert session, or join a novice session, and keep the workspace open.
3. Install [Cloudflare Tunnel (`cloudflared`)](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) if needed.
4. In a **second terminal**, run:

   ```powershell
   cloudflared tunnel --url http://localhost:5173
   ```

   If Vite is using another port, replace `5173` with that port.

5. Copy the **new HTTPS `trycloudflare.com` URL** printed in the terminal.

**On your iPhone:**

1. Open **Safari** and navigate to:

   ```text
   https://YOUR-TUNNEL-NAME.trycloudflare.com/phone-controller.html
   ```

2. Enter the **same five-character session code** used by the web app.
3. Choose **Control Expert** or **Control Novice**, matching the workspace you want to control.
4. Tap **Connect to Session**.
5. Tap **Enable Motion Control** and grant motion/orientation permission if prompted.
6. Hold the phone at a comfortable starting angle and tap **Calibrate**.
7. Rotate or tilt the phone and watch the spotlight aim change in the selected desktop workspace.
8. Tap **Stop Tracking** when finished. You can recalibrate to set a new neutral orientation.

**Important notes:**

- The temporary Cloudflare URL **changes each time a new quick tunnel is created**. Use the latest URL shown in your terminal.
- The Vite configuration already includes `allowedHosts: ['.trycloudflare.com']`, so you **do not need to edit `vite.config.ts`** for each new tunnel hostname.
- Keep the app/server terminal **and** the Cloudflare terminal running throughout the demonstration.
- The phone page requires HTTPS for motion-sensor permissions on supported iPhones. Motion tracking measures **orientation**, not the phone's physical position in space.
- Cloudflare quick tunnels are intended for temporary development and are not guaranteed to remain available. The development hostname allowance should not be treated as a production security configuration.

## Project structure

```text
CPSC581-A2-Expertise-Sharing/
├── apps/
│   ├── server/
│   │   └── src/
│   │       ├── index.ts             # Express / Socket.IO events
│   │       ├── sessions.ts          # In-memory sessions and roles
│   │       └── reference.ts         # Reference and feedback logic
│   └── web/
│       ├── index.html               # Expert/novice interface
│       ├── vite.config.ts           # Vite server and Socket.IO proxy
│       ├── public/
│       │   ├── phone-controller.html # iPhone motion controller
│       │   └── mediapipe/           # Local vision WASM assets
│       └── src/
│           ├── main.ts              # UI, sessions, inputs, feedback
│           ├── scene.ts             # Three.js scene and lighting
│           ├── headTracking.ts      # Webcam face tracking
│           ├── style.css            # Interface styles
│           └── inputs/
│               ├── hand-tracking.ts
│               └── voice-commands.ts
├── packages/
│   └── shared/src/                  # Shared types and comparison logic
├── scripts/
│   └── smoke.mjs
├── package.json                     # npm workspaces and scripts
└── README.md
```

## Technology stack

- **Frontend:** Vite, vanilla TypeScript, HTML, CSS
- **3D rendering:** Three.js
- **Backend:** Node.js, Express, Socket.IO
- **Shared data contracts:** TypeScript workspace package
- **Head and hand tracking:** MediaPipe Tasks Vision
- **Voice input:** Web Speech API
- **Phone input:** Device Orientation API + Socket.IO
- **Audio feedback:** Web Audio API
- **Remote mobile testing:** Cloudflare Tunnel (development only)

## Development commands

Run from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start server and web development processes |
| `npm run dev:web` | Start only the Vite frontend |
| `npm run dev:server` | Start only the backend |
| `npm run typecheck` | Type-check workspace packages |
| `npm run build` | Build the frontend for production output |

On Windows PowerShell, substitute `npm.cmd` for `npm` if necessary.

## GitHub Pages deployment

The web frontend is the `apps/web` workspace. Its build command is
`npm run build --workspace apps/web`, which writes the deployable site to
`apps/web/dist`. The shared workspace package is consumed as TypeScript source
and has no separate build step.

The GitHub Actions workflow deploys that directory on pushes to `main` and can
also be run manually from the repository's **Actions** tab. Vite is configured
for this repository's project Pages path:
`/CPSC581-A2-Expertise-Sharing/`.

GitHub Pages hosts only static files; it does not run the Express/Socket.IO
server. The frontend uses Socket.IO's same-origin default unless the build-time
`VITE_SOCKET_URL` variable is set. The development server separately proxies
`/socket.io` to `http://localhost:3000`; that localhost address is development
only and is not a production backend. To enable sessions in the deployed app,
create a **repository variable** named `VITE_SOCKET_URL` under **Settings >
Secrets and variables > Actions > Variables** and set it to the actual public,
HTTPS URL of a deployed Express/Socket.IO backend. The backend must allow the
Pages origin and support Socket.IO connections. No backend URL is configured
or provided by this repository.

The standalone `phone-controller.html` also expects Socket.IO to be served by
the backend at `/socket.io/socket.io.js` and connects to its own origin. It
therefore needs a backend-hosted URL (or corresponding backend integration) to
work from GitHub Pages.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| `npm` is blocked in PowerShell | Use `npm.cmd install` and `npm.cmd run dev`. |
| Web page does not open | Check the Vite terminal for the actual port and make sure `npm run dev` is still running. |
| Cannot create or join a session | Verify the backend is listening on port `3000` and that both participants reach the same server. |
| Webcam preview or head/hand tracking does not start | Grant camera permission, connect a working webcam, and ensure another application is not exclusively using it. |
| MediaPipe tracking fails to load | Check internet connectivity and browser console messages; models are downloaded from external URLs. |
| Voice commands do not work | Try Chrome or Edge, grant microphone access, and use the exact supported brightness phrases. |
| Phone page says “Blocked request. This host is not allowed” | Verify `allowedHosts: ['.trycloudflare.com']` is in `apps/web/vite.config.ts`, then restart Vite. |
| Phone controller cannot connect | Check that the Cloudflare tunnel is running, the HTTPS URL is current, and the session code and target role are correct. |
| iPhone movement does not affect the spotlight | Tap **Enable Motion Control**, allow permission, wait for orientation data, and tap **Calibrate**. |
| Session data disappears | Sessions are stored in memory; restarting the backend clears them. |

## Prototype limitations

This is a **course prototype**, not a production service. Session state is temporary, browser permissions and feature support vary, and embodied input depends on camera visibility, lighting conditions, motion-sensor availability, and device/browser support. Manual controls remain available as an alternative to tracking-based interaction.

---

Developed for **CPSC 581 — Human–Computer Interaction II**, University of Calgary.
