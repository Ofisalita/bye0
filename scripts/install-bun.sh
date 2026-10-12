#!/usr/bin/env bash
# Installs Bun (https://bun.sh), the runtime bye0 runs on, for the current user.
# It goes into ~/.bun (or $BUN_INSTALL) and needs no sudo.
#
#   scripts/install-bun.sh            latest release
#   scripts/install-bun.sh 1.4.3      a specific version
set -euo pipefail

version=${1:-}
bun_bin="${BUN_INSTALL:-$HOME/.bun}/bin/bun"

if command -v bun >/dev/null; then
	echo "Bun $(bun --version) is already installed: $(command -v bun)"
	exit 0
fi
if [[ -x $bun_bin ]]; then
	echo "Bun $("$bun_bin" --version) is already installed at $bun_bin, but it isn't on your PATH."
	echo "Open a new terminal, or run: export PATH=\"$(dirname "$bun_bin"):\$PATH\""
	exit 0
fi

for tool in curl unzip; do
	if ! command -v "$tool" >/dev/null; then
		echo "Bun's installer needs '$tool'. Install it with your package manager and run this again." >&2
		exit 1
	fi
done

# Download first, so a dropped connection can't leave a half-read script running.
installer=$(mktemp)
trap 'rm -f "$installer"' EXIT
curl -fsSL https://bun.sh/install -o "$installer"
# The official installer also adds Bun to PATH in your shell's startup file.
bash "$installer" ${version:+"bun-v$version"}

cat <<NEXT

Bun is installed. Open a new terminal (or run: exec \$SHELL), then from this repo:

  bun install
  bun run dev:server            # the party server, on port 3001
  bun run dev:web -- --host     # the web app, on port 5173
NEXT
