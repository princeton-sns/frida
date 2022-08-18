{ pkgs ? import <nixpkgs> {} }:
  pkgs.mkShell {
    buildInputs = [
      pkgs.texlive.combined.scheme-full
      pkgs.python3
      pkgs.python3Packages.pygments
    ];
}
