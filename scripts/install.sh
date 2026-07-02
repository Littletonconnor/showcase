#!/bin/sh
# One-command install for showcase: clone (or update) the engine, build the
# viewer, and put a `showcase` shim on PATH. The npm registry can't carry this
# fork (the "showcase" package name belongs to an unrelated project), so the
# install unit is the repo itself — which the CLI's run-from-source design
# (Node ≥ 22.18 type-stripping, zero runtime deps) makes cheap.
#
#   curl -fsSL https://raw.githubusercontent.com/Littletonconnor/showcase/main/scripts/install.sh | sh
#
# Overridables:
#   SHOWCASE_REPO         git URL (or local path) to install from
#   SHOWCASE_INSTALL_DIR  where the engine lives   (default ~/.showcase/app)
#   SHOWCASE_BIN_DIR      where the shim goes      (default ~/.local/bin)
set -eu

REPO="${SHOWCASE_REPO:-https://github.com/Littletonconnor/showcase.git}"
APP_DIR="${SHOWCASE_INSTALL_DIR:-$HOME/.showcase/app}"
BIN_DIR="${SHOWCASE_BIN_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "showcase install: $*"; }
die() { printf '%s\n' "showcase install: $*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is required"
command -v node >/dev/null 2>&1 || die "node is required (>= 22.18)"

# The engine runs TypeScript directly via type stripping — hard-require the
# floor here so the failure is one clear line, not a runtime stack trace.
node -e 'const [ma,mi]=process.versions.node.split(".").map(Number);
if (ma<22||(ma===22&&mi<18)) { console.error("node "+process.version+" is too old — need >= 22.18 (nvm install 22, or 24)"); process.exit(1); }' \
  || exit 1

if command -v pnpm >/dev/null 2>&1; then
  PNPM=pnpm
elif command -v corepack >/dev/null 2>&1; then
  say "pnpm not found — activating via corepack"
  corepack enable pnpm >/dev/null 2>&1 || true
  command -v pnpm >/dev/null 2>&1 && PNPM=pnpm || PNPM="corepack pnpm"
else
  die "pnpm is required (npm i -g pnpm, or enable corepack)"
fi

if [ -d "$APP_DIR/.git" ]; then
  say "updating existing install in $APP_DIR"
  git -C "$APP_DIR" pull --ff-only
else
  say "cloning $REPO -> $APP_DIR"
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --depth 1 "$REPO" "$APP_DIR"
fi

say "installing dependencies"
$PNPM -C "$APP_DIR" install --frozen-lockfile
say "building the viewer"
$PNPM -C "$APP_DIR" build:viewer

mkdir -p "$BIN_DIR"
# A shim, not a symlink: the bin must run from the engine checkout regardless
# of how the shim is invoked, and a shim survives the checkout moving node
# versions under nvm.
cat > "$BIN_DIR/showcase" <<SHIM
#!/bin/sh
exec node "$APP_DIR/packages/cli/bin/showcase.js" "\$@"
SHIM
chmod +x "$BIN_DIR/showcase"

say "installed. Try: showcase doctor"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "note: $BIN_DIR is not on your PATH — add it to your shell profile" ;;
esac
say "always-on server: showcase service install   (launchd/systemd)"
