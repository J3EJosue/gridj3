import { useEffect, useMemo, useRef, useState } from 'react';
// jsPDF (and its transitive html2canvas/dompurify deps) is ~400KB and is only
// ever needed once the user clicks "Descargar PDF" — loading it eagerly would
// bloat the initial bundle everyone pays for, so it's dynamically imported
// inside downloadPdf() instead, putting it in its own on-demand chunk.

type PaperKey = 'letter' | 'a4' | 'halfLetter' | 'a5' | 'moleskine';
type PatternKey = 'dots' | 'lines' | 'grid' | 'isometric' | 'calligraphy' | 'music';

interface Profile {
  id: string;
  name: string;
  cardId: string;
  logo: string | null;
}

interface Settings {
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
  headerOffsetTopMm: number;
  showLogo: boolean;
  logoWidthMm: number;
  logoOffsetBottomMm: number;
  logoOpacity: number;
  pageCount: number;
}

const PAPER_PRESETS: Record<PaperKey, { label: string; w: number; h: number }> = {
  letter: { label: 'Carta', w: 215.9, h: 279.4 },
  a4: { label: 'A4', w: 210, h: 297 },
  halfLetter: { label: 'Media carta', w: 139.7, h: 215.9 },
  a5: { label: 'A5', w: 148, h: 210 },
  moleskine: { label: 'Moleskine', w: 130, h: 210 },
};

const DEFAULT_SETTINGS: Settings = {
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
  headerOffsetTopMm: 0,
  showLogo: true,
  logoWidthMm: 28,
  logoOffsetBottomMm: 10,
  logoOpacity: 1,
  pageCount: 1,
};

const DEFAULT_PROFILES: Profile[] = [
  { id: 'p-default', name: 'Josue Manuel Cruz Boror', cardId: '1190-26-558', logo: null },
];

const SETTINGS_KEY = 'hoja-de-puntos-ajustes';
const PROFILES_KEY = 'hoja-de-puntos-perfiles';
const DEFAULT_LOGO = '/logo-mariano.webp';
const DEFAULT_LOGO_DIMS = { width: 678, height: 669 };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadProfiles(): { profiles: Profile[]; activeProfileId: string } {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.profiles) && parsed.profiles.length) return parsed;
  } catch {
    /* ignore */
  }
  return { profiles: DEFAULT_PROFILES, activeProfileId: 'p-default' };
}

function hexToRgba(hex: string, alpha: number) {
  const h = (hex || '#9AA0A6').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
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
const selectStyle: React.CSSProperties = { fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid #e2e4e9' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '5px 7px', borderRadius: 6, border: '1px solid #e2e4e9', marginTop: 3 };
const sectionHeaderStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#8a8f9c', textTransform: 'uppercase', letterSpacing: '0.6px', margin: '16px 0 8px' };

export default function HojasDePuntos() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [profiles, setProfiles] = useState<Profile[]>(DEFAULT_PROFILES);
  const [activeProfileId, setActiveProfileIdState] = useState('p-default');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewOuterRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);

  useEffect(() => {
    setSettings(loadSettings());
    const p = loadProfiles();
    setProfiles(p.profiles);
    setActiveProfileIdState(p.activeProfileId);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  }, [ready, settings]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(PROFILES_KEY, JSON.stringify({ profiles, activeProfileId })); } catch { /* ignore */ }
  }, [ready, profiles, activeProfileId]);

  const set = <K extends keyof Settings>(key: K, val: Settings[K]) =>
    setSettings((s) => ({ ...s, [key]: val }));

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) || profiles[0],
    [profiles, activeProfileId]
  );

  const updateActiveProfile = (field: keyof Profile, value: string | null) =>
    setProfiles((ps) => ps.map((p) => (p.id === activeProfileId ? { ...p, [field]: value } : p)));

  const setProfileLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateActiveProfile('logo', reader.result as string);
    reader.readAsDataURL(file);
  };

  const addProfile = () => {
    const id = 'p-' + Date.now();
    setProfiles((ps) => [...ps, { id, name: 'Nuevo perfil', cardId: '', logo: null }]);
    setActiveProfileIdState(id);
  };

  const deleteProfile = () => {
    if (profiles.length <= 1) return;
    const remaining = profiles.filter((p) => p.id !== activeProfileId);
    setProfiles(remaining);
    setActiveProfileIdState(remaining[0].id);
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
    const profile = activeProfile;

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
        const bottomY = ph - Math.max(s.marginBottomMm + s.headerOffsetTopMm, 4) / 2;
        doc.setTextColor('#9a9ea8');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(s.headerFontSize);
        doc.text(profile.name || '', s.marginSideMm, bottomY);
        const nameWidth = doc.getTextWidth(profile.name || '');
        doc.setTextColor('#b7bac2');
        doc.setFontSize(s.headerFontSize * 0.85);
        doc.text(profile.cardId || '', s.marginSideMm + nameWidth + 2, bottomY);
      }
      if (s.showLogo) {
        try {
          const src = profile.logo || DEFAULT_LOGO;
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

    const count = Math.max(s.pageCount || 1, 1);
    for (let i = 1; i < count; i++) {
      doc.addPage([pw, ph]);
      drawPatternPage();
      await drawHeaderAndLogo();
    }

    doc.save('hoja-de-puntos.pdf');
  }

  // ---- Live preview background pattern (matches print output in mm units) ----
  const { paperPreset, marginTopMm, marginBottomMm, marginSideMm, dotSpacingMm: spacing, dotSizeMm: dotSize,
    dotColor, dotOpacity, showHeader, headerFontSize, headerOffsetTopMm, showLogo, logoWidthMm,
    logoOffsetBottomMm, logoOpacity, patternType, pageCount } = settings;

  const logoSrc = activeProfile?.logo || DEFAULT_LOGO;

  const svgPxPerMm = 10;
  const tile = spacing * svgPxPerMm;
  const r = (dotSize / 2) * svgPxPerMm;
  const strokeW = Math.max(dotSize * svgPxPerMm * 0.6, 0.6);
  const fillColor = dotColor.replace('#', '%23');

  let backgroundImage: string, backgroundSize: string, backgroundPosition: string;
  if (patternType === 'isometric') {
    const c = hexToRgba(dotColor, dotOpacity);
    backgroundImage = `linear-gradient(30deg, ${c} 1px, transparent 1px), linear-gradient(150deg, ${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`;
    backgroundSize = `${spacing}mm ${spacing}mm`;
    backgroundPosition = `${marginSideMm}mm ${marginTopMm}mm`;
  } else {
    let svg: string;
    if (patternType === 'lines') {
      svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'>` +
        `<line x1='0' y1='${tile}' x2='${tile}' y2='${tile}' stroke='${fillColor}' stroke-opacity='${dotOpacity}' stroke-width='${strokeW}'/></svg>`;
    } else if (patternType === 'grid') {
      svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'>` +
        `<line x1='0' y1='${tile}' x2='${tile}' y2='${tile}' stroke='${fillColor}' stroke-opacity='${dotOpacity}' stroke-width='${strokeW}'/>` +
        `<line x1='${tile}' y1='0' x2='${tile}' y2='${tile}' stroke='${fillColor}' stroke-opacity='${dotOpacity}' stroke-width='${strokeW}'/></svg>`;
    } else if (patternType === 'calligraphy') {
      const xY = tile * 0.55, baseY = tile * 0.92;
      svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'>` +
        `<line x1='0' y1='${xY}' x2='${tile}' y2='${xY}' stroke='${fillColor}' stroke-opacity='${dotOpacity * 0.55}' stroke-width='${strokeW * 0.6}'/>` +
        `<line x1='0' y1='${baseY}' x2='${tile}' y2='${baseY}' stroke='${fillColor}' stroke-opacity='${dotOpacity}' stroke-width='${strokeW}'/></svg>`;
    } else if (patternType === 'music') {
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
    backgroundImage = `url("data:image/svg+xml,${svg}")`;
    backgroundSize = `${spacing}mm ${spacing}mm`;
    backgroundPosition = `${marginSideMm}mm ${marginTopMm}mm`;
  }

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
    bottom: `${Math.max(marginBottomMm + headerOffsetTopMm, 4) / 2}mm`,
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
              <span style={headerNameStyle}>{activeProfile?.name}</span>
              <span style={headerIdStyle}>{activeProfile?.cardId}</span>
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
                {...(activeProfile?.logo ? {} : { width: DEFAULT_LOGO_DIMS.width, height: DEFAULT_LOGO_DIMS.height })}
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
            borderRadius: 10,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.06)',
            position: 'sticky',
            top: 32,
            maxHeight: 'calc(100vh - 64px)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.3px', color: '#1f2430', padding: '20px 20px 0' }}>Ajustes</div>

          <div style={{ overflowY: 'auto', padding: '14px 20px 0', flex: '1 1 auto', minHeight: 0 }}>
          <div className="settings-grid">

            <div>
              <div style={{ ...sectionHeaderStyle, marginTop: 0 }}>Perfil</div>
              <label style={rowLabelStyle}>Perfil
                <select value={activeProfileId} onChange={(e) => setActiveProfileIdState(e.target.value)} style={{ ...selectStyle, maxWidth: 150 }}>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label style={labelStyle}>Nombre
                <input type="text" value={activeProfile?.name ?? ''} onChange={(e) => updateActiveProfile('name', e.target.value)} style={inputStyle} />
              </label>
              <label style={labelStyle}>Carnet / código
                <input type="text" value={activeProfile?.cardId ?? ''} onChange={(e) => updateActiveProfile('cardId', e.target.value)} style={inputStyle} />
              </label>
              <label style={{ display: 'block', fontSize: 12, color: '#333', marginBottom: 8 }}>Logo
                <input ref={fileInputRef} type="file" accept="image/*" onChange={setProfileLogo} style={{ display: 'block', width: '100%', fontSize: 11, marginTop: 3 }} />
              </label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button onClick={() => updateActiveProfile('logo', null)} style={{ flex: 1, padding: '6px 8px', border: '1px solid #e2e4e9', borderRadius: 6, background: '#fff', color: '#555', fontSize: 11, cursor: 'pointer' }}>Quitar logo</button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button onClick={addProfile} style={{ flex: 1, padding: '6px 8px', border: '1px solid #e2e4e9', borderRadius: 6, background: '#fff', color: '#333', fontSize: 11, cursor: 'pointer' }}>+ Nuevo</button>
                <button onClick={deleteProfile} style={{ flex: 1, padding: '6px 8px', border: '1px solid #e2e4e9', borderRadius: 6, background: '#fff', color: '#b03535', fontSize: 11, cursor: 'pointer' }}>Eliminar</button>
              </div>

              <div style={sectionHeaderStyle}>Encabezado</div>
              <label style={rowLabelStyle}>Mostrar
                <input type="checkbox" checked={showHeader} onChange={(e) => set('showHeader', e.target.checked)} />
              </label>
              <label style={labelStyle}>Tamaño de letra &mdash; {headerFontSize} pt
                <input type="range" min={8} max={16} step={0.5} value={headerFontSize} onChange={(e) => set('headerFontSize', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
              <label style={labelStyle}>Posición vertical &mdash; {headerOffsetTopMm} mm
                <input type="range" min={-10} max={20} step={1} value={headerOffsetTopMm} onChange={(e) => set('headerOffsetTopMm', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>

              <div style={sectionHeaderStyle}>Logo</div>
              <label style={rowLabelStyle}>Mostrar
                <input type="checkbox" checked={showLogo} onChange={(e) => set('showLogo', e.target.checked)} />
              </label>
              <label style={labelStyle}>Tamaño &mdash; {logoWidthMm} mm
                <input type="range" min={10} max={60} step={1} value={logoWidthMm} onChange={(e) => set('logoWidthMm', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
              <label style={labelStyle}>Posición desde abajo &mdash; {logoOffsetBottomMm} mm
                <input type="range" min={-20} max={60} step={1} value={logoOffsetBottomMm} onChange={(e) => set('logoOffsetBottomMm', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Opacidad &mdash; {logoOpacity}
                <input type="range" min={0.1} max={1} step={0.05} value={logoOpacity} onChange={(e) => set('logoOpacity', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
            </div>

            <div>
              <div style={{ ...sectionHeaderStyle, marginTop: 0 }}>Página</div>
              <label style={rowLabelStyle}>Tamaño
                <select value={paperPreset} onChange={(e) => set('paperPreset', e.target.value as PaperKey)} style={selectStyle}>
                  <option value="letter">Carta</option>
                  <option value="a4">A4</option>
                  <option value="halfLetter">Media carta</option>
                  <option value="a5">A5</option>
                  <option value="moleskine">Moleskine</option>
                </select>
              </label>
              <label style={rowLabelStyle}>Patrón
                <select value={patternType} onChange={(e) => set('patternType', e.target.value as PatternKey)} style={selectStyle}>
                  <option value="dots">Puntos</option>
                  <option value="lines">Líneas</option>
                  <option value="grid">Cuadrícula</option>
                  <option value="isometric">Isométrico</option>
                  <option value="calligraphy">Caligrafía</option>
                  <option value="music">Pentagrama</option>
                </select>
              </label>
              <label style={labelStyle}>Margen superior &mdash; {marginTopMm} mm
                <input type="range" min={8} max={30} step={1} value={marginTopMm} onChange={(e) => set('marginTopMm', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
              <label style={labelStyle}>Margen inferior &mdash; {marginBottomMm} mm
                <input type="range" min={8} max={30} step={1} value={marginBottomMm} onChange={(e) => set('marginBottomMm', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
              <label style={labelStyle}>Margen lateral &mdash; {marginSideMm} mm
                <input type="range" min={8} max={30} step={1} value={marginSideMm} onChange={(e) => set('marginSideMm', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>

              <div style={sectionHeaderStyle}>Patrón</div>
              <label style={labelStyle}>Espaciado &mdash; {spacing} mm
                <input type="range" min={3} max={14} step={0.5} value={spacing} onChange={(e) => set('dotSpacingMm', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
              <label style={labelStyle}>Grosor &mdash; {dotSize} mm
                <input type="range" min={0.15} max={0.8} step={0.05} value={dotSize} onChange={(e) => set('dotSizeMm', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>
              <label style={rowLabelStyle}>Color
                <input type="color" value={dotColor} onChange={(e) => set('dotColor', e.target.value)} style={{ width: 36, height: 24, border: 'none', padding: 0, background: 'none' }} />
              </label>
              <label style={labelStyle}>Opacidad &mdash; {dotOpacity}
                <input type="range" min={0.1} max={1} step={0.05} value={dotOpacity} onChange={(e) => set('dotOpacity', parseFloat(e.target.value))} style={{ width: '100%' }} />
              </label>

              <div style={sectionHeaderStyle}>Exportar</div>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Número de hojas &mdash; {pageCount}
                <input type="range" min={1} max={20} step={1} value={pageCount} onChange={(e) => set('pageCount', parseInt(e.target.value, 10))} style={{ width: '100%' }} />
              </label>
            </div>

          </div>
          </div>

          <div style={{ padding: '12px 20px 20px', borderTop: '1px solid #eee' }}>
            <button onClick={downloadPdf} style={{ width: '100%', padding: '10px 12px', border: 'none', borderRadius: 8, background: '#1f2430', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.2px' }}>Descargar PDF</button>
            <div style={{ fontSize: 11, color: '#9a9ea8', marginTop: 6, lineHeight: 1.4 }}>
              PDF vectorial de {pageCount} hoja(s) — máxima nitidez al imprimir. Tus ajustes y perfiles se guardan automáticamente en este navegador.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
