{ pkgs ? import <nixpkgs> {}, gitRev ? null}:

let

  lib = pkgs.lib;

  noiseRepo = builtins.fetchGit ({
    url = "http://github.com/princeton-sns/frida.git";
  } // (if isNull gitRev then {
    ref = "refs/heads/config-app"; 
  } else {
    ref = "refs/heads/config-app"; 
    rev = gitRev;
  }));

  #noiseSrc = ./frida;
  noiseSrc = noiseRepo;

  server = pkgs.buildGoModule {
    name = "noise-server";
    src = "${noiseSrc}/server";
    vendorSha256 = "sha256-VXPapqFwdruTj5tlPeeFysFBEpkAI3RlV4+g+Cf0XmM=";
  };

  clients = lib.mapAttrsToList (clientName: clientVendorSha256:
    pkgs.buildGoModule {
      name = "noise-${clientName}-client";
      src = "${noiseSrc}/experiments/${clientName}";
      vendorSha256 = clientVendorSha256;
    }
  ) {
    "latency_bench" =  "sha256-o4qubDVZe4/zYnflpS8wFgM4fwrugpDvhjTKx7XNQpk=";
    "groupsize_bench" =  "sha256-1OgaWVn0CcSs2f5PPRvoNfFa+4fORqB2hTu4APZl8QM=";
    "throughput_bench" =  "sha256-1OgaWVn0CcSs2f5PPRvoNfFa+4fORqB2hTu4APZl8QM=";
  };

  otherDerivs = pkgs.linkFarm "noise-eval-derivs" [
    { name = "src"; path = noiseSrc; }
  ];

in
  pkgs.symlinkJoin {
    name = "noise-eval";
    paths = [ otherDerivs server ] ++ clients;
  }
