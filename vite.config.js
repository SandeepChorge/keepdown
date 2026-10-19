import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';

/**
 * Adds a strict Content-Security-Policy to the published page (not the dev server, whose live
 * reload needs inline styles and a websocket). Inline scripts are allowed only by their exact
 * hash, which is computed here, so editing the small theme script in index.html needs no other change.
 */
function contentSecurityPolicy() {
  return {
    name: 'keepdown-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
          .map(m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
        const policy = [
          "default-src 'none'",
          ["script-src 'self'", ...hashes].join(' '),
          "style-src 'self' https://fonts.googleapis.com",
          'font-src https://fonts.gstatic.com',
          'connect-src https://api.github.com',
          'img-src https: data: blob:',
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; ');
        return html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${policy}">`);
      },
    },
  };
}

export default defineConfig({
  base: '/keepdown/',            // served from https://sandeepchorge.github.io/keepdown/
  plugins: [contentSecurityPolicy()],
});
