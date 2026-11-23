# Draw

The collaborative drawing app at [draw.querencia.art](https://draw.querencia.art).

This repository stores the app's custom frontend patches and the source for its Cloudflare Durable Object collaboration service. We currently use a pinned revision of [MontejoJorge/excalidraw-multi-tabs](https://github.com/MontejoJorge/excalidraw-multi-tabs) (MIT).

## Build

```sh
node build.mjs
```

The build clones the pinned upstream revision, applies the patches in `patch/`, and emits Vercel-compatible static files into `public/`. You need Git, Node.js and npm. For local development, use a static server against `public/` or run Vite in the generated `upstream/` directory.

The drawing editor keeps existing Excalidraw tab storage. Shared rooms use `#room=<32-character-id>` and the existing `wss://sync.querencia.art/room/<id>` protocol.

## Deployment safety

The production Vercel domain still points at the previously deployed version. Do not repoint it until the migration and two-browser collaboration tests pass. Do not replace the live Worker configuration without first verifying its existing Durable Object migration history and routes.

## License

The upstream Excalidraw multi-tab wrapper uses MIT; Excalidraw and its dependencies retain their original licenses.

## Room dashboard

The website root shows recently visited rooms on **this browser**, including local thumbnail previews and pinned favorites. Shared board links open directly. Use `#local` for a personal Excalidraw canvas. Room titles and collaboration state are synchronized by the Worker; saved local previews are not uploaded.
