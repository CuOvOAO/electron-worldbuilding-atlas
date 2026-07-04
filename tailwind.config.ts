import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--ma-paper-base)',
        panel: 'var(--ma-paper-panel)',
        raised: 'var(--ma-paper-raised)',
        parchment: 'var(--color-old-paper)',
        vellum: 'var(--color-vellum)',
        ink: 'var(--color-cowhide-cocoa)',
        muted: 'var(--ma-ink-muted)',
        sepia: 'var(--color-olive-harvest)',
        copper: 'var(--color-spiced-wine)',
        umber: 'var(--color-toasted-caramel)',
        cowhide: 'var(--color-cowhide-cocoa)',
        wine: 'var(--ma-wine)',
        caramel: 'var(--color-toasted-caramel)',
        olive: 'var(--color-olive-harvest)',
        batter: 'var(--color-golden-batter)',
        inkblue: 'var(--ma-ink-blue)',
        danger: 'var(--ma-danger)',
        success: 'var(--ma-success)',
        spiced: 'var(--ma-danger)'
      },
      boxShadow: {
        folio: 'var(--ma-shadow-md)',
        panel: 'var(--ma-shadow-sm)'
      }
    }
  },
  plugins: []
} satisfies Config;
