# Draw

Collaborative drawing at [draw.querencia.art](https://draw.querencia.art).

This repo contains the Vercel frontend build and the source for the live Cloudflare Worker, including the MCP integration used by the Draw plugin. It uses a pinned upstream [Excalidraw multi-tab](https://github.com/MontejoJorge/excalidraw-multi-tabs) revision (MIT).

## Run

```sh
npm run check
npm run build
```

Node 22+, npm and Git required. The build creates a `public/` directory. Preview locally with a static file server. Use `#local` for the personal canvas or `#room=<32 hex chars>` for shared boards.

## Architecture

- Frontend: Vercel + React / Excalidraw. `build.mjs` clones the pinned upstream revision and applies the files in `patch/`.
- Room sync: `sync.querencia.art` (Cloudflare Worker + Durable Object). The `board` storage key and `ROOMS` binding remain unchanged.
- Ephemeral messages: live pointers, viewports, and reactions.
- Persistent keys: `board`, `stickers`, `comments`, `meta`.
- Dashboard: recent room history, favorites and image previews are stored **locally in the browser**. Room title metadata lives on the server.

## Production deployment

PRs are intentionally not merged or deployed yet. **Before updating the live Worker**, confirm its existing bindings, routes, migrations and MCP compatibility; do not create a new Durable Object namespace. Keep the existing production deployment as a rollback target. Run two-browser drawing, follow, offline/reconnect and reload tests before promoting the frontend.

## License

Respect the MIT license for the upstream wrapper and licenses for Excalidraw and other dependencies.
