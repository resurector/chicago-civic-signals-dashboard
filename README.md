# Before Crime Shows Up

A static React dashboard for exploring Chicago crime, 311 civic-condition signals, and CTA station catchments from a local Neo4j graph.

The hosted app only needs static files:

- `public/data/civic-signals.json`
- `public/data/community-areas.geojson`

Neo4j is used only during export.

## Export Data

```bash
python export_civic_signals.py --password neoadmin
```

## Run Locally

```bash
npm install
npm run dev
```

## GitHub Pages

Set the Vite base path to your repo name when building:

```bash
VITE_BASE=/your-repo-name/ npm run build
```

Then publish `dist/`, or use:

```bash
VITE_BASE=/your-repo-name/ npm run deploy
```
