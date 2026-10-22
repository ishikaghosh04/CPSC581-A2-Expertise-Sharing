# Running the Lighting Expertise-Sharing App

## Requirements

- **Node.js 24 or later.** This is the minimum declared in the root
  `package.json`.
- **npm.** The project uses npm workspaces and a version-3 `package-lock.json`.
  npm is not pinned separately; use the npm version installed with Node.js.
- A current desktop browser with WebGL support. Chrome or Edge is recommended,
  particularly for voice commands.
- An internet connection for installing npm dependencies and loading the
  MediaPipe tracking models.
- A webcam and microphone are optional, only needed for the corresponding
  tracking and voice features.

## Install and start both services

From the project root, install dependencies with the npm lockfile:

```sh
npm ci
```

Then start the frontend and Express/Socket.IO backend together:

```sh
npm run dev
```

The root script starts `npm run dev --workspace apps/server` and
`npm run dev --workspace apps/web` concurrently. Keep this terminal open while
using the app.

Open the local Vite URL printed in the terminal. With the default ports, it is:

```text
http://localhost:5173/CPSC581-A2-Expertise-Sharing/
```

The backend listens at `http://localhost:3000`. Vite's project base path is
also used by its development server, so open the full URL above rather than
`http://localhost:5173/`. Vite proxies Socket.IO traffic to the backend, so the
app works locally without a `.env` file or a `VITE_SOCKET_URL` setting. Keep
the backend on port 3000 when using this frontend proxy.

If port 5173 is already occupied, Vite may print a different frontend URL; use
the URL it reports. The server port defaults to 3000. If you change it, update
the Vite `/socket.io` proxy target in `apps/web/vite.config.ts` to the same
port.

## Demo: Expert and Novice

1. Open the app in a browser tab and select **Create session (expert)**.
2. Note the five-character session code shown in the workspace.
3. Open the app again in a second tab or browser window. Select **Join as
   novice**, enter the code, and join the session.
4. As Expert, position the camera and spotlight to create a reference scene.
   Use the scene controls to move or aim the light and adjust its brightness.
5. Select **Publish task** and confirm. The Novice receives the reference.
6. As Novice, adjust the camera and lighting to recreate the reference.
7. Select **Submit attempt**.
8. As Expert, review the submitted attempt and send feedback. The Novice can
   then view the feedback in the attempt-feedback area.

Both participants must use the same running backend. Two local tabs share the
same server and are sufficient for this demo.

## Camera, microphone, and browser permissions

- Camera and microphone access are optional; mouse, keyboard, and lighting
  controls work without them.
- For head tracking or hand gestures, enable the feature in the app and allow
  camera access when the browser prompts. If access was denied earlier, use
  the browser's site-permission controls to allow the camera and reload.
- For voice commands, open the Voice controls, enable the microphone, and
  allow microphone access. Browser speech-recognition support varies; Chrome
  or Edge is recommended.
- Browsers treat `http://localhost` as a secure context for local camera and
  microphone access. Access from other devices or non-local HTTP hosts may
  require HTTPS.
- MediaPipe downloads its models at runtime. Internet access is needed when
  using head tracking or hand gestures.

## Known limitations

- Sessions, tasks, and feedback are held in server memory and are lost when
  the server restarts. This is a prototype, not a persistent service.
- The default Vite proxy targets `http://localhost:3000`; connecting other
  devices or using a different backend requires network-accessible
  configuration.
- Voice recognition and camera-based tracking depend on browser support,
  permissions, and device capabilities. Manual controls remain available.
- The separate iPhone motion controller requires an HTTPS-accessible frontend
  and a reachable Socket.IO server; a local-only URL is not reachable from a
  phone. This is not required for the desktop Expert/Novice demo.
- The production build emits static frontend files. It does not include or run
  the Express/Socket.IO backend; use `npm run dev` for the complete local
  system.
