# Draw

Collaborative drawing at [draw.querencia.art](https://draw.querencia.art).

This repo contains the Vercel frontend build and the source for the live Cloudflare Worker, including the MCP integration used by the Draw plugin. It uses a pinned upstream [Excalidraw multi-tab](https://github.com/MontejoJorge/excalidraw-multi-tabs) revision (MIT).

## Run

```sh
npm run check
npm run build
```

Node 22+, npm and Git required. The build creates a `public/` directory. Preview locally with a static file server. The homepage opens the personal canvas directly. Use `#room=<32 hex chars>` for shared boards.

## Architecture

- Frontend: Vercel + React / Excalidraw. `build.mjs` clones the pinned upstream revision and applies the files in `patch/`.
- Room sync: `sync.querencia.art` (Cloudflare Worker + Durable Object). The `board` storage key and `ROOMS` binding remain unchanged.
- Ephemeral messages: live pointers, viewports, and reactions.
- Persistent keys: `board`, `stickers`, `comments`, `meta`.
- The homepage opens the Excalidraw canvas immediately; shared room URLs continue to work.

## Production deployment

The frontend is deployed from the verified Vercel build, and the Cloudflare Worker uses the existing `ROOMS` Durable Object binding. Do not create a new Durable Object namespace or delete room storage. Run two-browser drawing, follow, offline/reconnect and reload tests before major releases.

## License

Respect the MIT license for the upstream wrapper and licenses for Excalidraw and other dependencies.
