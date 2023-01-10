# Frida

## Documentation

In the root directory of this repository (the current directory), run:

```sh
npm install
```

to build dependencies. Then run:

```sh
make
```

to actually build the documentation. Then open `doc/index.html` in your preferred browser to view the documentation.

## Transpile TypeScript to JavaScript

```sh
node npx tsc --target es2022 --module es2022 --moduleResolution node [filename].ts
```
