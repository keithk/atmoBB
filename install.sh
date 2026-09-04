#!/bin/sh
# Bootstrap the latest atmobb release bundle, then hand off to its installer.
# The release's ./atmobb script owns configuration and container setup.
set -eu

REPOSITORY=keithk/atmoBB
INSTALL_DIR=/srv/atmobb

die() {
  echo "atmobb installer: $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

for command in curl jq openssl sudo tar; do
  need "$command"
done

[ "$(id -u)" -ne 0 ] || die "run this as your normal login user, not with sudo"
[ ! -e "$INSTALL_DIR/.env" ] ||
  die "$INSTALL_DIR is already configured; follow the upgrade instructions instead"
[ ! -d "$INSTALL_DIR/.git" ] ||
  die "$INSTALL_DIR is a source checkout; use infra/install-self-host.sh there"
if ! (: </dev/tty) 2>/dev/null; then
  die "an interactive terminal is required"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' HUP INT TERM

echo "== finding the latest atmobb release"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  -H 'Accept: application/vnd.github+json' \
  -H 'User-Agent: atmobb-installer' \
  "https://api.github.com/repos/$REPOSITORY/releases/latest" \
  -o "$tmp/release.json"

tag=$(jq -er '.tag_name | select(type == "string" and test("^v[0-9]+\\.[0-9]+\\.[0-9]+$"))' "$tmp/release.json") ||
  die "the latest GitHub release does not have a valid version tag"
version=${tag#v}
asset="atmobb-$version.tar.gz"
bundle_url=$(jq -er --arg name "$asset" '.assets[] | select(.name == $name) | .browser_download_url' "$tmp/release.json") ||
  die "$asset is missing from release $tag"
sums_url=$(jq -er '.assets[] | select(.name == "SHA256SUMS") | .browser_download_url' "$tmp/release.json") ||
  die "SHA256SUMS is missing from release $tag"

echo "== downloading atmobb $version"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error --retry 3 \
  "$bundle_url" -o "$tmp/$asset"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error --retry 3 \
  "$sums_url" -o "$tmp/SHA256SUMS"

expected=$(awk -v name="$asset" '$2 == name || $2 == "*" name { print tolower($1); exit }' "$tmp/SHA256SUMS")
case "$expected" in
  *[!0-9a-f]*|'') die "SHA256SUMS does not contain a valid checksum for $asset" ;;
esac
[ "${#expected}" -eq 64 ] || die "SHA256SUMS contains an invalid checksum for $asset"
actual=$(openssl dgst -sha256 "$tmp/$asset" | awk '{print tolower($NF)}')
[ "$actual" = "$expected" ] || die "checksum verification failed for $asset"
tar -tzf "$tmp/$asset" >/dev/null || die "$asset is not a valid release bundle"

echo "== installing the release bundle in $INSTALL_DIR"
sudo install -d -o "$(id -u)" -g "$(id -g)" -m 755 "$INSTALL_DIR"
tar -xzf "$tmp/$asset" --strip-components=1 -C "$INSTALL_DIR"
[ -x "$INSTALL_DIR/atmobb" ] || die "the release bundle does not contain ./atmobb"

echo "== starting interactive setup"
"$INSTALL_DIR/atmobb" install --caddy </dev/tty
