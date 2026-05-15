/**
 * lib/og.js — server-side OG image generator.
 *
 * Mirrors bin/gen-og.py: 1200×630 dark canvas, top-left brand mark and
 * domain, center title in display serif, optional italic subtitle below,
 * URL bottom-right, hairline rule near the bottom.
 *
 * Uses @vercel/og (Satori under the hood). Returns a PNG Buffer.
 *
 * For now we ship a no-frills version using React.createElement directly
 * so the file is plain JS (no JSX build step needed). When we want to
 * refine the layout, switch the file to .jsx and use JSX syntax.
 */
import { ImageResponse } from '@vercel/og';
import React from 'react';

const FONTS_PROMISE = loadFonts();

async function loadFonts() {
  // @vercel/og can load fonts from URLs at runtime. We use the same Google
  // Fonts the decks themselves use so OG cards match the visual language.
  // We grab one weight each (display serif for title, sans for chrome).
  async function fetchFont(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch font ${url}`);
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
}

/**
 * @param {{ title: string; subtitle?: string }} input
 * @returns {Promise<Buffer>} PNG bytes
 */
export async function renderOg({ title, subtitle }) {
  const fonts = await FONTS_PROMISE;
  const h = React.createElement;

  const node = h('div', {
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
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', color: '#9b948a' } },
      // simple orbit mark (svg)
      h('svg', { width: '28', height: '28', viewBox: '0 0 32 32', fill: 'none', stroke: 'currentColor', strokeWidth: '1' },
        h('circle', { cx: '16', cy: '16', r: '11' }),
        h('circle', { cx: '16', cy: '16', r: '5' }),
        h('circle', { cx: '16', cy: '16', r: '1.2', fill: 'currentColor', stroke: 'none' })
      ),
      h('span', { style: { fontSize: '14px', letterSpacing: '0.18em', textTransform: 'uppercase' } }, 'slides.elijahfrost.com')
    ),

    // center title block
    h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '24px' } },
      h('div', { style: {
        fontFamily: 'CormorantGaramond',
        fontWeight: 300,
        fontSize: title.length > 32 ? '88px' : '116px',
        lineHeight: 1.05,
        color: '#f0ebe2',
        textAlign: 'center',
        maxWidth: '1000px',
      } }, title),
      subtitle ? h('div', { style: {
        fontFamily: 'CormorantGaramond',
        fontWeight: 300,
        fontStyle: 'italic',
        fontSize: '44px',
        color: '#bcb3a6',
        textAlign: 'center',
        maxWidth: '900px',
      } }, subtitle) : null
    ),

    // bottom chrome — hairline + url
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px' } },
      h('div', { style: { height: '1px', background: 'rgba(240,235,226,0.18)' } }),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', color: '#9b948a', fontSize: '14px' } }, 'slides.elijahfrost.com')
    )
  );

  const img = new ImageResponse(node, { width: 1200, height: 630, fonts });
  const arr = await img.arrayBuffer();
  return Buffer.from(arr);
}
