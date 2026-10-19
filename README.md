# Keepdown

A Markdown scratchpad with live preview, for things you paste now and need months later.

**Open it:** https://sandeepchorge.github.io/keepdown/

- Paste anywhere on the page to save your clipboard as a new note
- Write / Split / Read views, GitHub-style Markdown, highlighted code blocks with copy buttons
- Search, pin, download as `.md`, import `.md` files, back up everything to one file
- Light/dark theme and a collapsible sidebar, both remembered per device

## Where notes are stored

Until you connect GitHub, notes stay in the browser you wrote them in.

Click **Set up GitHub sync** (bottom left) to save every note as a Markdown file in the private repo
[`SandeepChorge/keepdown-notes`](https://github.com/SandeepChorge/keepdown-notes). Every device that
connects to it shows the same notes, and every edit and deletion stays in that repo's history.

It needs a fine-grained personal access token with:

- **Repository access:** only `keepdown-notes`
- **Permissions:** Contents → Read and write

The token is kept only in the browser where you paste it. If it expires, the app asks you to reconnect,
and anything you wrote in the meantime syncs once you do.

## Development

Needs Node 20.19 or newer.

```bash
npm install        # once
npm run dev        # http://localhost:5173/keepdown/ — reloads as you save
npm run build      # production files in dist/
npm run preview    # serve dist/ locally to check a build
```

Pushing to `main` builds the site and deploys it to GitHub Pages (`.github/workflows/deploy.yml`),
usually within two minutes. If a build fails, the live site stays on the previous version.

## Project layout

```
index.html          page markup; a tiny inline script applies the saved theme before first paint
vite.config.js      base path /keepdown/, and the security policy added to built pages
src/
  main.js           starts the app: buttons, shortcuts, paste, drag and drop
  notes.js          notes, browser storage, titles and search
  github.js         GitHub sync: saving, loading, conflicts, retries
  ui.js             note list, toolbar, status, preview, toasts
  editor.js         Tab indent, list continuation, scroll sync
  markdown.js       Markdown rendering, HTML cleaning, code highlighting
  files.js          copy, download, import, backup
  dialog.js         the GitHub sync dialog
  prefs.js          theme and sidebar preferences
  events.js         small message bus between the data and the screen
  util.js           shared helpers
  styles.css        all styles; colors are tokens with light and dark values
```

Each note is stored at `notes/<id>.md` with a short header holding its created and updated times.

## Credits

- [marked](https://github.com/markedjs/marked) (MIT) for Markdown
- [DOMPurify](https://github.com/cure53/DOMPurify) (Apache-2.0 / MPL-2.0) to clean rendered HTML
- [highlight.js](https://highlightjs.org/) (BSD-3-Clause) for code colors
- Pin, copy, trash and history icons are based on [Lucide](https://lucide.dev) (ISC License, © Lucide Contributors)
- [Schibsted Grotesk](https://fonts.google.com/specimen/Schibsted+Grotesk) (SIL Open Font License)
