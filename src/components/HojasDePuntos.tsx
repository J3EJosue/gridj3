import { useEffect, useRef, useState } from 'react';
// jsPDF (and its transitive html2canvas/dompurify deps) is ~400KB and is only
// ever needed once the user clicks "Descargar PDF" — loading it eagerly would
// bloat the initial bundle everyone pays for, so it's dynamically imported
// inside downloadPdf() instead, putting it in its own on-demand chunk.

type PaperKey = 'letter' | 'a4' | 'halfLetter' | 'a5' | 'moleskine';
type PatternKey = 'dots' | 'lines' | 'grid' | 'isometric' | 'calligraphy' | 'music';
type HeaderPosition = 'bottom' | 'top';

interface Settings {
  name: string;
  cardId: string;
  logo: string | null;
  paperPreset: PaperKey;
  patternType: PatternKey;
  marginTopMm: number;
  marginBottomMm: number;
  marginSideMm: number;
  dotSpacingMm: number;
  dotSizeMm: number;
  dotColor: string;
  dotOpacity: number;
  showHeader: boolean;
  headerFontSize: number;
  headerPosition: HeaderPosition;
  showLogo: boolean;
  logoWidthMm: number;
  logoOffsetBottomMm: number;
  logoOpacity: number;
}

const PAPER_PRESETS: Record<PaperKey, { label: string; w: number; h: number }> = {
  letter: { label: 'Carta', w: 215.9, h: 279.4 },
  a4: { label: 'A4', w: 210, h: 297 },
  halfLetter: { label: 'Media carta', w: 139.7, h: 215.9 },
  a5: { label: 'A5', w: 148, h: 210 },
  moleskine: { label: 'Moleskine', w: 130, h: 210 },
};

const PATTERN_LABELS: Record<PatternKey, string> = {
  dots: 'Puntos',
  lines: 'Líneas',
  grid: 'Cuadrícula',
  isometric: 'Isométrico',
  calligraphy: 'Caligrafía',
  music: 'Pentagrama',
};

const DOT_COLOR_PRESETS = ['#9AA0A6', '#B0B0B0', '#4A4A4A', '#2E5AAC'];
const ACCENT = '#2f6fed';

const DEFAULT_SETTINGS: Settings = {
  name: 'Josue Manuel Cruz Boror',
  cardId: '1190-26-558',
  logo: null,
  paperPreset: 'letter',
  patternType: 'dots',
  marginTopMm: 15,
  marginBottomMm: 18,
  marginSideMm: 15,
  dotSpacingMm: 5,
  dotSizeMm: 0.35,
  dotColor: '#9AA0A6',
  dotOpacity: 0.65,
  showHeader: true,
  headerFontSize: 11,
  headerPosition: 'bottom',
  showLogo: true,
  logoWidthMm: 28,
  logoOffsetBottomMm: 10,
  logoOpacity: 1,
};

const SETTINGS_KEY = 'hoja-de-puntos-ajustes';
// Older versions of this app kept a whole multi-profile system (name/cardId/
// logo per saved profile); it turned out nobody needed more than one, and it
// ate a column of panel space for a switcher/add/delete UI nobody used. This
// reads whichever profile was active there once, on the way out, so an
// existing visitor's name/logo aren't reset to the defaults.
const LEGACY_PROFILES_KEY = 'hoja-de-puntos-perfiles';
const DEFAULT_LOGO = '/logo-mariano.webp';
const DEFAULT_LOGO_DIMS = { width: 678, height: 669 };

function loadSettings(): Settings {
  let merged: Partial<Settings> = {};
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) merged = JSON.parse(raw);
  } catch {
    /* ignore */
  }

  if (merged.name === undefined) {
    try {
      const raw = localStorage.getItem(LEGACY_PROFILES_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const active = parsed?.profiles?.find((p: any) => p.id === parsed.activeProfileId) ?? parsed?.profiles?.[0];
      if (active) {
        merged = { ...merged, name: active.name, cardId: active.cardId, logo: active.logo ?? null };
      }
    } catch {
      /* ignore */
    }
  }

  return { ...DEFAULT_SETTINGS, ...merged };
}

function hexToRgba(hex: string, alpha: number) {
  const h = (hex || '#9AA0A6').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Shared by the live sheet preview (tile = spacing in px, dotSizePx = grosor
// in px) and the small pattern-picker swatches (fixed representative tile/
// dot size, so the icons stay a consistent size regardless of the user's
// actual spacing/grosor sliders).
function patternBackground(pattern: PatternKey, dotColor: string, dotOpacity: number, tile: number, dotSizePx: number) {
  if (pattern === 'isometric') {
    const c = hexToRgba(dotColor, dotOpacity);
    return {
      backgroundImage: `linear-gradient(30deg, ${c} 1px, transparent 1px), linear-gradient(150deg, ${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`,
      backgroundSize: `${tile}px ${tile}px`,
    };
  }
  const fillColor = dotColor.replace('#', '%23');
  const r = dotSizePx / 2;
  const strokeW = Math.max(dotSizePx * 0.6, 0.6);
  let svg: string;
  if (pattern === 'lines') {
    svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'>` +
      `<line x1='0' y1='${tile}' x2='${tile}' y2='${tile}' stroke='${fillColor}' stroke-opacity='${dotOpacity}' stroke-width='${strokeW}'/></svg>`;
  } else if (pattern === 'grid') {
    svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'>` +
      `<line x1='0' y1='${tile}' x2='${tile}' y2='${tile}' stroke='${fillColor}' stroke-opacity='${dotOpacity}' stroke-width='${strokeW}'/>` +
      `<line x1='${tile}' y1='0' x2='${tile}' y2='${tile}' stroke='${fillColor}' stroke-opacity='${dotOpacity}' stroke-width='${strokeW}'/></svg>`;
  } else if (pattern === 'calligraphy') {
    const xY = tile * 0.55, baseY = tile * 0.92;
    svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'>` +
      `<line x1='0' y1='${xY}' x2='${tile}' y2='${xY}' stroke='${fillColor}' stroke-opacity='${dotOpacity * 0.55}' stroke-width='${strokeW * 0.6}'/>` +
      `<line x1='0' y1='${baseY}' x2='${tile}' y2='${baseY}' stroke='${fillColor}' stroke-opacity='${dotOpacity}' stroke-width='${strokeW}'/></svg>`;
  } else if (pattern === 'music') {
    const pad = tile * 0.08;
    const lineGapPx = Math.max(Math.min(tile * 0.13, tile / 6), 4);
    let lines = '';
    for (let i = 0; i < 5; i++) {
      const y = pad + i * lineGapPx;
      lines += `<line x1='0' y1='${y}' x2='${tile}' y2='${y}' stroke='${fillColor}' stroke-opacity='${dotOpacity}' stroke-width='${strokeW * 0.7}'/>`;
    }
    svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'>${lines}</svg>`;
  } else {
    svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'>` +
      `<circle cx='${tile / 2}' cy='${tile / 2}' r='${r}' fill='${fillColor}' fill-opacity='${dotOpacity}'/></svg>`;
  }
  return { backgroundImage: `url("data:image/svg+xml,${svg}")`, backgroundSize: `${tile}px ${tile}px` };
}

function clipLineToRect(
  x1: number, y1: number, x2: number, y2: number,
  xmin: number, ymin: number, xmax: number, ymax: number
): [number, number, number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy], q = [x1 - xmin, xmax - x1, y1 - ymin, ymax - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        else if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        else if (r < t1) t1 = r;
      }
    }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

function loadImageDataUrl(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (src.startsWith('data:')) { resolve(src); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = src;
  });
}

const MM_TO_PX = 96 / 25.4;

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: '#333', marginBottom: 10 };
const rowLabelStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#333', marginBottom: 10 };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 8px', borderRadius: 8, border: '1px solid #e2e4e9', marginTop: 3 };
const sectionHeaderStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: '#8a8f9c', textTransform: 'uppercase', letterSpacing: '0.6px', margin: '18px 0 10px' };

// ---- Minimal inline icon set (generic line-icon shapes, no external deps) ----
type IconProps = { size?: number; color?: string };
const IconIdentity = ({ size = 12, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
);
const IconType = ({ size = 12, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></svg>
);
const IconImage = ({ size = 12, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
);
const IconFile = ({ size = 12, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
);
const IconGrid = ({ size = 12, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>
);
const IconDownload = ({ size = 14, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
);
const IconChevronUp = ({ size = 9, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
);
const IconChevronDown = ({ size = 9, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
);
const IconArrowUp = ({ size = 14, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
);
const IconArrowDown = ({ size = 14, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>
);

function SectionHeader({ icon, right, children }: { icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ ...sectionHeaderStyle, justifyContent: right ? 'space-between' : 'flex-start' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{icon}{children}</span>
      {right}
    </div>
  );
}

function Stepper({ value, min, max, step, suffix, onChange }: { value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const stepBtnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 15, background: 'none', border: 'none', padding: 0, color: '#8a8f9c' };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'stretch', border: '1px solid #e2e4e9', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '4px 8px', fontSize: 12, color: '#333', minWidth: 30, textAlign: 'center', display: 'flex', alignItems: 'center' }}>{value}{suffix}</div>
      <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid #e2e4e9' }}>
        <button type="button" aria-label="Aumentar" onClick={() => onChange(clamp(value + step))} disabled={value >= max} style={{ ...stepBtnStyle, borderBottom: '1px solid #e2e4e9', cursor: value >= max ? 'default' : 'pointer', opacity: value >= max ? 0.35 : 1 }}>
          <IconChevronUp />
        </button>
        <button type="button" aria-label="Disminuir" onClick={() => onChange(clamp(value - step))} disabled={value <= min} style={{ ...stepBtnStyle, cursor: value <= min ? 'default' : 'pointer', opacity: value <= min ? 0.35 : 1 }}>
          <IconChevronDown />
        </button>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ position: 'relative', display: 'inline-block', width: 34, height: 20, flexShrink: 0, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: 'absolute', inset: 0, opacity: 0, margin: 0, cursor: 'pointer' }}
      />
      <span style={{ position: 'absolute', inset: 0, borderRadius: 999, background: checked ? ACCENT : '#d7d9de', transition: 'background 0.15s ease', pointerEvents: 'none' }} />
      <span style={{ position: 'absolute', top: 2, left: checked ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)', transition: 'left 0.15s ease', pointerEvents: 'none' }} />
    </label>
  );
}

export default function HojasDePuntos() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewOuterRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);

  useEffect(() => {
    setSettings(loadSettings());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  }, [ready, settings]);

  const set = <K extends keyof Settings>(key: K, val: Settings[K]) =>
    setSettings((s) => ({ ...s, [key]: val }));

  const setLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set('logo', reader.result as string);
    reader.readAsDataURL(file);
  };

  const preset = PAPER_PRESETS[settings.paperPreset] || PAPER_PRESETS.letter;
  const pageWidthPx = preset.w * MM_TO_PX;
  const pageHeightPx = preset.h * MM_TO_PX;

  // The sheet is laid out at its true physical size (pageWidthPx x
  // pageHeightPx), which overflows both narrow viewports (shows a cropped,
  // zoomed-in slice) and short ones (the header text/logo near the bottom
  // sit below the fold, needing a scroll to reach). previewOuter's CSS width
  // already resolves to min(100%, pageWidthPx) — its measured width is how
  // much horizontal room the flex layout actually gives us — combined with
  // the viewport height (minus the preview's own vertical margins), the
  // smaller of the two ratios is how much the whole sheet (pattern, corner
  // ticks, header text, logo — everything, since it's one transformed
  // element) needs to shrink to be fully visible with no scrolling.
  useEffect(() => {
    const el = previewOuterRef.current;
    if (!el) return;
    const PREVIEW_VERTICAL_MARGIN = 64; // matches the 32px top/bottom spacing around the sheet
    const recompute = () => {
      const w = el.clientWidth;
      const availH = window.innerHeight - PREVIEW_VERTICAL_MARGIN;
      if (w > 0) {
        setPreviewScale(Math.min(1, w / pageWidthPx, availH / pageHeightPx));
      }
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    window.addEventListener('resize', recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [pageWidthPx, pageHeightPx]);

  async function downloadPdf() {
    const { jsPDF } = await import('jspdf');
    const s = settings;
    const pw = preset.w, ph = preset.h;
    const doc = new jsPDF({ unit: 'mm', format: [pw, ph] });

    const drawPatternPage = () => {
      doc.setDrawColor(s.dotColor);
      doc.setFillColor(s.dotColor);
      const baseLW = Math.max(s.dotSizeMm * 0.6, 0.1);
      doc.setLineWidth(baseLW);
      const r = s.dotSizeMm / 2;
      const top = s.marginTopMm, bottom = ph - s.marginBottomMm, left = s.marginSideMm, right = pw - s.marginSideMm;

      if (s.patternType === 'lines' || s.patternType === 'grid') {
        for (let y = top; y <= bottom + 0.01; y += s.dotSpacingMm) doc.line(left, y, right, y);
        if (s.patternType === 'grid') for (let x = left; x <= right + 0.01; x += s.dotSpacingMm) doc.line(x, top, x, bottom);
      } else if (s.patternType === 'calligraphy') {
        for (let y = top; y <= bottom + 0.01; y += s.dotSpacingMm) {
          doc.setLineWidth(baseLW);
          doc.line(left, y, right, y);
          const xY = y - s.dotSpacingMm * 0.37;
          if (xY > top - 0.01) { doc.setLineWidth(baseLW * 0.6); doc.line(left, xY, right, xY); }
        }
      } else if (s.patternType === 'music') {
        const lineGap = Math.min(s.dotSpacingMm * 0.13, s.dotSpacingMm / 6, 3);
        for (let topY = top; topY <= bottom + 0.01; topY += s.dotSpacingMm) {
          for (let i = 0; i < 5; i++) {
            const y = topY + i * lineGap;
            if (y <= bottom + 0.01) doc.line(left, y, right, y);
          }
        }
      } else if (s.patternType === 'isometric') {
        for (let x = left; x <= right + 0.01; x += s.dotSpacingMm) doc.line(x, top, x, bottom);
        const h = bottom - top;
        const dx = h * Math.tan((30 * Math.PI) / 180);
        const kMin = -Math.ceil(dx / s.dotSpacingMm) - 1;
        const kMax = Math.ceil((right - left + dx) / s.dotSpacingMm) + 1;
        for (let k = kMin; k <= kMax; k++) {
          const x0 = left + k * s.dotSpacingMm;
          let seg = clipLineToRect(x0, top, x0 + dx, bottom, left, top, right, bottom);
          if (seg) doc.line(seg[0], seg[1], seg[2], seg[3]);
          seg = clipLineToRect(x0, top, x0 - dx, bottom, left, top, right, bottom);
          if (seg) doc.line(seg[0], seg[1], seg[2], seg[3]);
        }
      } else {
        for (let y = top; y <= bottom + 0.01; y += s.dotSpacingMm) {
          for (let x = left; x <= right + 0.01; x += s.dotSpacingMm) doc.circle(x, y, r, 'F');
        }
      }
    };
    drawPatternPage();

    const drawHeaderAndLogo = async () => {
      if (s.showHeader) {
        const headerY = s.headerPosition === 'top'
          ? Math.max(s.marginTopMm, 4) / 2
          : ph - Math.max(s.marginBottomMm, 4) / 2;
        doc.setTextColor('#9a9ea8');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(s.headerFontSize);
        doc.text(s.name || '', s.marginSideMm, headerY);
        const nameWidth = doc.getTextWidth(s.name || '');
        doc.setTextColor('#b7bac2');
        doc.setFontSize(s.headerFontSize * 0.85);
        doc.text(s.cardId || '', s.marginSideMm + nameWidth + 2, headerY);
      }
      if (s.showLogo) {
        try {
          const src = s.logo || DEFAULT_LOGO;
          const imgData = await loadImageDataUrl(src);
          const props = doc.getImageProperties(imgData);
          const w = s.logoWidthMm;
          const h = (props.height / props.width) * w;
          const x = (pw - w) / 2;
          const y = ph - s.logoOffsetBottomMm - h;
          doc.saveGraphicsState();
          doc.setGState(new (doc as any).GState({ opacity: s.logoOpacity }));
          doc.addImage(imgData, 'PNG', x, y, w, h);
          doc.restoreGraphicsState();
        } catch {
          /* logo failed to load; skip silently as in the original design */
        }
      }
    };
    await drawHeaderAndLogo();

    doc.save('hoja-de-puntos.pdf');
  }

  // ---- Live preview background pattern (matches print output in mm units) ----
  const { name, cardId, logo, paperPreset, marginTopMm, marginBottomMm, marginSideMm, dotSpacingMm: spacing, dotSizeMm: dotSize,
    dotColor, dotOpacity, showHeader, headerFontSize, headerPosition, showLogo, logoWidthMm,
    logoOffsetBottomMm, logoOpacity, patternType } = settings;

  const logoSrc = logo || DEFAULT_LOGO;
  const svgPxPerMm = 10;

  const { backgroundImage, backgroundSize } = patternBackground(patternType, dotColor, dotOpacity, spacing * svgPxPerMm, dotSize * svgPxPerMm);
  const backgroundPosition = `${marginSideMm}mm ${marginTopMm}mm`;

  const pageStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: pageWidthPx,
    height: pageHeightPx,
    transform: `scale(${previewScale})`,
    transformOrigin: 'top left',
    backgroundColor: '#ffffff',
    backgroundImage,
    backgroundSize,
    backgroundPosition,
    backgroundRepeat: 'repeat',
    WebkitPrintColorAdjust: 'exact',
    printColorAdjust: 'exact',
    colorAdjust: 'exact',
    boxSizing: 'border-box',
    borderRadius: 7,
    boxShadow: '0 2px 10px rgba(20, 20, 19, 0.12)',
  } as React.CSSProperties;

  const headerWrapStyle: React.CSSProperties = {
    display: showHeader ? 'flex' : 'none',
    alignItems: 'baseline',
    gap: 6,
    position: 'absolute',
    ...(headerPosition === 'top'
      ? { top: `${Math.max(marginTopMm, 4) / 2}mm` }
      : { bottom: `${Math.max(marginBottomMm, 4) / 2}mm` }),
    left: `${marginSideMm}mm`,
    fontFamily: '"Helvetica Neue", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  };
  const headerNameStyle: React.CSSProperties = { fontSize: `${headerFontSize}pt`, fontWeight: 500, color: '#9a9ea8', letterSpacing: '0.2px', whiteSpace: 'nowrap' };
  const headerIdStyle: React.CSSProperties = { fontSize: `${headerFontSize * 0.85}pt`, fontWeight: 400, color: '#b7bac2', letterSpacing: '0.6px', whiteSpace: 'nowrap' };

  const tickLen = 4;
  const tickColor = dotColor;
  const cornerDefs: Array<{ top?: number; bottom?: number; left?: number; right?: number }> = [
    { top: marginTopMm, left: marginSideMm },
    { top: marginTopMm, right: marginSideMm },
    { bottom: marginBottomMm, left: marginSideMm },
    { bottom: marginBottomMm, right: marginSideMm },
  ];
  const cornerTicks: React.CSSProperties[] = [];
  cornerDefs.forEach((c) => {
    const base: React.CSSProperties = { position: 'absolute' };
    if (c.top !== undefined) base.top = `${c.top}mm`;
    if (c.bottom !== undefined) base.bottom = `${c.bottom}mm`;
    if (c.left !== undefined) base.left = `${c.left}mm`;
    if (c.right !== undefined) base.right = `${c.right}mm`;
    cornerTicks.push({ ...base, width: `${tickLen}mm`, height: 1, background: tickColor, opacity: 0.4, transform: c.left !== undefined ? 'translateX(0)' : `translateX(-${tickLen}mm)` });
    cornerTicks.push({ ...base, width: 1, height: `${tickLen}mm`, background: tickColor, opacity: 0.4, transform: c.top !== undefined ? 'translateY(0)' : `translateY(-${tickLen}mm)` });
  });

  const logoStyle: React.CSSProperties = {
    display: showLogo ? 'block' : 'none',
    position: 'absolute',
    left: '50%',
    bottom: `${logoOffsetBottomMm}mm`,
    transform: 'translateX(-50%)',
    width: `${logoWidthMm}mm`,
    height: 'auto',
    opacity: logoOpacity,
    WebkitPrintColorAdjust: 'exact',
    printColorAdjust: 'exact',
  } as React.CSSProperties;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 24, padding: '32px 16px', flexWrap: 'wrap' }}>
        <div
          ref={previewOuterRef}
          style={{ width: `min(100%, ${pageWidthPx}px)` }}
        >
        <div
          style={{
            width: pageWidthPx * previewScale,
            height: pageHeightPx * previewScale,
            position: 'relative',
            overflow: 'hidden',
            margin: '0 auto',
          }}
        >
          <section className="page" style={pageStyle}>
            {cornerTicks.map((style, i) => <div key={i} style={style} />)}
            <div style={headerWrapStyle}>
              <span style={headerNameStyle}>{name}</span>
              <span style={headerIdStyle}>{cardId}</span>
            </div>
            {logoSrc && (
              <img
                src={logoSrc}
                alt="Logo"
                style={logoStyle}
                // Intrinsic dimensions pin the aspect ratio for the bundled default
                // logo (avoids layout shift); a custom uploaded logo already decodes
                // instantly from its in-memory data URL, so it's left unset there
                // rather than risk stretching it to the default's ratio.
                {...(logo ? {} : { width: DEFAULT_LOGO_DIMS.width, height: DEFAULT_LOGO_DIMS.height })}
                decoding="async"
                fetchPriority="high"
              />
            )}
          </section>
        </div>
        </div>

        <div
          className="settings-panel"
          style={{
            width: `min(100%, 580px)`,
            background: '#fff',
            borderRadius: 14,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.06)',
            position: 'sticky',
            top: 32,
            maxHeight: 'calc(100vh - 64px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, letterSpacing: '0.2px', color: '#1f2430', padding: '20px 20px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ACCENT, display: 'inline-block' }} />
            Ajustes
          </div>

          <div style={{ overflowY: 'auto', padding: '14px 20px 0', flex: '1 1 auto', minHeight: 0 }}>
          <div className="settings-grid">

            <div>
              <div style={{ ...sectionHeaderStyle, marginTop: 0 }}><IconIdentity color="#8a8f9c" />Identidad</div>

              {/* Logo avatar: click or drop to change, hover reveals the change affordance */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Cambiar logo"
                  aria-label="Cambiar logo"
                  className="logo-avatar"
                  style={{ position: 'relative', width: 52, height: 52, borderRadius: '50%', overflow: 'hidden', border: '1px solid #e2e4e9', padding: 0, cursor: 'pointer', background: '#f7f7f8', flexShrink: 0 }}
                >
                  <img src={logoSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4, boxSizing: 'border-box' }} />
                  <span className="logo-avatar-overlay" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(31,36,48,0.55)', opacity: 0 }}>
                    <IconImage size={16} color="#fff" />
                  </span>
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, color: '#8a8f9c' }}>Logo institucional</span>
                  <button type="button" onClick={() => set('logo', null)} style={{ fontSize: 11, color: '#b03535', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>Quitar logo</button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={setLogoFile} style={{ display: 'none' }} />
              </div>

              <label style={labelStyle}>Nombre
                <input type="text" value={name} onChange={(e) => set('name', e.target.value)} style={inputStyle} />
              </label>
              <label style={{ ...labelStyle, marginBottom: 4 }}>Carnet / código
                <input type="text" value={cardId} onChange={(e) => set('cardId', e.target.value)} style={inputStyle} />
              </label>

              <SectionHeader icon={<IconType color="#8a8f9c" />} right={<Toggle checked={showHeader} onChange={(v) => set('showHeader', v)} />}>Encabezado</SectionHeader>
              <div style={{ ...rowLabelStyle, marginBottom: 10 }}>Tamaño de letra
                <Stepper value={headerFontSize} min={8} max={16} step={0.5} suffix=" pt" onChange={(v) => set('headerFontSize', v)} />
              </div>
              <div style={{ ...rowLabelStyle, marginBottom: 10 }}>Posición
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    title="Abajo"
                    aria-label="Abajo"
                    onClick={() => set('headerPosition', 'bottom')}
                    style={{
                      width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, cursor: 'pointer',
                      border: headerPosition === 'bottom' ? `2px solid ${ACCENT}` : '1px solid #e2e4e9',
                      boxShadow: headerPosition === 'bottom' ? `0 0 0 3px ${ACCENT}22` : 'none',
                      background: '#fff', color: headerPosition === 'bottom' ? ACCENT : '#8a8f9c',
                    }}
                  >
                    <IconArrowDown />
                  </button>
                  <button
                    type="button"
                    title="Arriba"
                    aria-label="Arriba"
                    onClick={() => set('headerPosition', 'top')}
                    style={{
                      width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, cursor: 'pointer',
                      border: headerPosition === 'top' ? `2px solid ${ACCENT}` : '1px solid #e2e4e9',
                      boxShadow: headerPosition === 'top' ? `0 0 0 3px ${ACCENT}22` : 'none',
                      background: '#fff', color: headerPosition === 'top' ? ACCENT : '#8a8f9c',
                    }}
                  >
                    <IconArrowUp />
                  </button>
                </div>
              </div>

              <SectionHeader icon={<IconImage color="#8a8f9c" />} right={<Toggle checked={showLogo} onChange={(v) => set('showLogo', v)} />}>Posición del logo</SectionHeader>
              <div style={{ ...rowLabelStyle, marginBottom: 10 }}>Tamaño
                <Stepper value={logoWidthMm} min={10} max={60} step={1} suffix=" mm" onChange={(v) => set('logoWidthMm', v)} />
              </div>
              <div style={{ ...rowLabelStyle, marginBottom: 10 }}>Posición desde abajo
                <Stepper value={logoOffsetBottomMm} min={-20} max={60} step={1} suffix=" mm" onChange={(v) => set('logoOffsetBottomMm', v)} />
              </div>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Opacidad &mdash; {logoOpacity}
                <input type="range" min={0.1} max={1} step={0.05} value={logoOpacity} onChange={(e) => set('logoOpacity', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
            </div>

            <div>
              <div style={{ ...sectionHeaderStyle, marginTop: 0 }}><IconFile color="#8a8f9c" />Página &mdash; {preset.label}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                {(Object.entries(PAPER_PRESETS) as [PaperKey, typeof PAPER_PRESETS[PaperKey]][]).map(([key, p]) => {
                  const selected = key === paperPreset;
                  const h = 34, w = Math.round(h * (p.w / p.h));
                  return (
                    <button
                      key={key}
                      type="button"
                      title={p.label}
                      aria-label={p.label}
                      onClick={() => set('paperPreset', key)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                      <span style={{
                        display: 'block', width: w, height: h, background: '#fff', borderRadius: 3,
                        border: selected ? `2px solid ${ACCENT}` : '1px solid #d7d9de',
                        boxShadow: selected ? `0 0 0 3px ${ACCENT}22` : 'none',
                      }} />
                    </button>
                  );
                })}
              </div>

              <div style={sectionHeaderStyle}><IconGrid color="#8a8f9c" />Patrón &mdash; {PATTERN_LABELS[patternType]}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 16 }}>
                {(Object.keys(PATTERN_LABELS) as PatternKey[]).map((key) => {
                  const selected = key === patternType;
                  const swatch = patternBackground(key, dotColor, dotOpacity, 14, 3);
                  return (
                    <button
                      key={key}
                      type="button"
                      title={PATTERN_LABELS[key]}
                      aria-label={PATTERN_LABELS[key]}
                      onClick={() => set('patternType', key)}
                      style={{
                        width: '100%', aspectRatio: '1 / 1', borderRadius: 8,
                        border: selected ? `2px solid ${ACCENT}` : '1px solid #e2e4e9',
                        boxShadow: selected ? `0 0 0 3px ${ACCENT}22` : 'none',
                        background: `#fff ${swatch.backgroundImage}`,
                        backgroundSize: swatch.backgroundSize,
                        cursor: 'pointer', padding: 0,
                      }}
                    />
                  );
                })}
              </div>

              <label style={labelStyle}>Margen superior &mdash; {marginTopMm} mm
                <input type="range" min={8} max={30} step={1} value={marginTopMm} onChange={(e) => set('marginTopMm', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
              <label style={labelStyle}>Margen inferior &mdash; {marginBottomMm} mm
                <input type="range" min={8} max={30} step={1} value={marginBottomMm} onChange={(e) => set('marginBottomMm', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
              <label style={labelStyle}>Margen lateral &mdash; {marginSideMm} mm
                <input type="range" min={8} max={30} step={1} value={marginSideMm} onChange={(e) => set('marginSideMm', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
              <label style={labelStyle}>Espaciado &mdash; {spacing} mm
                <input type="range" min={3} max={14} step={0.5} value={spacing} onChange={(e) => set('dotSpacingMm', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
              <label style={labelStyle}>Grosor &mdash; {dotSize} mm
                <input type="range" min={0.15} max={0.8} step={0.05} value={dotSize} onChange={(e) => set('dotSizeMm', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>

              <label style={{ ...labelStyle, marginBottom: 6 }}>Color</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                {DOT_COLOR_PRESETS.map((c) => {
                  const selected = dotColor.toLowerCase() === c.toLowerCase();
                  return (
                    <button
                      key={c}
                      type="button"
                      title={c}
                      aria-label={c}
                      onClick={() => set('dotColor', c)}
                      style={{
                        width: 22, height: 22, borderRadius: '50%', background: c, padding: 0, cursor: 'pointer',
                        border: selected ? `2px solid ${ACCENT}` : '1px solid rgba(0,0,0,0.12)',
                        boxShadow: selected ? `0 0 0 2px #fff, 0 0 0 4px ${ACCENT}55` : 'none',
                      }}
                    />
                  );
                })}
                <label
                  title="Color personalizado"
                  style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.12)', cursor: 'pointer', position: 'relative', display: 'inline-block' }}
                >
                  <input
                    type="color"
                    value={dotColor}
                    onChange={(e) => set('dotColor', e.target.value)}
                    style={{ position: 'absolute', inset: -4, width: 'calc(100% + 8px)', height: 'calc(100% + 8px)', border: 'none', padding: 0, cursor: 'pointer' }}
                  />
                </label>
              </div>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Opacidad &mdash; {dotOpacity}
                <input type="range" min={0.1} max={1} step={0.05} value={dotOpacity} onChange={(e) => set('dotOpacity', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
            </div>

          </div>
          </div>

          <div style={{ padding: '12px 20px 20px', borderTop: '1px solid #eee' }}>
            <button
              onClick={downloadPdf}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 12px', border: 'none', borderRadius: 10, background: '#1f2430', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.2px' }}
            >
              <IconDownload color="#fff" />
              Descargar PDF
            </button>
            <div style={{ fontSize: 11, color: '#9a9ea8', marginTop: 6, lineHeight: 1.4 }}>
              PDF vectorial — máxima nitidez al imprimir. Tus ajustes se guardan automáticamente en este navegador.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
