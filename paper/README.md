# OSDI 23 Paper

## On NixOS (sns cluster)

### Install required packages

```sh
nix-shell
```

### Build

```sh
make
```

### View PDF

TODO

## On Linux

### Install required packages

```sh
sudo apt-get install texlive-latex-base
sudo apt-get install texlive-fonts-recommended
```

and optionally:

```sh
sudo apt-get install texlive-fonts-extra
```

### Build

```sh
make
```

### View PDF

```sh
evince paper.pdf
```

## On Mac

### Build

```sh
make
```

### View PDF

```sh
open paper.pdf
```

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
