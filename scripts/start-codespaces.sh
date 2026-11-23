#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Select the repository's required Node version when nvm is available in Codespaces.
if ! command -v nvm >/dev/null 2>&1; then
  if [[ -n "${NVM_DIR:-}" && -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "$NVM_DIR/nvm.sh"
  elif [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.nvm/nvm.sh"
  fi
fi

if command -v nvm >/dev/null 2>&1; then
  nvm install 22
  nvm use 22
fi

if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  echo "This project requires Node 22. Install/select Node 22, then rerun: npm run dev:codespaces:start" >&2
  exit 1
fi

if [[ ! -f .local/development/runtime.json ]]; then
  echo "First-time setup: preparing the isolated development database and runtime."
  npm run dev:setup
fi

# This setup is safe to rerun: it reuses the persisted preview identity and
# workspace ID, brings the identity/TLS containers up, and reconciles the seed.
# Secrets and local runtime state remain in the ignored .local/ directory.
npm run dev:codespaces:setup

# The server starts the dashboard and worker together and performs DB recovery
# if the existing development database container was stopped with the Codespace.
exec npm run dev:serve -- --codespaces
