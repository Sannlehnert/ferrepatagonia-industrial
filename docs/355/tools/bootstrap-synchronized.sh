#!/bin/sh
# Creates only new Git storage/worktrees. Does not restart or configure services.
set -eu
source_repo=$1
destination_prefix=$2
node_bin=$3
export PATH="$node_bin:$PATH"
node --version
npm --version
test ! -e "$destination_prefix-git"
git clone --no-hardlinks --no-checkout "$source_repo" "$destination_prefix-git"
git -C "$destination_prefix-git" worktree add --detach "$destination_prefix-initial" 2616f478fe648dfa0ee1ee96b012273173cc9dd5
git -C "$destination_prefix-git" worktree add --detach "$destination_prefix-post335" d0e18514a46083aa3921acdf70c79dfa35500229
