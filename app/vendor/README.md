# Vendored code

Served from this site so the pages need no third-party scripts (the `#tel=` link must not leak).

| File | From | Licence |
|---|---|---|
| `qrcode-generator-2.0.4.js` | npm `qrcode-generator` 2.0.4, `dist/qrcode.js`, unchanged. Integrity `sha512-mZSiP6RnbHl4xL2Ap5HfkjLnmxfKcPWpWe/c+5XxCuetEenqmNFf1FH/ftXPCtFG5/TDobjsjz6sSNL0Sr8Z9g==` | MIT, © 2009 Kazuhiko Arase (header in the file) |
| `jsQR-1.4.0.js` | npm `jsqr` 1.4.0, `dist/jsQR.js`, unchanged. Integrity `sha512-dxLob7q65Xg2DvstYkRpkYtmKm2sPJ9oFhrhmudT1dZvNFFTlroai3AWSpLey/w5vMcLBXRgOJsbXpdN9HzU/A==`. Reads QR codes from the camera for Settings › Share › Scan QR code. | Apache-2.0, [github.com/cozmo/jsQR](https://github.com/cozmo/jsQR); full text in `jsQR-1.4.0.LICENSE.txt` |

To update: download the new tarball from the npm registry, check its integrity against the registry's, and copy `dist/qrcode.js` in.
