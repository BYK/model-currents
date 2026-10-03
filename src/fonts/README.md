# Site fonts

These WOFF2 files are Iosevka, Iosevka Aile, and Iosevka Etoile from the
`@fontsource/*` packages at version `5.3.0`. They are licensed under the
[SIL Open Font License](../../public/fonts/LICENSE).

The site uses regular Iosevka for commands, regular Iosevka Etoile for titles,
and regular, semibold, and bold Iosevka Aile for everything else. Each file is
subset from its package's `files/*-latin-<weight>-normal.woff2` with FontTools:

```sh
uvx --from 'fonttools[woff]' pyftsubset INPUT.woff2 --output-file=OUTPUT.woff2 --flavor=woff2 --unicodes='U+0020-024F,U+2000-206F,U+20A0-20CF,U+2190-21FF,U+2600-26FF' --layout-features='*'
```

Characters outside this range fall back to system fonts. The site serves its
own font files; it makes no font-provider requests from visitors' browsers.
