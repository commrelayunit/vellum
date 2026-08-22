# Running Vellum with Docker

This runs Vellum in a single container, with SQLite data and secrets persisted in a named Docker volume.

## Prerequisites

- Docker and Docker Compose installed.

## 0. Get the code

```bash
git clone <your-repo-url> vellum
cd vellum
```

`docker compose up -d` needs `docker-compose.yml` and the build context (this repository) to exist locally — it doesn't pull a prebuilt image.

## 1. Configure

Set your login password as an environment variable, either in your shell or in a `.env` file next to `docker-compose.yml` (Docker Compose loads that file automatically for variable substitution — separate from the app's own `dotenv`-based `.env` handling, which only applies when running outside Docker):

```
AUTH_PASSWORD=your-chosen-password
```

**`AUTH_PASSWORD` is the only value you need to provide.** Don't set `AUTH_PASSWORD_HASH`, `SESSION_SECRET`, or `ENCRYPTION_KEY` in this file — those are for the non-Docker `npm start` setup ([main README](../README.md#environment-variables)), and Docker generates all three automatically on first start, saving them into the same persistent volume as the database so they survive container restarts and upgrades. If you're coming from that setup and already ran `npm run hash-password`, you don't need that hash here — just put your plaintext password in `AUTH_PASSWORD`.

**Warning: if your password contains a literal `$`, a `.env` file will silently mangle it.** Compose treats `$` in `.env` values as the start of a variable reference — `AUTH_PASSWORD=my$ecret` becomes just `my` (Compose drops the undefined `$ecret` reference), and `AUTH_PASSWORD=dollar$HOME` leaks your host's `$HOME` value into the credential. If your password contains `$`, either:

- write it as `$$` in the `.env` file (Compose's escape for a literal dollar sign), e.g. `AUTH_PASSWORD=my$$ecret`, or
- set it via the shell environment instead of `.env`, e.g. `AUTH_PASSWORD='my$ecret' docker compose up -d`.

You can double-check the effective value Compose will actually pass through with `docker compose config` before starting the stack. The `$` escaping rule above applies to every value in this file, not just `AUTH_PASSWORD`: Compose interpolates `.env` before it even looks at `docker-compose.yml`, so an unrelated line like a stray `AUTH_PASSWORD_HASH=$2b$12$...` (a bcrypt hash, which always contains literal `$` characters) will trigger the same "variable is not set" warnings even though nothing reads that key — because Compose doesn't know it's unused until after it's already tried to interpolate the whole file. The warnings are harmless in that case, but they're a sign something that shouldn't be in this file is in this file.

## 2. Start

```bash
docker compose up -d
```

On first start the container hashes `AUTH_PASSWORD`, generates the two secrets, creates the database, and starts the app — no other setup needed.

## 3. Verify

```bash
curl -I http://localhost:3001/login   # expect: HTTP/1.1 200 OK
docker compose logs vellum            # expect: "Vellum server running on http://localhost:3001"
```

(The logs will also show a few lines of `express-session`'s standard `MemoryStore is not designed for a production environment...` warning before that line — this is pre-existing application behavior, not something specific to the Docker path, and not a sign anything is broken.)

Visit `http://localhost:3001` and sign in with your `AUTH_PASSWORD`.

## Changing the port

```bash
PORT=8080 docker compose up -d
```

## Exposing beyond localhost

By default `docker-compose.yml` publishes the app on `127.0.0.1` only — it's reachable from the host machine itself but not from your LAN or the internet, matching the private-by-default posture used elsewhere in this project (see [docs/DEPLOYMENT.md](DEPLOYMENT.md#3-private-network-access) for why the LXC path uses Tailscale instead of a public port).

If you want it reachable elsewhere, you have a few options:

- **LAN/all interfaces:** change the port mapping in `docker-compose.yml` from `"127.0.0.1:${PORT:-3001}:3001"` to `"${PORT:-3001}:3001"` and re-run `docker compose up -d`. This exposes the app, with no built-in TLS or additional auth beyond the single `AUTH_PASSWORD`, on every network interface on the host.
- **Tailscale:** run Tailscale on the host itself and reach the container via the host's Tailscale IP and the localhost-bound port — no compose changes needed.
- **Reverse proxy:** put nginx, Caddy, or similar in front, forwarding to `127.0.0.1:3001`, and let the proxy handle TLS/auth/access control.

## Changing the password / a note on AUTH_PASSWORD

The plaintext `AUTH_PASSWORD` is visible for as long as the container exists — via `docker inspect`, `/proc/1/environ` inside the container, and your on-disk `.env` file. This differs from the LXC path, which only ever stores the bcrypt hash, never the plaintext. Keep your `.env` file's permissions and access as tight as you would any other credentials file.

To change the password, edit `AUTH_PASSWORD` in `.env` and run `docker compose up -d` again. `AUTH_PASSWORD_HASH` isn't persisted anywhere (only `SESSION_SECRET` and `ENCRYPTION_KEY` are saved into the volume's secrets file), so the entrypoint re-hashes `AUTH_PASSWORD` on every container start — the new password takes effect on the next boot without any extra steps.

## Backups

The named volume holds both the SQLite database and the generated secrets file (`.secrets.env`) — back up the whole volume together, not just the database, for the same reason described in [docs/DEPLOYMENT.md](DEPLOYMENT.md#10-backups): the database alone can't be decrypted without the matching `ENCRYPTION_KEY`.

**Stop the container before backing up.** The database runs in SQLite's WAL mode, so `vellum.db`, `vellum.db-shm`, and `vellum.db-wal` can all be mid-write at once while the container is running — tarring them live can produce a snapshot that won't restore cleanly. Stopping first guarantees a clean, consistent copy at the cost of a brief outage:

```bash
docker compose stop
docker volume ls   # find your volume's actual name — Compose prefixes it with your project
                    # directory name, e.g. vellum_vellum-data
docker run --rm -v <volume-name>:/data -v "$(pwd)":/backup debian:bookworm-slim \
  tar czf /backup/vellum-data-backup.tar.gz -C /data .
docker compose start
```

## Upgrading

```bash
git pull
docker compose up -d --build
```

The named volume is untouched by a rebuild, so your data and secrets persist across upgrades.

Schema changes apply automatically and incrementally when the container starts — existing projects, files, provider credentials, and settings are never wiped.

The image build now includes a client-asset build step (bundling the collaborative editor's dependencies) — `docker compose up -d --build` handles this automatically, same as before.
