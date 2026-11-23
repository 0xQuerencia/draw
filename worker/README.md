# Collaboration Worker

The live Draw service at `sync.querencia.art` is a Cloudflare Worker with Durable Object binding `ROOMS` and class `Room`. Its existing per-room drawings are stored under the key `board`.

**Do not create a new namespace or deploy a new Durable Object migration blindly.** Export/verify the existing Worker bindings, migration history, routes and secrets first. Deployment of this source is deliberately manual until that mapping is verified, so existing rooms cannot be orphaned. The frontend is compatible with the existing `snapshot`, `patch`, `pointer` and `members` messages.
