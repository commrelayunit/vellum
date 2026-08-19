# Running Vellum with Docker

This runs Vellum in a single container, with SQLite data and secrets persisted in a named Docker volume.

## Prerequisites

- Docker and Docker Compose installed.

## 1. Configure

Set your login password as an environment variable, either in your shell or in a `.env` file next to `docker-compose.yml` (Docker Compose loads that file automatically for variable substitution — separate from the app's own `dotenv`-based `.env` handling, which only applies when running outside Docker):

```
AUTH_PASSWORD=your-chosen-password
```

That's the only value you need to provide. `SESSION_SECRET` and `ENCRYPTION_KEY` are generated automatically on first start and saved into the same persistent volume as the database, so they survive container restarts and upgrades without any action from you.

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

Visit `http://localhost:3001` and sign in with your `AUTH_PASSWORD`.

## Changing the port

```bash
PORT=8080 docker compose up -d
```

## Backups

The named volume holds both the SQLite database and the generated secrets file (`.secrets.env`) — back up the whole volume together, not just the database, for the same reason described in [docs/DEPLOYMENT.md](DEPLOYMENT.md#10-backups): the database alone can't be decrypted without the matching `ENCRYPTION_KEY`. Find your volume's actual name with `docker volume ls` (Compose prefixes it with your project directory name, e.g. `vellum_vellum-data`), then:

```bash
docker run --rm -v <volume-name>:/data -v "$(pwd)":/backup debian:bookworm-slim \
  tar czf /backup/vellum-data-backup.tar.gz -C /data .
```

## Upgrading

```bash
git pull
docker compose up -d --build
```

The named volume is untouched by a rebuild, so your data and secrets persist across upgrades.
