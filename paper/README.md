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

- [ ] [All] Paper writing!!
- [ ] [Natalie] Group encryption
- [ ] [Shai/Leon] Persistent DB server (maybe better data structure; maybe Rust/Go)
- [ ] [Leo] Configurable app
- [ ] [Chris] IoT lightswitch app
- [X] [Shai/Leon] Flesh out byzantine server detection protocol (~1 paper paragraph)
- [X] [Shai] App invariant enforcement
- [ ] [?] Server macro-benchmarks
- [ ] [?] Server micro-benchmarks (per feature; also storage overhead, etc)
- [ ] [?] Social media app
- [ ] [?] Text messaging app (perhaps embedded in social media app)
- [ ] [?] Chess app
- [ ] [?] Mobile app
