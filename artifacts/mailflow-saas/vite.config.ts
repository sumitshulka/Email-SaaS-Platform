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

function metaAttribute(tag: string, attribute: string) {
  const match = tag.match(new RegExp(`\\b${attribute}="([^"]*)"`, 'i'));
  return match?.[1];
}

function requiredMetaContent(
  html: string,
  attribute: 'name' | 'property',
  key: string,
  routePath: string,
) {
  const matchingTags = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .filter((tag) => metaAttribute(tag, attribute) === key);
  if (matchingTags.length !== 1) {
    throw new Error(
      `Production metadata check failed for ${routePath}: expected exactly one ${attribute}="${key}" tag, found ${matchingTags.length}.`,
    );
  }

  const content = metaAttribute(matchingTags[0], 'content');
  if (!content) {
    throw new Error(
      `Production metadata check failed for ${routePath}: ${attribute}="${key}" has no content.`,
    );
  }
  return content;
}

async function verifyPublicSocialMetadata(
  publicDir: string,
  pages: PublicPageMetadata[],
) {
  const imageUrl = new URL(SOCIAL_IMAGE_URL);
  if (
    !['http:', 'https:'].includes(imageUrl.protocol) ||
    imageUrl.username ||
    imageUrl.password ||
    imageUrl.pathname !== '/mailflow-social-share.png'
  ) {
    throw new Error(
      `Production metadata check failed: SOCIAL_IMAGE_URL must be an absolute HTTP(S) URL to /mailflow-social-share.png; received "${SOCIAL_IMAGE_URL}".`,
    );
  }

  const imagePath = path.join(publicDir, imageUrl.pathname.slice(1));
  let image: Buffer;
  try {
    image = await readFile(imagePath);
  } catch {
    throw new Error(
      `Production metadata check failed: the copied social image is missing at ${imagePath}.`,
    );
  }

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (
    image.length < 24 ||
    !image.subarray(0, 8).equals(pngSignature) ||
    image.readUInt32BE(12) !== 0x49484452
  ) {
    throw new Error(
      `Production metadata check failed: ${imagePath} is not a valid PNG with an IHDR header.`,
    );
  }

  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (width !== 1200 || height !== 630) {
    throw new Error(
      `Production metadata check failed: social image must be 1200×630; found ${width}×${height}.`,
    );
  }

  for (const page of pages) {
    const routeHtmlPath =
      page.path === '/'
        ? path.join(publicDir, 'index.html')
        : path.join(publicDir, page.path.slice(1), 'index.html');
    const html = await readFile(routeHtmlPath, 'utf8');

    for (const [attribute, key] of [
      ['property', 'og:image'],
      ['name', 'twitter:image'],
    ] as const) {
      const content = requiredMetaContent(html, attribute, key, page.path);
      let taggedImageUrl: URL;
      try {
        taggedImageUrl = new URL(content);
      } catch {
        throw new Error(
          `Production metadata check failed for ${page.path}: ${attribute}="${key}" must use an absolute image URL.`,
        );
      }
      if (
        !['http:', 'https:'].includes(taggedImageUrl.protocol) ||
        taggedImageUrl.href !== SOCIAL_IMAGE_URL
      ) {
        throw new Error(
          `Production metadata check failed for ${page.path}: ${attribute}="${key}" must point to ${SOCIAL_IMAGE_URL}; received "${content}".`,
        );
      }
    }
  }
}

function routeAwareSeoPlugin(): Plugin {
  return {
    name: 'mailflow-route-aware-seo',
    apply: 'build',
    async closeBundle() {
      const publicDir = path.resolve(import.meta.dirname, 'dist/public');
      const html = await readFile(path.join(publicDir, 'index.html'), 'utf8');

      const pages = Object.values(PUBLIC_PAGE_METADATA);
      for (const page of pages) {
        if (page.path === '/') continue;
        const routeHtmlPath = path.join(publicDir, page.path.slice(1), 'index.html');
        await mkdir(path.dirname(routeHtmlPath), { recursive: true });
        await writeFile(routeHtmlPath, withPageMetadata(html, page));
      }

      await verifyPublicSocialMetadata(publicDir, pages);

      const sitemap = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...pages.map(
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
