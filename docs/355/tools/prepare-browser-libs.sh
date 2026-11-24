#!/bin/sh
# Download/extract browser libraries into a private tree. No dpkg installation,
# global package/configuration changes, daemons or service restarts.
set -eu
target=$1
browser=$2
test ! -e "$target"
mkdir -p "$target/debs" "$target/runtime"
ldd "$browser" > "$target/ldd-before.txt"
cd "$target/debs"
apt-get download libnspr4 libnss3 libasound2t64
for package in ./*.deb; do
  dpkg-deb -f "$package" Package Version Architecture
  sha256sum "$package"
  dpkg-deb -x "$package" "$target/runtime"
done
export LD_LIBRARY_PATH="$target/runtime/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
ldd "$browser" > "$target/ldd-after.txt"
if grep -q 'not found' "$target/ldd-after.txt"; then cat "$target/ldd-after.txt"; exit 1; fi
printf '%s\n' 'Browser libraries prepared privately; zero system package installations.'
