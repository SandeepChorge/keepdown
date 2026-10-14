# Keepdown

A Markdown scratchpad with live preview, for things you paste now and need months later.

**Open it:** https://sandeepchorge.github.io/keepdown/

- Paste anywhere on the page to save your clipboard as a new note
- Write / Split / Read views, GitHub-style Markdown, highlighted code blocks with copy buttons
- Search, pin, download as `.md`, import `.md` files, back up everything to one file

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

## How it works

One file, `index.html`, with no build step. It uses [marked](https://github.com/markedjs/marked) for Markdown,
[DOMPurify](https://github.com/cure53/DOMPurify) to clean the rendered HTML, and
[highlight.js](https://highlightjs.org/) for code. Each note is stored at `notes/<id>.md` with a short header
holding its created and updated times.
