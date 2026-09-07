# Running the soundboard on the puttheplayerfirst.com VPS

Target: `https://puttheplayerfirst.com/soundboard/`, served by the existing Dokploy box
(107.174.70.245). Same shape as the PhotoQuest prompt proxy: a standalone container on
`dokploy-network`, reached by name from the static site's nginx.

Nothing here touches the Astro build or the publish gates. The site's `deploy.sh`
rsyncs `dist/` with `--delete` into the web root; the soundboard never lives in the web
root, so the two cannot collide.

## 1. Create the container (Dokploy UI, once)

1. Dokploy → Create → **Compose**.
2. Source: GitHub, repository `arvindhsundar/Dandanaka`, branch `main` (public repo, so no
   deploy key is needed), compose path `docker-compose.yml`.
3. Deploy. Dokploy builds the `Dockerfile`, names the container `dandanaka`, and attaches it
   to `dokploy-network`. No domain and no published port: only nginx talks to it.
4. Check from the box:

   ```bash
   docker ps --filter name=dandanaka
   C=$(docker ps --filter ancestor=nginx:alpine -q | head -1)
   docker exec $C wget -qO- http://dandanaka:3000/healthz
   ```

   Expected: `{"ok":true,"rooms":0}`.

## 2. nginx (manual, after Arvindh's go, same procedure as nginx-fixes-2026-09-01)

Add the block from `deploy/nginx-soundboard.conf` to the main `server {}` in
`server/nginx.conf` of `puttheplayerfirst-site`, right after the PhotoQuest proxy
(it reuses that block's `resolver 127.0.0.11`). Then on the box:

```bash
cp -a /etc/dokploy/compose/ptpf-static/code/nginx.conf /etc/dokploy/compose/ptpf-static/code/nginx.conf.bak-$(date +%Y%m%d-%H%M%S)
# edit the live file to match server/nginx.conf
C=$(docker ps --filter ancestor=nginx:alpine -q | head -1)
docker exec $C nginx -t && docker exec $C nginx -s reload
```

Verify:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://puttheplayerfirst.com/soundboard/          # 200
curl -sS https://puttheplayerfirst.com/soundboard/ | grep -o '<base href="[^"]*">'          # /soundboard/
curl -sS -X POST https://puttheplayerfirst.com/soundboard/api/rooms                          # {"code":...}
curl -sS -o /dev/null -w '%{http_code}\n' https://puttheplayerfirst.com/soundboard/healthz   # 200
```

Then open the URL on a phone, start a session, and join it from a laptop. If the board
loads but the status dot stays red, the `Upgrade`/`Connection` headers didn't make it
through: re-check the nginx block.

## 3. Site housekeeping

- `public/robots.txt`: add `Disallow: /soundboard/`. The app already sends
  `<meta name="robots" content="noindex">` and it isn't in the sitemap, so the sitemap lint
  won't flag it either way. Astro never builds this path, so no Astro page can shadow it.
- Optional: link it from wherever the GM audience lands (the TTRPG field notes, the 10K GMs
  material). The share link players receive is `https://puttheplayerfirst.com/soundboard/r/<code>`.

## Updating

Push to `main` on `arvindhsundar/Dandanaka` and hit Redeploy in Dokploy (or enable
auto-deploy on push). Rooms live in memory, so a redeploy drops active sessions; do it
between games.

## Alternative: a subdomain instead of a path

If a path under the main site turns out awkward, Dokploy can front it directly:
create an **Application** instead of Compose, add a domain like
`soundboard.puttheplayerfirst.com` (one DNS A record to the box), leave `BASE_PATH` unset.
Traefik handles TLS. No nginx change at all.
