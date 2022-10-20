# OSDI 23 Paper

## Build

### On NixOS (sns cluster)

```sh
nix-shell
make
```

Paper output will be in `paper.pdf`.

### On Linux

TODO

## Work distribution

### By 10/27/22

- [ ] [All] Paper writing!! (design; threat model; paper outline; encryption background)
- [ ] [Natalie] Olm group encryption (and maybe contact bootstrapping stuff)
- [ ] [Shai/Leon] Persistent DB server (maybe better data structure; maybe Rust/Go)
- [ ] [Leo] Configurable app
- [ ] [Chris] IoT lightswitch app
- [ ] [Leon] Flesh out byzantine server detection protocol (~1 paper paragraph)
- [ ] [Shai] App invariant enforcement

### Future weeks

- [ ] [?] Server macro-benchmarks
- [ ] [?] Server micro-benchmarks (per feature; also storage overhead, etc)
- [ ] [?] Social media app
- [ ] [?] Text messaging app (perhaps embedded in social media app)
- [ ] [?] Mobile app
