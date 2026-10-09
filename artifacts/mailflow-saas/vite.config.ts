import path from 'path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import {
  canonicalUrl,
  PUBLIC_PAGE_METADATA,
  SOCIAL_IMAGE_ALT,
  SOCIAL_IMAGE_URL,
  type PublicPageMetadata,
} from './src/lib/public-page-meta';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function replaceRequired(
  html: string,
  pattern: RegExp,
  replacement: string,
  description: string,
) {
  if (!pattern.test(html)) {
    throw new Error(`Cannot generate route metadata: missing ${description} in index.html.`);
  }
  return html.replace(pattern, replacement);
}

function withPageMetadata(html: string, page: PublicPageMetadata) {
  const title = page.title;
  const description = page.description;
  const canonical = canonicalUrl(page.path);
  const replaceMeta = (attribute: 'name' | 'property', key: string, value: string) =>
    replaceRequired(
      html,
      new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*/?>`, 'i'),
      `<meta ${attribute}="${key}" content="${escapeHtmlAttribute(value)}" />`,
      `${attribute}=${key}`,
    );

  html = replaceRequired(
    html,
    /<title>[^<]*<\/title>/i,
    `<title>${escapeHtmlAttribute(title)}</title>`,
    'title',
  );
  html = replaceMeta('name', 'description', description);
  html = replaceMeta('property', 'og:title', title);
  html = replaceMeta('property', 'og:description', description);
  html = replaceMeta('property', 'og:url', canonical);
  html = replaceMeta('property', 'og:image', SOCIAL_IMAGE_URL);
  html = replaceMeta('property', 'og:image:alt', SOCIAL_IMAGE_ALT);
  html = replaceMeta('name', 'twitter:title', title);
  html = replaceMeta('name', 'twitter:description', description);
  html = replaceMeta('name', 'twitter:url', canonical);
  html = replaceMeta('name', 'twitter:image', SOCIAL_IMAGE_URL);
  html = replaceMeta('name', 'twitter:image:alt', SOCIAL_IMAGE_ALT);
  return replaceRequired(
    html,
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
    `<link rel="canonical" href="${canonical}" />`,
    'canonical link',
  );
}

function routeAwareSeoPlugin(): Plugin {
  return {
    name: 'mailflow-route-aware-seo',
    apply: 'build',
    async closeBundle() {
      const publicDir = path.resolve(import.meta.dirname, 'dist/public');
      const html = await readFile(path.join(publicDir, 'index.html'), 'utf8');

      for (const page of Object.values(PUBLIC_PAGE_METADATA)) {
        if (page.path === '/') continue;
        const routeHtmlPath = path.join(publicDir, page.path.slice(1), 'index.html');
        await mkdir(path.dirname(routeHtmlPath), { recursive: true });
        await writeFile(routeHtmlPath, withPageMetadata(html, page));
      }

      const sitemap = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...Object.values(PUBLIC_PAGE_METADATA).map(
          (page) => `  <url><loc>${canonicalUrl(page.path)}</loc></url>`,
        ),
        '</urlset>',
        '',
      ].join('\n');
      await writeFile(path.join(publicDir, 'sitemap.xml'), sitemap);
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    routeAwareSeoPlugin(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
