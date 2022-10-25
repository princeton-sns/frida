{ pkgs ? import <nixpkgs> {} }:
  pkgs.mkShell {
    buildInputs = [
      pkgs.nodePackages.npm
      pkgs.nodejs-14_x
    ];
}
