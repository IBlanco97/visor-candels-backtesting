# build-resources

This directory must contain the app icon before running `npm run electron:build`.

## Required file

**`icon.ico`** — Windows icon, 256×256 px minimum.

### How to create it

1. Prepare a 256×256 PNG with your logo.
2. Convert to `.ico` using any of these free tools:
   - https://www.icoconverter.com/
   - https://convertio.co/png-ico/
   - ImageMagick: `magick logo.png -define icon:auto-resize=256,128,64,32,16 icon.ico`
3. Place the resulting `icon.ico` in this directory.

If you skip this step, remove the `icon` references from `electron-builder.yml` and `electron/main.js`
before building (the build will still work, just with the default Electron icon).
