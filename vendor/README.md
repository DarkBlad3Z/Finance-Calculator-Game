# vendor/

Drop `chart.umd.js` here to make `forecaster.html` work fully offline.

```
curl -O https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js
mv chart.umd.js vendor/
node build.js
```

`build.js` inlines it and removes the CDN tag. Without it the bundle
still works — it loads Chart.js from the CDN, and if that is blocked the
app draws its own simpler SVG charts and says so on screen.

This directory is gitignored apart from this file, so the library is not
committed.
