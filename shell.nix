
let
  moz_overlay = import (builtins.fetchTarball https://github.com/mozilla/nixpkgs-mozilla/archive/master.tar.gz);
  pkgs = import <nixpkgs> { overlays = [ moz_overlay ]; };
in
  with pkgs;
  mkShell {
    buildInputs = [
      (pkgs.latest.rustChannels.stable.rust.override {
        targets = ["wasm32-unknown-unknown"];
      })
      pkgs.wasm-pack
      pkgs.binaryen
      pkgs.nodejs-18_x
      pkgs.pkg-config
      pkgs.openssl
    ];
  }
