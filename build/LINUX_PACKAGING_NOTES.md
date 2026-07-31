# Linux packaging notes

## Why `build.pacman.depends` is overridden in package.json

electron-builder's pacman target goes through [fpm](https://fpm.readthedocs.io/),
and when no `depends` list is supplied it falls back to its own hardcoded
default (`app-builder-lib/out/targets/FpmTarget.js`, `getDefaultDepends`, the
`"pacman"` case):

```
c-ares, ffmpeg, gtk3, http-parser, libevent, libvpx, libxslt, libxss,
minizip, nss, re2, snappy, libnotify, libappindicator-gtk3
```

Several of these are **not installable on a current Arch system** —
`http-parser`, `c-ares`, `re2`, `snappy`, `minizip`, and `libevent` are
Chromium-internal libraries that Electron bundles statically into its binary
and have not been separate distro packages for years. Building a `.pacman`
without overriding this list produces an install that fails immediately:

```
error: cannot resolve "http-parser", a dependency of atlas
```

`package.json` now sets `build.pacman.depends` explicitly, which bypasses
`getDefaultDepends` entirely (fpm only falls back to the hardcoded list when
`depends` is `null`/absent).

### It goes at the TOP LEVEL, not under `linux`

`pacman` is a target config and a **sibling** of `linux`, not a child of it:

```json
"build": {
  "linux":  { "target": ["deb", "AppImage", "pacman"] },
  "pacman": { "depends": [...] }
}
```

`LinuxConfiguration` in electron-builder's schema has
`additionalProperties: false`, so nesting it under `linux` fails the whole
build before any packaging work happens:

```
Invalid configuration object.
 - configuration.linux should be one of these:
   null
```

`tests/pacman-depends.test.js` validates `build` against
`app-builder-lib/scheme.json` — the same schema the build uses — so this class
of mistake fails locally instead of in CI.

## The current list is a starting point, not verified against a live repo

This work was done without access to a real Arch package repository, so the
override is the standard, widely-used set for Electron apps on Arch (the same
shape used by mainstream Electron AUR packages) — **not** something checked
against `pacman -Si` on an actual system. Before your next release build,
confirm each one resolves:

```bash
pacman -Si gtk3 nss libxss libnotify alsa-lib
```

If a name has changed or split (Arch does rename packages over time —
`libxss` in particular has moved before), update
`build.pacman.depends` in `package.json` to match, then rebuild.

If you hit a *different* unresolved dependency after this fix, it means one of
these five is now wrong on your distro version — check `pacman -Si <name>`
first before assuming it's a new instance of the same class of bug.
