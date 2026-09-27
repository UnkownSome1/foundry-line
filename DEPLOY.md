# Putting Foundry Line online (free, on Render)

Co-op needs the game server running somewhere both players can reach. Render's free
web service does that: one address serves the game **and** the co-op server. There is
nothing to install and no build step — the server has no npm dependencies.

You do this once. After that, you and a friend just open the same link.

## 1. Put the project on GitHub

1. Unzip `foundry-line-build-0.4.zip`. You should see `index.html`, `render.yaml`,
   `package.json`, and the folders `server/`, `src/` and `test/`.
2. Sign in (or sign up, free) at [github.com](https://github.com).
3. Top right **+** → **New repository**. Name it `foundry-line`. Public or private both
   work. Click **Create repository**.
4. On the empty repository page click **uploading an existing file**.
5. Drag **everything inside** the unzipped folder (the files *and* the `server`, `src`
   and `test` folders) into the page. Chrome and Edge keep the folder structure when
   you drag folders in.
6. Click **Commit changes**. Check that the repository now shows `render.yaml` and a
   `server` folder at the top level.

## 2. Create the server on Render

1. Go to [render.com](https://render.com) and sign up with your GitHub account (free,
   no card needed for the free plan).
2. In the dashboard: **New** → **Blueprint**.
3. Connect your GitHub account if asked, then pick the `foundry-line` repository.
4. Render reads `render.yaml` and shows one web service called **foundry-line** on the
   **Free** plan. Click **Apply** / **Deploy Blueprint**.
5. Wait for the service to show **Live** (usually 1–3 minutes). Its address looks like
   `https://foundry-line-xxxx.onrender.com`.

## 3. Play

- Open the `…onrender.com` address. The bottom-right chip on the menu should say
  **Server online**.
- **Host:** Co-op → pick a company → **Host this company**. You get a 4-letter code
  (also shown in the Esc menu).
- **Friend:** opens the same address → Profile (set a name and colour) → Co-op → types
  the code → **Join session**.
- The host's company is what you both play; the host's browser keeps the save and gets
  updates from the server every 10 seconds and when the host ends the session.
- Your friend's inventory and wallet are stored in the host's save, so they keep them
  next time they join that company with the same name.

## Things to know

- **Sleeping:** a free Render service goes to sleep after 15 minutes with nobody
  connected. The next visit takes about a minute to load while it wakes up; after that
  it's instant.
- **Saves live in the browser.** Companies are saved in the browser you play in (solo
  and hosted). Clearing site data for the address deletes them. The claude.ai preview
  and your Render address are different sites, so they have separate saves.
- **Updating the game:** upload the changed files to the same GitHub repository
  (Add file → Upload files). Render redeploys automatically within a couple of minutes.
- **Players per session:** 2. It's set by `MAX_PLAYERS` in `src/shared/net/protocol.js`.

## Playing on your own computer instead (optional)

If you have Node.js 20 or newer installed:

```
node server/server.js
```

Then open `http://localhost:8080`. Someone on the same Wi-Fi can join at
`http://<your computer's local IP>:8080`. Players outside your network would need port
forwarding, which is why Render is the easier option.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Menu says **Offline preview** on the Render address | The page loaded but `/api/info` didn't answer — check the Render dashboard shows **Live**, then reload. |
| "The server did not answer" when hosting | The server was probably waking up. Wait a minute and try again. |
| "No co-op session with code …" | Codes are 4 characters and last as long as the host stays in the session. Ask the host to check their Esc menu. |
| Deploy failed on Render | Make sure `render.yaml` and `server/server.js` are at the top of the repository, not inside another folder. |
