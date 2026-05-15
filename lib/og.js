/**
 * lib/og.js — server-side OG image generator.
 *
 * 1200×630 dark canvas, top-left brand mark and domain, center title in
 * display serif, optional italic subtitle below, URL bottom-right,
 * hairline rule near the bottom. Mirrors bin/gen-og.py.
 *
 * Returns a PNG Buffer via @vercel/og (Satori under the hood). We pass
 * plain `{type, props}` objects instead of React elements so we don't
 * need a React runtime dep — Satori accepts POJOs.
 *
 * Fonts are fetched lazily on first call (Google Fonts CDN) and memoized
 * in module scope. Failure throws and the upload pipeline treats OG
 * generation as best-effort, so an OG failure does not block a commit.
 */
import { ImageResponse } from '@vercel/og';

let _fontsPromise = null;
function loadFonts() {
  if (_fontsPromise) return _fontsPromise;
  _fontsPromise = (async () => {
    async function fetchFont(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch font ${url}: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }
    return [
      {
        name: 'CormorantGaramond',
        data: await fetchFont('https://fonts.gstatic.com/s/cormorantgaramond/v16/co3YmX5slCNuHLi8bLeY9MK7whWMhyjQAllvuQWJ5heb_w.ttf'),
        weight: 300,
        style: 'normal',
      },
      {
        name: 'CormorantGaramond',
        data: await fetchFont('https://fonts.gstatic.com/s/cormorantgaramond/v16/co3UmX5slCNuHLi8bLeY9MK7whWMhyjQAllvuQWJ5heb_yA.ttf'),
        weight: 300,
        style: 'italic',
      },
      {
        name: 'Inter',
        data: await fetchFont('https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf'),
        weight: 400,
        style: 'normal',
      },
    ];
  })();
  return _fontsPromise;
}

function el(type, props, ...children) {
  // Filter out null/undefined children — keeps the tree compact.
  const kids = children.flat().filter((c) => c != null && c !== false);
  return { type, props: { ...props, children: kids.length === 1 ? kids[0] : kids } };
}

/**
 * @param {{ title: string; subtitle?: string }} input
 * @returns {Promise<Buffer>} PNG bytes
 */
export async function renderOg({ title, subtitle }) {
  const fonts = await loadFonts();

  const node = el('div', {
    style: {
      width: '1200px',
      height: '630px',
      background: '#0d0d0d',
      color: '#f0ebe2',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '64px',
      fontFamily: 'Inter',
    },
  },
    // top chrome
    el('div', { style: { display: 'flex', alignItems: 'center', color: '#9b948a' } },
      el('span', { style: { fontSize: '14px', letterSpacing: '0.18em', textTransform: 'uppercase' } }, 'slides.elijahfrost.com'),
    ),

    // center title block
    el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1 } },
      el('div', { style: {
        fontFamily: 'CormorantGaramond',
        fontWeight: 300,
        fontSize: title.length > 32 ? '88px' : '116px',
        lineHeight: 1.05,
        color: '#f0ebe2',
        textAlign: 'center',
        maxWidth: '1000px',
      } }, title),
      subtitle ? el('div', { style: {
        fontFamily: 'CormorantGaramond',
        fontWeight: 300,
        fontStyle: 'italic',
        fontSize: '44px',
        color: '#bcb3a6',
        textAlign: 'center',
        marginTop: '24px',
        maxWidth: '900px',
      } }, subtitle) : null,
    ),

    // bottom chrome — hairline + url
    el('div', { style: { display: 'flex', flexDirection: 'column' } },
      el('div', { style: { height: '1px', background: 'rgba(240,235,226,0.18)', marginBottom: '20px' } }),
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', color: '#9b948a', fontSize: '14px' } }, 'slides.elijahfrost.com'),
    ),
  );

  const img = new ImageResponse(node, { width: 1200, height: 630, fonts });
  const arr = await img.arrayBuffer();
  return Buffer.from(arr);
}
