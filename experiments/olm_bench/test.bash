#! /usr/bin/env nix-shell
#! nix-shell -p bash cowsay -i bash

HELLO="$(cat <&0)"

echo "$HELLO"

echo "$HELLO" | cowsay
