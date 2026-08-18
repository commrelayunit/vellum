# vellum

Vellum is a private, self-hostable writing workspace for humans and agents.

The goal is a simple shared writing surface: project files, live Markdown editing, file- and selection-scoped chat, visible agent presence, proposed edits, and git-like history without the noise of a general productivity dashboard.

## Product Direction

- document-first interface
- quiet paper/ink visual language
- live collaborator presence without theatrical typing
- range-aware agent review and rewrite actions
- named checkpoints, diffs, and restore
- Markdown first; later export/sync paths for repositories and document systems

## Docs

- [Product spec](docs/SPEC.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)

## Brand

Initial brand assets live in `assets/brand/`.

- `vellum-mark.svg` / `vellum-mark.png`: folded sheet + cursor mark
- `vellum-lockup.svg` / `vellum-lockup.png`: lowercase italic serif wordmark

The primary mark should stay free of notification dots, badges, mascot marks, or AI-gradient decoration. Agent presence belongs in the product interface state.

## MVP - Simplified Interface (M1)

This implementation includes:
- Project/file CRUD
- Markdown editor with minimal UI
- Save/load from database
- Preview toggle
- Download file
- Collapsible chat panel
- Monospace font styling

## Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the example env file and fill in the required values:
   ```bash
   cp .env.example .env
   ```

3. Generate a password hash for login and set it as `AUTH_PASSWORD_HASH` in `.env`:
   ```bash
   npm run hash-password -- "your chosen password"
   ```

4. Generate an encryption key for AI provider API keys and set it as `ENCRYPTION_KEY` in `.env` (it ships empty in `.env.example` — without it, saving a provider on the Settings page will fail):
   ```bash
   openssl rand -base64 32
   ```

5. Create and seed the SQLite database:
   ```bash
   npm run seed
   ```

6. Start the development server:
   ```bash
   npm start
   ```

7. Visit http://localhost:3001, sign in with the password you hashed in step 3, and access the application.

## Architecture

The MVP follows the implementation plan with these components:
- Express.js backend with EJS templating
- SQLite database for persistence (via `better-sqlite3`), with session-based single-password auth gating the app
- Simple frontend with CSS styling
- Minimalist UI focused on writing surface
- Collapsible chat panel
- Basic project/file navigation
- Markdown editing capabilities
- File history display
- Simple chat interface

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full Proxmox LXC setup (container creation, Tailscale, systemd service, backups, upgrades).

## Status

MVP - Local Private Workspace (M1) with simplified UI

The current implementation provides:
- Clean, minimalist writing surface
- Monospace font (Courier New) 
- No borders or excessive styling
- Collapsible chat panel
- All core functionality working

## License

MIT