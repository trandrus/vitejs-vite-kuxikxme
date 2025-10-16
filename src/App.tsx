import React, { useEffect, useMemo, useState } from 'react';
import { supabase, DEFAULT_USER_ID } from './supabaseClient';

// === Wellness System – Calculator + USDA Search + Food Log (CSV + optional .xlsx) =========
// Self-contained. Neutral top stat row; metrics badges tint green when OK, and rose when not OK.

// ===================== Shared helpers =====================
function round(x: any, d = 0) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  const p = 10 ** d;
  return Math.round((n + Number.EPSILON) * p) / p;
}
function safeNum(x: any, fallback = 0) {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function formatFactor(value: number, isEF = false): string {
  if (!Number.isFinite(value)) return '∞';
  // FF/PF/WF -> whole numbers; EF -> one decimal
  return isEF ? round(value, 1).toFixed(1) : Math.round(value).toString();
}
function tidyText(input: any): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const ACRONYMS = new Set(['USDA', 'FNDDS', 'SR', 'ID', 'mg', 'g', 'kcal']);
  const SMALL = new Set([
    'and',
    'or',
    'the',
    'of',
    'in',
    'with',
    'a',
    'an',
    'to',
    'for',
    'on',
    'at',
    'by',
    'from',
  ]);
  const tokens = raw
    .toLowerCase()
    .split(/(\s+|[-–—:/,&()])/g)
    .map((t, i) => {
      if (/^\s+$/.test(t) || /[-–—:/,&()]/.test(t)) return t;
      const upper = t.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      if (SMALL.has(t) && i !== 0) return t;
      return t.charAt(0).toUpperCase() + t.slice(1);
    });
  return tokens.join('').replace(/\s+/g, ' ').trim();
}

// ===================== TWS factor helpers =====================
function ff(cal: number, fiberG: number) {
  return fiberG > 0 ? cal / fiberG : Infinity;
}
function pf(cal: number, proteinG: number) {
  return proteinG > 0 ? cal / proteinG : Infinity;
}
function wf(vff: number, vpf: number) {
  return Number.isFinite(vff) && Number.isFinite(vpf) ? vff + vpf : Infinity;
}
function ef(cal: number, massG: number) {
  return massG > 0 ? cal / massG : Infinity;
}

// ===================== USDA parsing helpers =====================
const NUTR = {
  energyKcal: 1008,
  protein: 1003,
  fat: 1004,
  carbs: 1005,
} as const;
const MICROS = [
  {
    key: 'fiber',
    label: 'Fiber',
    unit: 'g',
    names: ['fiber', 'dietary fiber', 'total dietary fiber'],
  },
  {
    key: 'sugar',
    label: 'Sugar',
    unit: 'g',
    names: ['sugars', 'sugars, total', 'sugar'],
  },
  {
    key: 'satfat',
    label: 'Sat Fat',
    unit: 'g',
    names: [
      'saturated fat',
      'fatty acids, total saturated',
      'saturatedfat',
      'saturatedFat',
    ],
  },
  { key: 'sodium', label: 'Sodium', unit: 'mg', names: ['sodium'] },
  {
    key: 'cholesterol',
    label: 'Cholesterol',
    unit: 'mg',
    names: ['cholesterol'],
  },
] as const;
function labelPick(obj: any, key: string): number {
  const x = obj?.[key];
  if (!x) return 0;
  if (typeof x === 'number') return x;
  if (typeof x?.value === 'number') return x.value;
  return 0;
}
function parseNutrients(food: any = {}, basisGrams = 100) {
  const list: any[] = Array.isArray(food?.foodNutrients)
    ? food.foodNutrients
    : [];
  const byId = (id: number) => {
    const n =
      list.find((x: any) => x?.nutrientId === id) ||
      list.find(
        (x: any) =>
          x?.nutrient &&
          (x.nutrient.id === id || x.nutrient.number === String(id))
      );
    return safeNum(n && (n.amount ?? n.value));
  };
  const byNames = (names: readonly string[]) => {
    const lower = names.map((s) => s.toLowerCase());
    const hit = list.find((x: any) =>
      lower.some((cand) =>
        (x?.nutrientName || x?.nutrient?.name || '')
          .toLowerCase()
          .includes(cand)
      )
    );
    return safeNum(hit && (hit.amount ?? hit.value));
  };
  let energy = byId(NUTR.energyKcal);
  let protein = byId(NUTR.protein);
  let fat = byId(NUTR.fat);
  let carbs = byId(NUTR.carbs);
  const label = food?.labelNutrients || {};
  if (!energy) energy = labelPick(label, 'calories');
  if (!protein) protein = labelPick(label, 'protein');
  if (!fat) fat = labelPick(label, 'fat');
  if (!carbs)
    carbs =
      labelPick(label, 'carbohydrates') || labelPick(label, 'carbohydrate');
  const microsRaw: Record<string, number> = {};
  for (const m of MICROS) microsRaw[m.key] = byNames(m.names);
  microsRaw.fiber ||= labelPick(label, 'fiber');
  microsRaw.sugar ||= labelPick(label, 'sugars');
  microsRaw.satfat ||= labelPick(label, 'saturatedFat');
  microsRaw.sodium ||= labelPick(label, 'sodium');
  microsRaw.cholesterol ||= labelPick(label, 'cholesterol');

  const scale = safeNum(basisGrams) / 100;
  const micros: Record<string, number> = {};
  for (const m of MICROS) micros[m.key] = safeNum(microsRaw[m.key]) * scale;
  return {
    energy: safeNum(energy) * scale,
    protein: safeNum(protein) * scale,
    fat: safeNum(fat) * scale,
    carbs: safeNum(carbs) * scale,
    micros,
  } as const;
}
function safeParse(food: any, basisGrams = 100) {
  try {
    const n = parseNutrients(food, basisGrams);
    if (!n || typeof n.energy !== 'number') throw new Error('bad n');
    return n;
  } catch {
    return {
      energy: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      micros: {} as Record<string, number>,
    };
  }
}

// ===================== Types & base helpers =====================
type Sex = 'male' | 'female';
type Units = 'us' | 'metric';
type Goal = 'maintain' | 'cut10' | 'cut20' | 'gain10' | 'gain20';
type LogItem = {
  id: string;
  name: string;
  brand?: string;
  serving: number; // grams
  energy: number;
  protein: number;
  fat: number;
  carbs: number;
  micros: Record<string, number>;
  _basePerG: {
    energy: number;
    protein: number;
    fat: number;
    carbs: number;
    micros: Record<string, number>;
  };
  fdcId?: number;
  customFoodId?: string;
  _originalFood?: any;
};
function ensureBasePerG(item: any): LogItem {
  const serving = Math.max(1, safeNum(item?.serving, 100));
  const microsSrc: Record<string, number> =
    item?.micros && typeof item.micros === 'object' ? item.micros : {};
  const basePerG =
    item?._basePerG &&
    typeof item._basePerG === 'object' &&
    Number.isFinite(item._basePerG.energy)
      ? item._basePerG
      : {
          energy: safeNum(item?.energy) / serving,
          protein: safeNum(item?.protein) / serving,
          fat: safeNum(item?.fat) / serving,
          carbs: safeNum(item?.carbs) / serving,
          micros: Object.fromEntries(
            Object.entries(microsSrc).map(([k, v]) => [k, safeNum(v) / serving])
          ) as Record<string, number>,
        };
  return {
    id: String(item?.id ?? `${Math.random()}-${Date.now()}`),
    name: String(item?.name ?? 'Food'),
    brand: item?.brand ?? undefined,
    serving: Math.max(0, safeNum(item?.serving, 100)),
    energy: safeNum(item?.energy, 0),
    protein: safeNum(item?.protein, 0),
    fat: safeNum(item?.fat, 0),
    carbs: safeNum(item?.carbs, 0),
    micros: microsSrc,
    _basePerG: basePerG,
    fdcId: item?.fdcId,
    customFoodId: item?.customFoodId,
    _originalFood: item?._originalFood,
  };
}

// ===================== Small UI bits =====================
function Stat({
  label,
  value,
  containerClass = '',
  tooltip,
  valueColor,
  secondaryLine,
}: {
  label: string;
  value: string;
  containerClass?: string;
  tooltip?: string;
  valueColor?: string;
  secondaryLine?: React.ReactNode;
}) {
  return (
    <div className={'rounded-xl border p-3 bg-white ' + containerClass}>
      <div className="text-[9px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`text-base font-semibold ${valueColor || ''}`}>
        {value}
      </div>
      {tooltip ? (
        <div className="mt-0.5 text-[10px] text-slate-500">{tooltip}</div>
      ) : null}
      {secondaryLine}
    </div>
  );
}

function BadgeHalo({
  label,
  value,
  threshold,
  compact = false,
}: {
  label: string;
  value: number;
  threshold: number;
  compact?: boolean;
}) {
  const ok = value < threshold;
  const text = formatFactor(value, label === 'EF' || label.includes('Energy'));
  const ring = ok
    ? 'ring-emerald-200 border-emerald-300 bg-emerald-100'
    : 'ring-rose-200 border-rose-300 bg-rose-100';
  return (
    <div
      className={
        'rounded-xl border ' +
        (compact ? 'p-1.5' : 'p-2') +
        ' text-center ring-2 ' +
        ring
      }
    >
      <div className="text-[10px] font-semibold">{label}</div>
      <div className="text-sm font-medium">{text}</div>
    </div>
  );
}

// ===================== Food card =====================
function FoodCard({
  item,
  setLog,
  setFavorites,
  favoriteFdcIds,
  setFavoriteFdcIds,
  favoriteCustomFoodIds,
  setFavoriteCustomFoodIds,
  setFavoriteFoodCache,
}: {
  item: LogItem;
  setLog: React.Dispatch<React.SetStateAction<LogItem[]>>;
  setFavorites: React.Dispatch<React.SetStateAction<Set<string>>>;
  favoriteFdcIds: Set<number>;
  setFavoriteFdcIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  favoriteCustomFoodIds: Set<string>;
  setFavoriteCustomFoodIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setFavoriteFoodCache: React.Dispatch<React.SetStateAction<Map<number, any>>>;
}) {
  const kc =
    safeNum(item.protein) * 4 + safeNum(item.fat) * 9 + safeNum(item.carbs) * 4;
  const fiber = safeNum(item.micros?.fiber);
  const VFF = ff(kc, fiber),
    VPF = pf(kc, safeNum(item.protein)),
    VWF = wf(VFF, VPF),
    VEF = ef(kc, safeNum(item.serving));
  const ok = VWF < 80;

  const NEUTRAL = 'bg-white border-slate-200'; // first row background stay neutral

  // Local edit buffer so typing isn't overridden by coercion to 0
  const [amt, setAmt] = React.useState<string>(
    String(Math.max(0, item.serving))
  );
  const [amtError, setAmtError] = React.useState<string>('');
  React.useEffect(() => {
    setAmt(String(Math.max(0, safeNum(item.serving))));
  }, [item.serving]);

  const amtId = `amt-${item.id}`;

  // Focus amount when clicking the title
  const amtInputRef = React.useRef<HTMLInputElement | null>(null);
  const focusAmt = () => {
    const el = amtInputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  };

  const SELECTED_MICROS: Array<{ key: string; label: string; unit?: string }> =
    [
      { key: 'sugar', label: 'Sugar', unit: 'g' },
      { key: 'satfat', label: 'Sat Fat', unit: 'g' },
      { key: 'sodium', label: 'Sodium', unit: 'mg' },
      { key: 'cholesterol', label: 'Cholesterol', unit: 'mg' },
    ];

  const handleAmountChange = (gramsRaw: number) => {
    const grams = Math.max(0, Number.isFinite(gramsRaw) ? gramsRaw : 0);
    const serving = Math.max(safeNum(item.serving, 0), 1);
    const fallbackBase = {
      energy: safeNum(item.energy) / serving,
      protein: safeNum(item.protein) / serving,
      fat: safeNum(item.fat) / serving,
      carbs: safeNum(item.carbs) / serving,
      micros: Object.fromEntries(
        Object.entries(item.micros || {}).map(([k, v]) => [
          k,
          safeNum(v) / serving,
        ])
      ) as Record<string, number>,
    };
    const b = item._basePerG || fallbackBase;
    setLog((prev) =>
      prev.map((i) => {
        if (i.id !== item.id) return i;
        const g = Math.max(0, grams);
        return {
          ...ensureBasePerG(i),
          serving: g,
          energy: b.energy * g,
          protein: b.protein * g,
          fat: b.fat * g,
          carbs: b.carbs * g,
          micros: Object.fromEntries(
            Object.entries(b.micros || {}).map(([k, v]) => [
              k,
              (v as number) * g,
            ])
          ) as Record<string, number>,
        };
      })
    );
  };

  const commitAmount = () => {
    const raw = (amt ?? '').trim();
    const num = raw === '' ? 0 : Number(raw);
    const grams = Number.isFinite(num) ? Math.max(0, num) : 0;

    if (grams <= 0) {
      setAmtError('Amount must be greater than 0');
    } else if (grams > 10000) {
      setAmtError('Amount must be 10000g or less');
    } else {
      setAmtError('');
    }

    handleAmountChange(grams);
    setAmt(String(Math.max(0, Math.round(grams))));
  };

  return (
    <div
      id={`food-card-${item.id}`}
      className="rounded-2xl border p-3 bg-white"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={focusAmt}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            focusAmt();
          }
        }}
        className="mb-1 text-sm font-medium capitalize leading-snug break-words cursor-pointer"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {tidyText(item.name)}
      </div>
      <div className="mb-2 truncate text-xs text-slate-500 capitalize">
        {tidyText(item.brand || '')}
      </div>

      <div className="grid grid-cols-5 gap-2 text-[11px]">
        <div className={'rounded-xl border p-3 col-span-2 ' + NEUTRAL}>
          <label
            htmlFor={amtId}
            className="mb-1 block text-[9px] uppercase tracking-wide text-slate-500 cursor-pointer"
          >
            Amount
          </label>
          <input
            ref={amtInputRef}
            id={amtId}
            type="number"
            min={0}
            step={1}
            value={amt}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && Number(amt) <= 0) e.preventDefault();
              if (e.key === 'Enter') {
                e.preventDefault();
                commitAmount();
              }
            }}
            onChange={(e) => {
              const v = (e.target as HTMLInputElement).value;
              if (/^[0-9]*([.][0-9]*)?$/.test(v)) {
                setAmt(v);
                if (amtError) setAmtError('');
              }
            }}
            onBlur={commitAmount}
            className={`w-full rounded-lg border ${
              amtError ? 'border-rose-500' : 'border-slate-500'
            } px-2 py-1 text-left text-base font-semibold bg-white/70 focus:border-slate-500 focus:ring-0 outline-none cursor-text`}
          />
          {amtError ? (
            <div className="mt-1 text-[9px] text-left text-rose-600">
              {amtError}
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-left text-slate-500">(g)</div>
          )}
        </div>

        <Stat
          label="Calories"
          value={`${round(kc, 0)}`}
          containerClass={NEUTRAL}
          tooltip="(kcal)"
        />
        <Stat
          label="Fiber"
          value={`${round(fiber, 1)}`}
          containerClass={NEUTRAL}
          tooltip="(g)"
        />
        <Stat
          label="Protein"
          value={`${round(item.protein, 1)}`}
          containerClass={NEUTRAL}
          tooltip="(g)"
        />
      </div>

      <div
        className={
          'mt-2 grid grid-cols-4 gap-2 text-[11px] rounded-xl p-2 ' +
          (ok ? 'bg-emerald-100' : 'bg-rose-100')
        }
      >
        <BadgeHalo label="FF" value={VFF} threshold={50} compact />
        <BadgeHalo label="PF" value={VPF} threshold={30} compact />
        <BadgeHalo label="WF" value={VWF} threshold={80} compact />
        <BadgeHalo label="EF" value={VEF} threshold={1} compact />
      </div>

      <div className="mt-2 flex items-center gap-2">
        {(() => {
          const fdcId = item.fdcId || null;
          const customFoodId = item.customFoodId || null;
          const isFavorite = fdcId
            ? favoriteFdcIds.has(fdcId)
            : customFoodId
            ? favoriteCustomFoodIds.has(customFoodId)
            : false;

          return (
            <button
              onClick={async () => {
                const normalizedName = item.name.toLowerCase().trim();
                try {
                  if (isFavorite) {
                    if (fdcId) {
                      await supabase
                        .from('favorites')
                        .delete()
                        .eq('user_id', DEFAULT_USER_ID)
                        .eq('fdc_id', fdcId);
                      setFavoriteFdcIds((prev) => {
                        const next = new Set(prev);
                        next.delete(fdcId);
                        return next;
                      });
                    } else if (customFoodId) {
                      await supabase
                        .from('favorites')
                        .delete()
                        .eq('user_id', DEFAULT_USER_ID)
                        .eq('custom_food_id', customFoodId);
                      setFavoriteCustomFoodIds((prev) => {
                        const next = new Set(prev);
                        next.delete(customFoodId);
                        return next;
                      });
                    }
                    setFavorites((prev) => {
                      const next = new Set(prev);
                      next.delete(normalizedName);
                      return next;
                    });
                  } else {
                    if (!fdcId && !customFoodId) {
                      console.error(
                        'Cannot favorite item without fdc_id or custom_food_id'
                      );
                      return;
                    }
                    if (fdcId) {
                      await supabase.from('favorites').insert({
                        user_id: DEFAULT_USER_ID,
                        food_name: normalizedName,
                        fdc_id: fdcId,
                      });
                      setFavoriteFdcIds((prev) => new Set([...prev, fdcId]));
                      if (item._originalFood) {
                        setFavoriteFoodCache((prev) => {
                          const newMap = new Map(prev);
                          newMap.set(fdcId, item._originalFood);
                          return newMap;
                        });
                      }
                    } else if (customFoodId) {
                      await supabase.from('favorites').insert({
                        user_id: DEFAULT_USER_ID,
                        food_name: normalizedName,
                        custom_food_id: customFoodId,
                      });
                      setFavoriteCustomFoodIds(
                        (prev) => new Set([...prev, customFoodId])
                      );
                    }
                    setFavorites((prev) => new Set([...prev, normalizedName]));
                  }
                } catch (error) {
                  console.error('Error toggling favorite:', error);
                }
              }}
              className="text-lg transition-colors cursor-pointer bg-transparent border-0 p-0"
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <span
                className={isFavorite ? 'text-yellow-500' : 'text-gray-300'}
              >
                ★
              </span>
            </button>
          );
        })()}
        <div className="flex flex-wrap gap-2">
          {SELECTED_MICROS.map((m) => {
            const val = safeNum(
              item.micros?.[m.key as keyof typeof item.micros]
            );
            if (!val) return null;
            return (
              <span
                key={m.key}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] bg-slate-50"
              >
                <span className="font-medium">{m.label}:</span>
                <span>
                  {m.unit === 'mg' ? Math.round(val) : round(val, 1)}
                  {m.unit || ''}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end">
        <button
          onClick={() => setLog((prev) => prev.filter((i) => i.id !== item.id))}
          className="text-xs text-slate-500 transition-colors hover:text-rose-600 cursor-pointer bg-transparent border-0 p-0"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

// ===================== File export helpers (CSV + optional XLSX) =====================
function escapeCSVCell(val: any): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
function toCSV(
  rows: Array<Array<string | number>>,
  excelFriendly = true
): string {
  const lines = rows.map((r) => r.map(escapeCSVCell).join(','));
  let csv = lines.join('\r\n');
  if (excelFriendly) csv = '\uFEFF' + csv; // BOM for Excel UTF‑8
  return csv;
}
function triggerCSVDownload(content: string, filename: string): boolean {
  try {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    // @ts-ignore (IE legacy)
    if (
      typeof navigator !== 'undefined' &&
      (navigator as any).msSaveOrOpenBlob
    ) {
      (navigator as any).msSaveOrOpenBlob(blob, filename);
      return true;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.setAttribute('download', filename);
    a.rel = 'noopener';
    a.target = '_self';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('CSV download failed', err);
    return false;
  }
}
function openCSVInNewTab(csvContent: string) {
  try {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank', 'noopener');
    if (!w) console.warn('Popup blocked; showing inline preview instead');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    console.warn('Open CSV in new tab failed', e);
  }
}
function copyCSVToClipboard(csv: string) {
  const tryNative = async () => {
    // @ts-ignore
    if ((navigator as any)?.clipboard?.writeText) {
      await (navigator as any).clipboard.writeText(csv);
      return true;
    }
    return false;
  };
  tryNative()
    .then((ok) => {
      if (ok) return;
      const ta = document.createElement('textarea');
      ta.value = csv;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
      } catch {}
      document.body.removeChild(ta);
    })
    .catch(() => console.warn('Copy to clipboard failed'));
}
// True .xlsx export if SheetJS is present on window (no static import)
function downloadExcelXlsx(
  rows: Array<Array<string | number>>,
  filename = 'wellness_results.xlsx'
) {
  try {
    const XLSX = (window as any)?.XLSX;
    if (!XLSX) {
      console.warn(
        'XLSX library not found on window; falling back to CSV preview/download.'
      );
      return false;
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'TWS');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.target = '_self';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (e) {
    console.warn('Excel export failed', e);
    return false;
  }
}

// ===================== App =====================
export default function WellnessCalculator() {
  // ===== Calculator inputs (baseline) =====
  const [units, setUnits] = useState<Units>('us');
  const [sex, setSex] = useState<Sex>('male');
  const [age, setAge] = useState<number>(0);
  const [heightFt, setHeightFt] = useState<number>(0);
  const [heightIn, setHeightIn] = useState<number>(0);
  const [heightCm, setHeightCm] = useState<number>(0);
  const [weightLb, setWeightLb] = useState<number>(0);
  const [weightKg, setWeightKg] = useState<number>(0);
  const [activity, setActivity] = useState<number>(1.55);
  const [goal, setGoal] = useState<Goal>('maintain');

  const cm = units === 'us' ? heightFt * 30.48 + heightIn * 2.54 : heightCm;
  const kg = units === 'us' ? weightLb * 0.45359237 : weightKg;
  const bmr = useMemo(
    () =>
      Math.max(10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161), 0),
    [kg, cm, age, sex]
  );
  const tdee = useMemo(() => bmr * activity, [bmr, activity]);
  const goalAdj: Record<Goal, number> = {
    maintain: 1,
    cut10: 0.9,
    cut20: 0.8,
    gain10: 1.1,
    gain20: 1.2,
  };
  const targetCalories = useMemo(
    () => tdee * (goalAdj[goal] ?? 1),
    [tdee, goal]
  );

  // ===== Search state =====
  const [fdcApiKey, setFdcApiKey] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [showResults, setShowResults] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [customFoodsPage, setCustomFoodsPage] = useState(1);
  const [favoritesPage, setFavoritesPage] = useState(1);

  // ===== Custom food state =====
  const [customFoods, setCustomFoods] = useState<any[]>([]);
  const [showCustomFoods, setShowCustomFoods] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showCustomFoodModal, setShowCustomFoodModal] = useState(false);
  const [showRemoveCustomFoodModal, setShowRemoveCustomFoodModal] =
    useState(false);
  const [customFoodToRemove, setCustomFoodToRemove] = useState<any>(null);
  const [favoriteFoodCache, setFavoriteFoodCache] = useState<Map<number, any>>(
    new Map()
  );
  const [cacheVersion, setCacheVersion] = useState(0);
  const [customFoodName, setCustomFoodName] = useState('');
  const [customFoodBrand, setCustomFoodBrand] = useState('');
  const [customFoodAmount, setCustomFoodAmount] = useState('100');
  const [customFoodCalories, setCustomFoodCalories] = useState('');
  const [customFoodFiber, setCustomFoodFiber] = useState('');
  const [customFoodProtein, setCustomFoodProtein] = useState('');
  const [selectedEnergy, setSelectedEnergy] = useState<
    'bmr' | 'tdee' | 'target' | null
  >(null);

  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  const validateAge = (value: number): string => {
    if (value <= 0) return 'Age must be greater than 0';
    if (value > 120) return 'Age must be 120 or less';
    return '';
  };

  const validateHeightFt = (value: number): string => {
    if (value < 0) return 'Height cannot be negative';
    if (value > 9) return 'Height must be 9 feet or less';
    return '';
  };

  const validateHeightIn = (value: number): string => {
    if (value < 0) return 'Inches cannot be negative';
    if (value >= 12) return 'Inches must be less than 12';
    return '';
  };

  const validateHeightCm = (value: number): string => {
    if (value <= 0) return 'Height must be greater than 0';
    if (value > 300) return 'Height must be 300 cm or less';
    return '';
  };

  const validateWeightLb = (value: number): string => {
    if (value <= 0) return 'Weight must be greater than 0';
    if (value > 1500) return 'Weight must be 1500 lb or less';
    return '';
  };

  const validateWeightKg = (value: number): string => {
    if (value <= 0) return 'Weight must be greater than 0';
    if (value > 680) return 'Weight must be 680 kg or less';
    return '';
  };

  const validateUsdaKey = (value: string): string => {
    if (!value.trim()) return 'API key is required to search';
    return '';
  };

  const validateCustomFoodName = (value: string): string => {
    if (!value.trim()) return 'Food name is required';
    if (value.trim().length < 2) return 'Name must be at least 2 characters';
    return '';
  };

  const validateCustomFoodAmount = (value: string): string => {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return 'Amount must be greater than 0';
    if (num > 10000) return 'Amount must be 10000g or less';
    return '';
  };

  const validateCustomFoodCalories = (value: string): string => {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) return 'Calories cannot be negative';
    if (num > 10000) return 'Calories must be 10000 or less';
    return '';
  };

  const validateCustomFoodNutrient = (value: string, name: string): string => {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) return `${name} cannot be negative`;
    if (num > 1000) return `${name} must be 1000g or less`;
    return '';
  };

  const setValidationError = (field: string, error: string) => {
    setValidationErrors((prev) => {
      if (error) {
        return { ...prev, [field]: error };
      } else {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      }
    });
  };

  // Load settings from Supabase on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('user_settings')
          .select('*')
          .eq('user_id', DEFAULT_USER_ID)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          setFdcApiKey(data.fdc_api_key || '');
          setResults(data.search_results || []);
          setTotalResults(data.total_results || 0);
          const draft = data.custom_food_draft || {};
          setCustomFoodName(draft.name || '');
          setCustomFoodBrand(draft.brand || '');
          setCustomFoodAmount(draft.amount || '100');
          setCustomFoodCalories(draft.calories || '');
          setCustomFoodFiber(draft.fiber || '');
          setCustomFoodProtein(draft.protein || '');
          setSelectedEnergy(
            (data.selected_energy as 'bmr' | 'tdee' | 'target' | null) || null
          );
        } else {
          const { error: insertError } = await supabase
            .from('user_settings')
            .insert({
              user_id: DEFAULT_USER_ID,
              fdc_api_key: '',
              search_results: [],
              custom_food_draft: {},
            });

          if (insertError) throw insertError;
        }
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    };
    loadSettings();
  }, []);

  // Save API key to Supabase when it changes
  useEffect(() => {
    const saveApiKey = async () => {
      try {
        const { error } = await supabase
          .from('user_settings')
          .update({
            fdc_api_key: fdcApiKey,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', DEFAULT_USER_ID);

        if (error) throw error;
      } catch (error) {
        console.error('Error saving API key:', error);
      }
    };

    if (fdcApiKey) {
      const timeoutId = setTimeout(saveApiKey, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [fdcApiKey]);

  // Save selected energy to Supabase when it changes
  useEffect(() => {
    const saveSelectedEnergy = async () => {
      try {
        const { error } = await supabase
          .from('user_settings')
          .update({
            selected_energy: selectedEnergy,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', DEFAULT_USER_ID);

        if (error) throw error;
      } catch (error) {
        console.error('Error saving selected energy:', error);
      }
    };

    if (!isInitialLoad) {
      saveSelectedEnergy();
    }
  }, [selectedEnergy, isInitialLoad]);

  // Save search results to Supabase when they change
  useEffect(() => {
    if (isInitialLoad) return;

    const saveResults = async () => {
      try {
        const { error } = await supabase
          .from('user_settings')
          .update({
            search_results: results,
            total_results: totalResults,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', DEFAULT_USER_ID);

        if (error) throw error;
      } catch (error) {
        console.error('Error saving search results:', error);
      }
    };

    const timeoutId = setTimeout(saveResults, 500);
    return () => clearTimeout(timeoutId);
  }, [results, totalResults, isInitialLoad]);

  // Save custom food draft data when it changes
  useEffect(() => {
    const saveDraft = async () => {
      try {
        const draft = {
          name: customFoodName,
          brand: customFoodBrand,
          amount: customFoodAmount,
          calories: customFoodCalories,
          fiber: customFoodFiber,
          protein: customFoodProtein,
        };

        const { error } = await supabase
          .from('user_settings')
          .update({
            custom_food_draft: draft,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', DEFAULT_USER_ID);

        if (error) throw error;
      } catch (error) {
        console.error('Error saving draft:', error);
      }
    };

    const timeoutId = setTimeout(saveDraft, 500);
    return () => clearTimeout(timeoutId);
  }, [
    customFoodName,
    customFoodBrand,
    customFoodAmount,
    customFoodCalories,
    customFoodFiber,
    customFoodProtein,
  ]);

  // ===== Food log & CSV (state + sticky fallback) =====
  const [log, setLog] = useState<LogItem[]>([]);
  const [csvPreview, setCsvPreview] = useState<string>('');
  const [showCsv, setShowCsv] = useState<boolean>(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoriteFdcIds, setFavoriteFdcIds] = useState<Set<number>>(new Set());
  const [favoriteCustomFoodIds, setFavoriteCustomFoodIds] = useState<
    Set<string>
  >(new Set());
  const itemsPerPage = 10;
  const totalPages = Math.ceil(totalResults / itemsPerPage);
  const customFoodsTotalPages = Math.ceil(customFoods.length / itemsPerPage);
  const paginatedCustomFoods = customFoods.slice(
    (customFoodsPage - 1) * itemsPerPage,
    customFoodsPage * itemsPerPage
  );
  const allFavorites = [
    ...Array.from(favoriteCustomFoodIds).map((id) => ({
      type: 'custom' as const,
      id,
    })),
    ...Array.from(favoriteFdcIds).map((id) => ({ type: 'fdc' as const, id })),
  ];
  const favoritesTotalPages = Math.ceil(allFavorites.length / itemsPerPage);
  const paginatedFavorites = allFavorites.slice(
    (favoritesPage - 1) * itemsPerPage,
    favoritesPage * itemsPerPage
  );
  const paginatedResults = results.slice(0, itemsPerPage);
  const searchResultsPages = Math.max(
    totalPages,
    Math.ceil(results.length / itemsPerPage)
  );

  // Load custom foods from Supabase
  useEffect(() => {
    const loadCustomFoods = async () => {
      try {
        const { data, error } = await supabase
          .from('custom_foods')
          .select('*')
          .eq('user_id', DEFAULT_USER_ID)
          .order('created_at', { ascending: false });

        if (error) throw error;

        setCustomFoods(data || []);
      } catch (error) {
        console.error('Error loading custom foods:', error);
      }
    };
    loadCustomFoods();
  }, []);

  // Load favorites from Supabase on mount
  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const { data, error } = await supabase
          .from('favorites')
          .select('food_name, fdc_id, custom_food_id')
          .eq('user_id', DEFAULT_USER_ID);

        if (error) throw error;

        if (data) {
          setFavorites(new Set(data.map((item: any) => item.food_name)));
          const fdcSet = new Set<number>();
          const customSet = new Set<string>();
          data.forEach((item: any) => {
            if (item.fdc_id) {
              fdcSet.add(item.fdc_id);
            }
            if (item.custom_food_id) {
              customSet.add(item.custom_food_id);
            }
          });
          setFavoriteFdcIds(fdcSet);
          setFavoriteCustomFoodIds(customSet);
        }
      } catch (error) {
        console.error('Error loading favorites:', error);
      }
    };
    loadFavorites();
    setTimeout(() => setIsInitialLoad(false), 1000);
  }, []);

  // Fetch missing favorite foods when Favorites section is shown
  useEffect(() => {
    if (!showFavoritesOnly || !fdcApiKey) {
      return;
    }

    const fetchMissingFavorites = async () => {
      console.log('Fetching missing favorites...', {
        fdcFavoritesCount: favoriteFdcIds.size,
        cacheSize: favoriteFoodCache.size,
      });

      for (const fdcId of favoriteFdcIds) {
        console.log('Checking favorite fdcId:', fdcId);

        const inResults = results.find(
          (r) => r?.fdcId === fdcId || r?.FdcId === fdcId
        );
        if (inResults) {
          console.log('Found in results:', fdcId);
          continue;
        }

        if (!favoriteFoodCache.has(fdcId)) {
          console.log('Fetching food from API:', fdcId);
          await fetchFoodByFdcId(fdcId);
        } else {
          console.log('Already in cache:', fdcId);
        }
      }
      console.log('Finished fetching favorites');
    };

    fetchMissingFavorites();
  }, [
    showFavoritesOnly,
    favorites,
    favoriteFdcIds,
    customFoods,
    results,
    fdcApiKey,
  ]);

  // Load log from Supabase on mount
  useEffect(() => {
    const loadLog = async () => {
      try {
        const { data, error } = await supabase
          .from('food_log')
          .select('*')
          .eq('user_id', DEFAULT_USER_ID)
          .order('created_at', { ascending: true });

        if (error) throw error;

        if (data) {
          const items = data.map((item: any) => {
            const serving = Number(item.amount);
            const basePerG = item.base_per_g || {
              energy: 0,
              protein: 0,
              fat: 0,
              carbs: 0,
              micros: {},
            };
            return {
              name: item.name,
              serving: serving,
              energy: basePerG.energy * serving,
              protein: basePerG.protein * serving,
              fat: basePerG.fat * serving,
              carbs: basePerG.carbs * serving,
              micros: Object.fromEntries(
                Object.entries(basePerG.micros || {}).map(([k, v]) => [
                  k,
                  (v as number) * serving,
                ])
              ) as Record<string, number>,
              _basePerG: basePerG,
              fdcId: item.fdc_id,
              customFoodId: item.custom_food_id,
            };
          });
          setLog(items.map(ensureBasePerG));
        }
      } catch (error) {
        console.error('Error loading food log:', error);
      }
    };
    loadLog();
  }, []);

  // Save log to Supabase when it changes
  useEffect(() => {
    const saveLog = async () => {
      try {
        await supabase.from('food_log').delete().eq('user_id', DEFAULT_USER_ID);

        if (log.length > 0) {
          const items = log.map((item) => ({
            user_id: DEFAULT_USER_ID,
            name: item.name,
            amount: item.serving,
            base_per_g: item._basePerG,
            fdc_id: item.fdcId || null,
            custom_food_id: item.customFoodId || null,
          }));

          const { error } = await supabase.from('food_log').insert(items);

          if (error) throw error;
        }
      } catch (error) {
        console.error('Error saving food log:', error);
      }
    };

    const timeoutId = setTimeout(saveLog, 500);
    return () => clearTimeout(timeoutId);
  }, [log]);

  // Demo foods helper
  const useDemoFoods = () => {
    const DEMO: any[] = [
      {
        fdcId: 1,
        description: 'Apple, raw, with skin',
        dataType: 'SR Legacy',
        labelNutrients: {
          calories: { value: 52 },
          protein: { value: 0.3 },
          fat: { value: 0.2 },
          carbohydrates: { value: 14 },
          fiber: { value: 2.4 },
          sugars: { value: 10.4 },
        },
      },
      {
        fdcId: 2,
        description: 'Chicken breast, roasted',
        dataType: 'SR Legacy',
        labelNutrients: {
          calories: { value: 165 },
          protein: { value: 31 },
          fat: { value: 3.6 },
          carbohydrates: { value: 0 },
          fiber: { value: 0 },
          saturatedFat: { value: 1.0 },
          cholesterol: { value: 85 },
        },
      },
      {
        fdcId: 3,
        description: 'Brown rice, cooked',
        dataType: 'SR Legacy',
        labelNutrients: {
          calories: { value: 111 },
          protein: { value: 2.6 },
          fat: { value: 0.9 },
          carbohydrates: { value: 23 },
          fiber: { value: 1.8 },
          sugars: { value: 0.4 },
          sodium: { value: 5 },
        },
      },
      {
        fdcId: 4,
        description: 'Kale, raw',
        dataType: 'SR Legacy',
        labelNutrients: {
          calories: { value: 49 },
          protein: { value: 4.3 },
          fat: { value: 0.9 },
          carbohydrates: { value: 9 },
          fiber: { value: 3.6 },
          sugars: { value: 2.3 },
          sodium: { value: 38 },
        },
      },
      {
        fdcId: 5,
        description: 'Beef, ground, 90% lean, cooked',
        dataType: 'SR Legacy',
        labelNutrients: {
          calories: { value: 242 },
          protein: { value: 26.1 },
          fat: { value: 14 },
          carbohydrates: { value: 0 },
          fiber: { value: 0 },
          saturatedFat: { value: 5.7 },
          cholesterol: { value: 88 },
        },
      },
    ];
    setResults(DEMO);
    setTotalResults(0);
    setShowResults(true);
    setSearchError('');
    setShowCustomFoods(false);
    setShowFavoritesOnly(false);
    setIsDemoMode(true);
  };

  async function fetchFoodByFdcId(fdcId: number, retryCount = 0) {
    if (!fdcApiKey) {
      console.log('No API key for fetching food:', fdcId);
      return null;
    }
    if (favoriteFoodCache.has(fdcId)) {
      console.log('Food already in cache:', fdcId);
      return favoriteFoodCache.get(fdcId);
    }
    try {
      console.log('Fetching food from USDA API:', fdcId, 'retry:', retryCount);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${fdcApiKey}`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        console.error('Failed to fetch food:', res.status, fdcId);
        if (retryCount < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return fetchFoodByFdcId(fdcId, retryCount + 1);
        }
        return null;
      }
      const food = await res.json();
      console.log('Successfully fetched food:', fdcId, food);
      setFavoriteFoodCache((prev) => {
        const newMap = new Map(prev);
        newMap.set(fdcId, food);
        return newMap;
      });
      setCacheVersion((prev) => prev + 1);
      return food;
    } catch (e) {
      console.error('Error fetching food by FDC ID:', e);
      if (retryCount < 2 && e instanceof Error && e.name !== 'AbortError') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return fetchFoodByFdcId(fdcId, retryCount + 1);
      }
      return null;
    }
  }

  async function searchFoods(pageNumber = 1) {
    setSearchError('');
    const keyError = validateUsdaKey(fdcApiKey);
    if (keyError) {
      setValidationError('usdaKey', keyError);
      return;
    }
    setIsSearching(true);
    try {
      if (!fdcApiKey)
        throw new Error('Enter your (free) USDA API key or use demo foods.');
      const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
      url.searchParams.set('api_key', fdcApiKey);
      url.searchParams.set('query', query.trim());
      url.searchParams.set('pageSize', String(itemsPerPage));
      url.searchParams.set('pageNumber', String(pageNumber));
      url.searchParams.set(
        'dataType',
        ['Branded', 'Survey (FNDDS)', 'Foundation', 'SR Legacy'].join(',')
      );
      const res = await fetch(url.toString());
      if (res.status === 403)
        throw new Error('403 from USDA. Check your key, or click demo.');
      if (!res.ok) throw new Error(`Search failed (${res.status}).`);
      const data = await res.json();
      console.log('API Response:', {
        totalHits: data?.totalHits,
        foodsCount: data?.foods?.length,
      });
      if (data?.foods?.length > 0) {
        console.log('Sample food object keys:', Object.keys(data.foods[0]));
        console.log(
          'Sample food fdcId check:',
          data.foods[0].fdcId,
          data.foods[0].FdcId
        );
      }
      const foods = Array.isArray(data?.foods) ? data.foods : [];
      const newTotalResults =
        data?.totalHits || (foods.length > itemsPerPage ? foods.length : 0);

      setResults(foods);
      setTotalResults(newTotalResults);
      setCurrentPage(pageNumber);
      setShowResults(true);
      setShowCustomFoods(false);
      setShowFavoritesOnly(false);
      setIsDemoMode(false);
    } catch (e: any) {
      setSearchError(e?.message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }

  function parseFood(food: any, foodName?: string): LogItem {
    const declared =
      food?.servingSize && (food?.servingSizeUnit || '').toLowerCase() === 'g'
        ? food.servingSize
        : undefined;
    const serving = declared && declared > 0 ? declared : 100;
    const n = safeParse(food, serving);
    const denom = Math.max(serving, 1);
    const basePerG = {
      energy: safeNum(n.energy) / denom,
      protein: safeNum(n.protein) / denom,
      fat: safeNum(n.fat) / denom,
      carbs: safeNum(n.carbs) / denom,
      micros: Object.fromEntries(
        Object.entries(n.micros || {}).map(([k, v]) => [k, safeNum(v) / denom])
      ) as Record<string, number>,
    };
    const item: LogItem = ensureBasePerG({
      id: `${food?.fdcId ?? Math.random()}-${Date.now()}`,
      name:
        foodName ||
        tidyText(food?.description || food?.lowercaseDescription || 'Food'),
      brand:
        tidyText(food?.brandOwner || food?.brandName || food?.dataType || '') ||
        undefined,
      serving,
      energy: basePerG.energy * serving,
      protein: basePerG.protein * serving,
      fat: basePerG.fat * serving,
      carbs: basePerG.carbs * serving,
      micros: Object.fromEntries(
        Object.entries(basePerG.micros).map(([k, v]) => [
          k,
          (v as number) * serving,
        ])
      ) as Record<string, number>,
      _basePerG: basePerG,
      fdcId: food?.fdcId || food?.FdcId,
      _originalFood: food,
    });
    return item;
  }

  function addFood(food: any) {
    const item = food._basePerG
      ? ensureBasePerG({
          ...food,
          id: `${food.id}-${Date.now()}`,
        })
      : parseFood(food);
    setLog((prev) => [item, ...prev]);
    // After adding, jump to first food in the list and focus its Amount box
    try {
      const cardId = `food-card-${item.id}`;
      const amtId = `amt-${item.id}`;
      requestAnimationFrame(() => {
        const node = document.getElementById(cardId);
        if (node && 'scrollIntoView' in node) {
          (node as HTMLElement).scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        } else {
          const header = document.getElementById('foods-anchor');
          header?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        const amt = document.getElementById(amtId) as HTMLInputElement | null;
        if (amt) {
          amt.focus();
          amt.select();
        }
      });
    } catch {
      /* no-op */
    }
  }

  async function handleCustomFoodSubmit() {
    const nameError = validateCustomFoodName(customFoodName);
    const amountError = validateCustomFoodAmount(customFoodAmount);
    const caloriesError = validateCustomFoodCalories(customFoodCalories);
    const fiberError = validateCustomFoodNutrient(customFoodFiber, 'Fiber');
    const proteinError = validateCustomFoodNutrient(
      customFoodProtein,
      'Protein'
    );

    if (
      nameError ||
      amountError ||
      caloriesError ||
      fiberError ||
      proteinError
    ) {
      setValidationError('customFoodName', nameError);
      setValidationError('customFoodAmount', amountError);
      setValidationError('customFoodCalories', caloriesError);
      setValidationError('customFoodFiber', fiberError);
      setValidationError('customFoodProtein', proteinError);
      return;
    }

    const name = customFoodName.trim();
    const brand = customFoodBrand.trim();
    const amount = safeNum(customFoodAmount, 100);
    const calories = safeNum(customFoodCalories, 0);
    const fiber = safeNum(customFoodFiber, 0);
    const protein = safeNum(customFoodProtein, 0);

    try {
      const { error } = await supabase.from('custom_foods').insert({
        user_id: DEFAULT_USER_ID,
        name,
        brand,
        amount,
        calories,
        fiber,
        protein,
      });

      if (error) throw error;

      setShowCustomFoodModal(false);
      setCustomFoodName('');
      setCustomFoodBrand('');
      setCustomFoodAmount('100');
      setCustomFoodCalories('');
      setCustomFoodFiber('');
      setCustomFoodProtein('');
      setValidationError('customFoodName', '');
      setValidationError('customFoodAmount', '');
      setValidationError('customFoodCalories', '');
      setValidationError('customFoodFiber', '');
      setValidationError('customFoodProtein', '');

      await supabase
        .from('user_settings')
        .update({
          custom_food_draft: {},
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', DEFAULT_USER_ID);

      const { data: customFoodsData } = await supabase
        .from('custom_foods')
        .select('*')
        .eq('user_id', DEFAULT_USER_ID)
        .order('created_at', { ascending: false });

      setCustomFoods(customFoodsData || []);
    } catch (error) {
      console.error('Error saving custom food:', error);
      alert('Failed to save custom food');
    }
  }

  async function handleCustomFoodCancel() {
    setShowCustomFoodModal(false);
    setCustomFoodName('');
    setCustomFoodBrand('');
    setCustomFoodAmount('100');
    setCustomFoodCalories('');
    setCustomFoodFiber('');
    setCustomFoodProtein('');
    setValidationError('customFoodName', '');
    setValidationError('customFoodAmount', '');
    setValidationError('customFoodCalories', '');
    setValidationError('customFoodFiber', '');
    setValidationError('customFoodProtein', '');

    try {
      await supabase
        .from('user_settings')
        .update({
          custom_food_draft: {},
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', DEFAULT_USER_ID);
    } catch (error) {
      console.error('Error clearing draft:', error);
    }
  }

  // Totals
  const totals = useMemo(
    () =>
      log.reduce(
        (acc, x) => {
          const kc =
            safeNum(x.protein) * 4 + safeNum(x.fat) * 9 + safeNum(x.carbs) * 4;
          acc.mass += Math.max(0, safeNum(x.serving));
          acc.cal += kc;
          acc.protein += safeNum(x.protein);
          acc.fiber += safeNum(x.micros?.fiber);
          return acc;
        },
        { mass: 0, cal: 0, protein: 0, fiber: 0 }
      ),
    [log]
  );
  const TFF = ff(totals.cal, totals.fiber),
    TPF = pf(totals.cal, totals.protein),
    TWF = wf(TFF, TPF),
    TEF = ef(totals.cal, totals.mass);

  // CSV/Excel rows
  function buildCsvRows(): Array<Array<string | number>> {
    const rows: Array<Array<string | number>> = [
      ['=== Energy ==='],
      ['BMR (kcal)', round(bmr, 0)],
      ['TDEE (kcal)', round(tdee, 0)],
      ['Target (kcal)', round(targetCalories, 0)],
      [''],
      ['=== Food Log (totals) ==='],
      ['Amount (g)', round(totals.mass, 1)],
      ['Calories (kcal)', round(totals.cal, 0)],
      ['Fiber (g)', round(totals.fiber, 1)],
      ['Protein (g)', round(totals.protein, 1)],
      ['FF', formatFactor(TFF)],
      ['PF', formatFactor(TPF)],
      ['WF', formatFactor(TWF)],
      ['EF', formatFactor(TEF, true)],
      [''],
      ['=== Items ==='],
      [
        'Name',
        'Brand',
        'Serving (g)',
        'kcal',
        'Protein (g)',
        'Fat (g)',
        'Carbs (g)',
        'Fiber (g)',
        'Sugar (g)',
        'Sat Fat (g)',
        'Sodium (mg)',
        'Cholesterol (mg)',
        'FF',
        'PF',
        'WF',
        'EF',
      ],
      ...log.map((x) => {
        const kc =
          safeNum(x.protein) * 4 + safeNum(x.fat) * 9 + safeNum(x.carbs) * 4;
        const fiber = safeNum(x.micros?.fiber);
        const F1 = ff(kc, fiber),
          F2 = pf(kc, safeNum(x.protein)),
          F3 = wf(F1, F2),
          F4 = ef(kc, Math.max(0, safeNum(x.serving)));
        return [
          x.name,
          x.brand || '',
          Math.max(0, round(x.serving, 1)),
          round(kc, 0),
          round(x.protein, 1),
          round(x.fat, 1),
          round(x.carbs, 1),
          round(fiber, 1),
          round(safeNum(x.micros?.sugar), 1),
          round(safeNum(x.micros?.satfat), 1),
          Math.round(safeNum(x.micros?.sodium)),
          Math.round(safeNum(x.micros?.cholesterol)),
          formatFactor(F1),
          formatFactor(F2),
          formatFactor(F3),
          formatFactor(F4, true),
        ];
      }),
    ];
    if (log.length === 0) rows.push(['(No items logged)']);
    return rows;
  }
  const getCurrentCSV = () => toCSV(buildCsvRows(), true);

  function downloadCSV() {
    const csv = getCurrentCSV();
    setCsvPreview(csv);
    const ok = triggerCSVDownload(csv, 'wellness_results.csv');
    if (!ok) setShowCsv(true);
  }

  // Auto-refresh CSV preview whenever inputs/log change
  useEffect(() => {
    setCsvPreview(getCurrentCSV());
  }, [log, bmr, tdee, targetCalories]);

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-6xl w-full px-4 py-8 box-border">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/toplogo2.png" alt="Logo" className="logo-spin h-8 w-8" />
            <h1 className="text-2xl font-semibold tracking-tight">
              The WLness System Food Calculator - beta
            </h1>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Units:</span>
            <div className="inline-flex overflow-hidden rounded-full border">
              <button
                className={
                  'px-3 py-1 ' +
                  (units === 'us'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-black')
                }
                onClick={() => setUnits('us')}
              >
                US
              </button>
              <button
                className={
                  'px-3 py-1 ' +
                  (units === 'metric'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-black')
                }
                onClick={() => setUnits('metric')}
              >
                Metric
              </button>
            </div>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-12 w-full">
          {/* ===== Your Details + Energy ===== */}
          <section className="rounded-2xl border bg-white p-4 shadow-sm mb-6 md:col-span-5 w-full min-w-0">
            <h2 className="text-lg font-medium mb-3">Your Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="sex"
                  className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                >
                  Physiological Sex
                </label>
                <select
                  id="sex"
                  className="w-full rounded-xl border border-slate-400 focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm"
                  value={sex}
                  onChange={(e) => setSex(e.target.value as Sex)}
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="age"
                  className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                >
                  Age
                </label>
                <input
                  id="age"
                  type="number"
                  value={age === 0 ? '' : age}
                  onChange={(e) => {
                    const val = parseInt(e.target.value || '0');
                    setAge(val);
                    setValidationError('age', validateAge(val));
                  }}
                  className={`w-full rounded-xl border ${
                    validationErrors.age
                      ? 'border-rose-500'
                      : 'border-slate-400'
                  } focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm`}
                  placeholder="0"
                />
                {validationErrors.age && (
                  <p className="mt-1 text-xs text-rose-600">
                    {validationErrors.age}
                  </p>
                )}
              </div>

              {units === 'us' ? (
                <>
                  <div>
                    <label
                      htmlFor="heightFt"
                      className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                    >
                      Height – Feet
                    </label>
                    <input
                      id="heightFt"
                      type="number"
                      value={heightFt === 0 ? '' : heightFt}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value || '0');
                        setHeightFt(val);
                        setValidationError('heightFt', validateHeightFt(val));
                      }}
                      className={`w-full rounded-xl border ${
                        validationErrors.heightFt
                          ? 'border-rose-500'
                          : 'border-slate-400'
                      } focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm`}
                      placeholder="0"
                    />
                    {validationErrors.heightFt && (
                      <p className="mt-1 text-xs text-rose-600">
                        {validationErrors.heightFt}
                      </p>
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor="heightIn"
                      className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                    >
                      Height – Inches
                    </label>
                    <input
                      id="heightIn"
                      type="number"
                      value={heightIn === 0 ? '' : heightIn}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value || '0');
                        setHeightIn(val);
                        setValidationError('heightIn', validateHeightIn(val));
                      }}
                      className={`w-full rounded-xl border ${
                        validationErrors.heightIn
                          ? 'border-rose-500'
                          : 'border-slate-400'
                      } focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm`}
                      placeholder="0"
                    />
                    {validationErrors.heightIn && (
                      <p className="mt-1 text-xs text-rose-600">
                        {validationErrors.heightIn}
                      </p>
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor="weightLb"
                      className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                    >
                      Weight – lb
                    </label>
                    <input
                      id="weightLb"
                      type="number"
                      value={weightLb === 0 ? '' : weightLb}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value || '0');
                        setWeightLb(val);
                        setValidationError('weightLb', validateWeightLb(val));
                      }}
                      className={`w-full rounded-xl border ${
                        validationErrors.weightLb
                          ? 'border-rose-500'
                          : 'border-slate-400'
                      } focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm`}
                      placeholder="0"
                    />
                    {validationErrors.weightLb && (
                      <p className="mt-1 text-xs text-rose-600">
                        {validationErrors.weightLb}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="col-span-2">
                    <label
                      htmlFor="heightCm"
                      className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                    >
                      Height – cm
                    </label>
                    <input
                      id="heightCm"
                      type="number"
                      value={heightCm === 0 ? '' : heightCm}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value || '0');
                        setHeightCm(val);
                        setValidationError('heightCm', validateHeightCm(val));
                      }}
                      className={`w-full rounded-xl border ${
                        validationErrors.heightCm
                          ? 'border-rose-500'
                          : 'border-slate-400'
                      } focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm`}
                      placeholder="0"
                    />
                    {validationErrors.heightCm && (
                      <p className="mt-1 text-xs text-rose-600">
                        {validationErrors.heightCm}
                      </p>
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor="weightKg"
                      className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                    >
                      Weight – kg
                    </label>
                    <input
                      id="weightKg"
                      type="number"
                      value={weightKg === 0 ? '' : weightKg}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value || '0');
                        setWeightKg(val);
                        setValidationError('weightKg', validateWeightKg(val));
                      }}
                      className={`w-full rounded-xl border ${
                        validationErrors.weightKg
                          ? 'border-rose-500'
                          : 'border-slate-400'
                      } focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm`}
                      placeholder="0"
                    />
                    {validationErrors.weightKg && (
                      <p className="mt-1 text-xs text-rose-600">
                        {validationErrors.weightKg}
                      </p>
                    )}
                  </div>
                </>
              )}

              <div className="col-span-2">
                <label
                  htmlFor="activity"
                  className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                >
                  Activity
                </label>
                <select
                  id="activity"
                  className="w-full rounded-xl border border-slate-400 focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm"
                  value={activity}
                  onChange={(e) => setActivity(parseFloat(e.target.value))}
                >
                  <option value={1.2}>Sedentary (1.2×)</option>
                  <option value={1.375}>Light (1.375×)</option>
                  <option value={1.55}>Moderate (1.55×)</option>
                  <option value={1.725}>Very active (1.725×)</option>
                  <option value={1.9}>Extra active (1.9×)</option>
                </select>
              </div>
              <div className="col-span-2">
                <label
                  htmlFor="goal"
                  className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                >
                  Goal
                </label>
                <select
                  id="goal"
                  className="w-full rounded-xl border border-slate-400 focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value as Goal)}
                >
                  <option value="maintain">Maintain</option>
                  <option value="cut10">Cut (−10%)</option>
                  <option value="cut20">Cut (−20%)</option>
                  <option value="gain10">Gain (+10%)</option>
                  <option value="gain20">Gain (+20%)</option>
                </select>
              </div>
            </div>

            <div className="mt-4">
              <h3 className="text-base font-medium mb-2">Energy</h3>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <button
                  onClick={() =>
                    setSelectedEnergy(selectedEnergy === 'bmr' ? null : 'bmr')
                  }
                  className={`rounded-lg border p-2 transition-all ${
                    selectedEnergy === 'bmr'
                      ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <Stat label="BMR" value={`${round(bmr, 0)} kcal`} />
                </button>
                <button
                  onClick={() =>
                    setSelectedEnergy(selectedEnergy === 'tdee' ? null : 'tdee')
                  }
                  className={`rounded-lg border p-2 transition-all ${
                    selectedEnergy === 'tdee'
                      ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <Stat label="TDEE" value={`${round(tdee, 0)} kcal`} />
                </button>
                <button
                  onClick={() =>
                    setSelectedEnergy(
                      selectedEnergy === 'target' ? null : 'target'
                    )
                  }
                  className={`rounded-lg border p-2 transition-all ${
                    selectedEnergy === 'target'
                      ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <Stat
                    label="Target"
                    value={`${round(targetCalories, 0)} kcal`}
                  />
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                BMR = Mifflin–St Jeor; Target = TDEE × goal.
              </p>
            </div>
          </section>

          {/* ===== Food Search ===== */}
          <div className="md:col-span-7 md:col-start-6 flex flex-col w-full min-w-0">
            <section
              id="food-search"
              className="rounded-2xl border bg-white p-4 shadow-sm w-full min-w-0"
            >
              <h2 className="text-lg font-medium mb-2">Food Search</h2>
              <p className="mb-3 text-xs text-slate-500">
                Get a free USDA key:{' '}
                <a
                  className="underline cursor-pointer hover:text-blue-600"
                  href="https://fdc.nal.usda.gov/api-key-signup.html"
                  target="_blank"
                  rel="noreferrer"
                >
                  fdc.nal.usda.gov/api-key-signup.html
                </a>
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="usdaKey"
                    className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                  >
                    USDA API Key
                  </label>
                  <input
                    id="usdaKey"
                    type="password"
                    placeholder="USDA API Key"
                    value={fdcApiKey}
                    onChange={(e) => {
                      setFdcApiKey(e.target.value);
                      if (validationErrors.usdaKey) {
                        setValidationError('usdaKey', '');
                      }
                    }}
                    className={`w-full rounded-xl border ${
                      validationErrors.usdaKey
                        ? 'border-rose-500'
                        : 'border-slate-400'
                    } focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm`}
                  />
                  {validationErrors.usdaKey && (
                    <p className="mt-1 text-xs text-rose-600">
                      {validationErrors.usdaKey}
                    </p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <label
                    htmlFor="searchQuery"
                    className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                  >
                    Search
                  </label>
                  <input
                    id="searchQuery"
                    type="text"
                    placeholder="e.g., chicken breast, apple"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchFoods()}
                    className="w-full rounded-xl border border-slate-400 focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm"
                  />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <button
                  onClick={() => searchFoods()}
                  disabled={isSearching}
                  className="rounded-xl bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50 hover:bg-slate-800 focus:outline-none focus:ring-0"
                >
                  {isSearching ? 'Searching…' : 'Search'}
                </button>
                <button
                  onClick={() => {
                    setResults([]);
                    setQuery('');
                    setShowResults(false);
                    setShowCustomFoods(false);
                    setShowFavoritesOnly(false);
                    setIsDemoMode(false);
                  }}
                  className="rounded-xl bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800 focus:outline-none focus:ring-0"
                >
                  Clear
                </button>
                <button
                  onClick={useDemoFoods}
                  className="rounded-xl bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800 focus:outline-none focus:ring-0"
                >
                  Demo foods
                </button>
                <button
                  onClick={() => {
                    setShowCustomFoods(true);
                    setShowResults(false);
                    setShowFavoritesOnly(false);
                    setCustomFoodsPage(1);
                  }}
                  className="rounded-xl bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800 focus:outline-none focus:ring-0"
                >
                  Custom foods
                </button>
                <button
                  onClick={() => {
                    setShowFavoritesOnly(true);
                    setShowResults(false);
                    setShowCustomFoods(false);
                  }}
                  className="rounded-xl bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800 focus:outline-none focus:ring-0"
                >
                  Favorites
                </button>
              </div>
              {searchError && (
                <p className="mt-2 text-sm text-rose-600">{searchError}</p>
              )}

              {/* Custom Foods Section */}
              {showCustomFoods && (
                <div className="mt-4" id="custom-foods-section">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-slate-700">
                      Custom Foods
                    </h3>
                    <button
                      onClick={() => setShowCustomFoodModal(true)}
                      className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800 focus:outline-none focus:ring-0"
                    >
                      Add custom food
                    </button>
                  </div>
                  <div className="space-y-2 overflow-hidden">
                    {customFoods.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        No custom foods yet.
                      </p>
                    ) : (
                      paginatedCustomFoods.map((cf) => {
                        const caloriesFromProtein = cf.protein * 4;
                        const remainingCalories = Math.max(
                          0,
                          cf.calories - caloriesFromProtein
                        );
                        const derivedCarbs = remainingCalories / 4;

                        const basePerG = {
                          energy: cf.calories / cf.amount,
                          protein: cf.protein / cf.amount,
                          fat: 0,
                          carbs: derivedCarbs / cf.amount,
                          micros: { fiber: cf.fiber / cf.amount } as Record<
                            string,
                            number
                          >,
                        };
                        const item = {
                          id: `custom-${cf.id}`,
                          name: cf.name,
                          brand: cf.brand || 'Custom',
                          serving: cf.amount,
                          energy: cf.calories,
                          protein: cf.protein,
                          fat: 0,
                          carbs: derivedCarbs,
                          micros: { fiber: cf.fiber },
                          _basePerG: basePerG,
                          customFoodId: cf.id,
                        };
                        const VFF = ff(cf.calories, cf.fiber);
                        const VPF = pf(cf.calories, cf.protein);
                        const VWF = wf(VFF, VPF);
                        const VEF = ef(cf.calories, cf.amount);

                        return (
                          <div
                            key={cf.id}
                            className="flex items-center gap-3 rounded-xl border p-3"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium capitalize">
                                {cf.name}
                              </div>
                              <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-500 capitalize">
                                {cf.brand || 'Custom'}
                              </div>
                              <div className="mt-1 text-xs text-slate-600">
                                {cf.amount} g → {round(cf.calories, 0)} kcal • P{' '}
                                {round(cf.protein, 1)} • Fiber{' '}
                                {round(cf.fiber, 1)}
                              </div>
                              <div className="mt-1 flex items-center gap-1">
                                <BadgeHalo
                                  label="FF"
                                  value={VFF}
                                  threshold={50}
                                  compact
                                />
                                <BadgeHalo
                                  label="PF"
                                  value={VPF}
                                  threshold={30}
                                  compact
                                />
                                <BadgeHalo
                                  label="WF"
                                  value={VWF}
                                  threshold={80}
                                  compact
                                />
                                <BadgeHalo
                                  label="EF"
                                  value={VEF}
                                  threshold={1}
                                  compact
                                />
                                <button
                                  onClick={async () => {
                                    try {
                                      const normalizedName =
                                        cf.name.toLowerCase();
                                      const customFoodId = cf.id;
                                      const isFavorite =
                                        favoriteCustomFoodIds.has(customFoodId);

                                      if (isFavorite) {
                                        await supabase
                                          .from('favorites')
                                          .delete()
                                          .eq('user_id', DEFAULT_USER_ID)
                                          .eq('custom_food_id', customFoodId);
                                        setFavorites((prev) => {
                                          const next = new Set(prev);
                                          next.delete(normalizedName);
                                          return next;
                                        });
                                        setFavoriteCustomFoodIds((prev) => {
                                          const next = new Set(prev);
                                          next.delete(customFoodId);
                                          return next;
                                        });
                                      } else {
                                        await supabase
                                          .from('favorites')
                                          .insert({
                                            user_id: DEFAULT_USER_ID,
                                            food_name: normalizedName,
                                            custom_food_id: customFoodId,
                                          });
                                        setFavorites(
                                          (prev) =>
                                            new Set([...prev, normalizedName])
                                        );
                                        setFavoriteCustomFoodIds(
                                          (prev) =>
                                            new Set([...prev, customFoodId])
                                        );
                                      }
                                    } catch (error) {
                                      console.error(
                                        'Error toggling favorite:',
                                        error
                                      );
                                    }
                                  }}
                                  className="text-lg transition-colors cursor-pointer bg-transparent border-0 p-0"
                                  title={
                                    favoriteCustomFoodIds.has(cf.id)
                                      ? 'Remove from favorites'
                                      : 'Add to favorites'
                                  }
                                >
                                  <span
                                    className={
                                      favoriteCustomFoodIds.has(cf.id)
                                        ? 'text-yellow-500'
                                        : 'text-gray-300'
                                    }
                                  >
                                    ★
                                  </span>
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => addFood(item)}
                                className="flex-shrink-0 rounded-xl bg-slate-900 px-3 py-1.5 text-sm text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-0"
                              >
                                Add
                              </button>
                              <button
                                onClick={() => {
                                  setCustomFoodToRemove(cf);
                                  setShowRemoveCustomFoodModal(true);
                                }}
                                className="text-xs text-slate-500 transition-colors hover:text-rose-600 cursor-pointer bg-transparent border-0 p-0"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {customFoodsTotalPages > 1 && (
                    <div className="mt-3 flex justify-end items-center gap-2">
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.preventDefault();
                          setCustomFoodsPage(customFoodsPage - 1);
                          requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            });
                          });
                        }}
                        disabled={customFoodsPage === 1}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 text-blue-600 text-sm hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-slate-600">
                        Page {customFoodsPage} of {customFoodsTotalPages}
                      </span>
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.preventDefault();
                          setCustomFoodsPage(customFoodsPage + 1);
                          requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            });
                          });
                        }}
                        disabled={customFoodsPage >= customFoodsTotalPages}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 text-blue-600 text-sm hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Favorites Section */}
              {showFavoritesOnly && (
                <div
                  className="mt-4"
                  id="favorites-section"
                  key={`favorites-${cacheVersion}`}
                >
                  <h3 className="text-sm font-medium text-slate-700 mb-2">
                    Favorites
                  </h3>
                  <div className="space-y-2 overflow-hidden">
                    {favoriteFdcIds.size === 0 &&
                    favoriteCustomFoodIds.size === 0 ? (
                      <p className="text-sm text-slate-500">
                        No favorites yet. Star foods to add them here.
                      </p>
                    ) : (
                      <>
                        {paginatedFavorites.map((favorite) => {
                          if (favorite.type === 'custom') {
                            const customFoodId = favorite.id;
                            const customFood = customFoods.find(
                              (cf) => cf.id === customFoodId
                            );

                            if (customFood) {
                              const caloriesFromProtein =
                                customFood.protein * 4;
                              const remainingCalories = Math.max(
                                0,
                                customFood.calories - caloriesFromProtein
                              );
                              const derivedCarbs = remainingCalories / 4;
                              const basePerG = {
                                energy: customFood.calories / customFood.amount,
                                protein: customFood.protein / customFood.amount,
                                fat: 0,
                                carbs: derivedCarbs / customFood.amount,
                                micros: {
                                  fiber: customFood.fiber / customFood.amount,
                                } as Record<string, number>,
                              };
                              const item = {
                                id: `custom-${customFood.id}`,
                                name: customFood.name,
                                brand: customFood.brand || 'Custom',
                                serving: customFood.amount,
                                energy: customFood.calories,
                                protein: customFood.protein,
                                fat: 0,
                                carbs: derivedCarbs,
                                micros: { fiber: customFood.fiber },
                                _basePerG: basePerG,
                                customFoodId: customFood.id,
                              };
                              const VFF = ff(
                                customFood.calories,
                                customFood.fiber
                              );
                              const VPF = pf(
                                customFood.calories,
                                customFood.protein
                              );
                              const VWF = wf(VFF, VPF);
                              const VEF = ef(
                                customFood.calories,
                                customFood.amount
                              );

                              return (
                                <div
                                  key={`fav-custom-${customFood.id}`}
                                  className="flex items-center gap-3 rounded-xl border p-3"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium capitalize">
                                      {customFood.name}
                                    </div>
                                    <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-500 capitalize">
                                      {customFood.brand || 'Custom'}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-600">
                                      {customFood.amount} g →{' '}
                                      {round(customFood.calories, 0)} kcal • P{' '}
                                      {round(customFood.protein, 1)} • Fiber{' '}
                                      {round(customFood.fiber, 1)}
                                    </div>
                                    <div className="mt-1 flex items-center gap-1">
                                      <BadgeHalo
                                        label="FF"
                                        value={VFF}
                                        threshold={50}
                                        compact
                                      />
                                      <BadgeHalo
                                        label="PF"
                                        value={VPF}
                                        threshold={30}
                                        compact
                                      />
                                      <BadgeHalo
                                        label="WF"
                                        value={VWF}
                                        threshold={80}
                                        compact
                                      />
                                      <BadgeHalo
                                        label="EF"
                                        value={VEF}
                                        threshold={1}
                                        compact
                                      />
                                      <button
                                        onClick={async () => {
                                          try {
                                            await supabase
                                              .from('favorites')
                                              .delete()
                                              .eq('user_id', DEFAULT_USER_ID)
                                              .eq(
                                                'custom_food_id',
                                                customFoodId
                                              );
                                            setFavorites((prev) => {
                                              const next = new Set(prev);
                                              next.delete(
                                                customFood.name.toLowerCase()
                                              );
                                              return next;
                                            });
                                            setFavoriteCustomFoodIds((prev) => {
                                              const next = new Set(prev);
                                              next.delete(customFoodId);
                                              return next;
                                            });
                                          } catch (error) {
                                            console.error(
                                              'Error toggling favorite:',
                                              error
                                            );
                                          }
                                        }}
                                        className="text-lg transition-colors cursor-pointer bg-transparent border-0 p-0 text-yellow-500"
                                        title="Remove from favorites"
                                      >
                                        ★
                                      </button>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => addFood(item)}
                                    className="flex-shrink-0 rounded-xl bg-slate-900 px-3 py-1.5 text-sm text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-0"
                                  >
                                    Add
                                  </button>
                                </div>
                              );
                            }
                            return null;
                          }
                          if (favorite.type === 'fdc') {
                            const fdcId = favorite.id;
                            const favoriteFoodFromCache =
                              favoriteFoodCache.get(fdcId);
                            const favoriteFood =
                              favoriteFoodFromCache ||
                              results.find(
                                (r) => r?.fdcId === fdcId || r?.FdcId === fdcId
                              );

                            if (!favoriteFood) return null;

                            const n = safeParse(favoriteFood, 100);
                            const fiber = safeNum(n.micros?.fiber);
                            const VFF = ff(n.energy, fiber);
                            const VPF = pf(n.energy, n.protein);
                            const VWF = wf(VFF, VPF);
                            const VEF = ef(n.energy, 100);

                            return (
                              <div
                                key={`fav-fdc-${fdcId}`}
                                className="flex items-center gap-3 rounded-xl border p-3"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium capitalize">
                                    {(
                                      favoriteFood?.description ||
                                      favoriteFood?.lowercaseDescription ||
                                      ''
                                    ).toLowerCase()}
                                  </div>
                                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-500 capitalize">
                                    {tidyText(
                                      favoriteFood?.brandOwner ||
                                        favoriteFood?.brandName ||
                                        favoriteFood?.dataType ||
                                        ''
                                    )}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-600">
                                    100 g → {round(n.energy, 0)} kcal • P{' '}
                                    {round(n.protein, 1)} • Fiber{' '}
                                    {round(fiber, 1)}
                                  </div>
                                  <div className="mt-1 flex items-center gap-1">
                                    <BadgeHalo
                                      label="FF"
                                      value={VFF}
                                      threshold={50}
                                      compact
                                    />
                                    <BadgeHalo
                                      label="PF"
                                      value={VPF}
                                      threshold={30}
                                      compact
                                    />
                                    <BadgeHalo
                                      label="WF"
                                      value={VWF}
                                      threshold={80}
                                      compact
                                    />
                                    <BadgeHalo
                                      label="EF"
                                      value={VEF}
                                      threshold={1}
                                      compact
                                    />
                                    <button
                                      onClick={async () => {
                                        try {
                                          await supabase
                                            .from('favorites')
                                            .delete()
                                            .eq('user_id', DEFAULT_USER_ID)
                                            .eq('fdc_id', fdcId);
                                          const normalizedName = (
                                            favoriteFood?.description ||
                                            favoriteFood?.lowercaseDescription ||
                                            ''
                                          ).toLowerCase();
                                          setFavorites((prev) => {
                                            const next = new Set(prev);
                                            next.delete(normalizedName);
                                            return next;
                                          });
                                          setFavoriteFdcIds((prev) => {
                                            const next = new Set(prev);
                                            next.delete(fdcId);
                                            return next;
                                          });
                                        } catch (error) {
                                          console.error(
                                            'Error toggling favorite:',
                                            error
                                          );
                                        }
                                      }}
                                      className="text-lg transition-colors cursor-pointer bg-transparent border-0 p-0 text-yellow-500"
                                      title="Remove from favorites"
                                    >
                                      ★
                                    </button>
                                  </div>
                                </div>
                                <button
                                  onClick={() => addFood(favoriteFood)}
                                  className="flex-shrink-0 rounded-xl bg-slate-900 px-3 py-1.5 text-sm text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-0"
                                >
                                  Add
                                </button>
                              </div>
                            );
                          }
                          return null;
                        })}
                      </>
                    )}
                  </div>
                  {favoritesTotalPages > 1 && (
                    <div className="mt-3 flex justify-end items-center gap-2">
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.preventDefault();
                          setFavoritesPage(favoritesPage - 1);
                          requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            });
                          });
                        }}
                        disabled={favoritesPage === 1}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 text-blue-600 text-sm hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-slate-600">
                        Page {favoritesPage} of {favoritesTotalPages}
                      </span>
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.preventDefault();
                          setFavoritesPage(favoritesPage + 1);
                          requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            });
                          });
                        }}
                        disabled={favoritesPage >= favoritesTotalPages}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 text-blue-600 text-sm hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Search Results Section */}
              {showResults && paginatedResults.length > 0 && (
                <div className="mt-4" id="search-results-section">
                  <h3 className="text-sm font-medium text-slate-700 mb-2">
                    {isDemoMode ? 'Demo Foods' : 'Search Results'}
                  </h3>
                  <div
                    className="space-y-2 overflow-hidden"
                    style={{ minHeight: '400px' }}
                  >
                    {paginatedResults.map((f, idx) => {
                      const n = safeParse(f, 100);
                      const foodName = tidyText(
                        f?.description || f?.lowercaseDescription || 'Food'
                      );
                      const normalizedName = foodName.toLowerCase();
                      const fdcId = f?.fdcId || f?.FdcId || null;
                      const isFavorite = fdcId
                        ? favoriteFdcIds.has(fdcId)
                        : false;

                      const fiber = safeNum(n.micros?.fiber);
                      const VFF = ff(n.energy, fiber);
                      const VPF = pf(n.energy, n.protein);
                      const VWF = wf(VFF, VPF);
                      const VEF = ef(n.energy, 100);

                      const toggleFavorite = async () => {
                        try {
                          if (!fdcId) {
                            console.error(
                              'Cannot favorite item without fdc_id'
                            );
                            return;
                          }
                          if (isFavorite) {
                            await supabase
                              .from('favorites')
                              .delete()
                              .eq('user_id', DEFAULT_USER_ID)
                              .eq('fdc_id', fdcId);
                            setFavorites((prev) => {
                              const next = new Set(prev);
                              next.delete(normalizedName);
                              return next;
                            });
                            setFavoriteFdcIds((prev) => {
                              const next = new Set(prev);
                              next.delete(fdcId);
                              return next;
                            });
                          } else {
                            console.log('Saving favorite:', {
                              normalizedName,
                              fdcId,
                              food: f,
                            });
                            await supabase.from('favorites').insert({
                              user_id: DEFAULT_USER_ID,
                              food_name: normalizedName,
                              fdc_id: fdcId,
                            });
                            setFavorites(
                              (prev) => new Set([...prev, normalizedName])
                            );
                            setFavoriteFdcIds(
                              (prev) => new Set([...prev, fdcId])
                            );
                            setFavoriteFoodCache((prev) => {
                              const newMap = new Map(prev);
                              newMap.set(fdcId, f);
                              return newMap;
                            });
                          }
                        } catch (error) {
                          console.error('Error toggling favorite:', error);
                        }
                      };

                      return (
                        <div
                          key={String(f?.fdcId ?? idx)}
                          className="flex items-center gap-3 rounded-xl border p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium capitalize">
                              {foodName}
                            </div>
                            <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-slate-500 capitalize">
                              {tidyText(
                                f?.brandOwner ||
                                  f?.brandName ||
                                  f?.dataType ||
                                  ''
                              )}
                            </div>
                            <div className="mt-1 text-xs text-slate-600">
                              100 g → {round(n.energy, 0)} kcal • P{' '}
                              {round(n.protein, 1)} • Fiber {round(fiber, 1)}
                            </div>
                            <div className="mt-1 flex items-center gap-1">
                              <BadgeHalo
                                label="FF"
                                value={VFF}
                                threshold={50}
                                compact
                              />
                              <BadgeHalo
                                label="PF"
                                value={VPF}
                                threshold={30}
                                compact
                              />
                              <BadgeHalo
                                label="WF"
                                value={VWF}
                                threshold={80}
                                compact
                              />
                              <BadgeHalo
                                label="EF"
                                value={VEF}
                                threshold={1}
                                compact
                              />
                              <button
                                onClick={toggleFavorite}
                                className="text-lg transition-colors cursor-pointer bg-transparent border-0 p-0"
                                title={
                                  isFavorite
                                    ? 'Remove from favorites'
                                    : 'Add to favorites'
                                }
                              >
                                <span
                                  className={
                                    isFavorite
                                      ? 'text-yellow-500'
                                      : 'text-gray-300'
                                  }
                                >
                                  ★
                                </span>
                              </button>
                            </div>
                          </div>
                          <button
                            onClick={() => addFood(f)}
                            className="flex-shrink-0 rounded-xl bg-slate-900 px-3 py-1.5 text-sm text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-0"
                          >
                            Add
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {searchResultsPages > 1 && (
                    <div className="mt-3 flex justify-end items-center gap-2">
                      <button
                        onClick={async (e) => {
                          e.preventDefault();
                          await searchFoods(currentPage - 1);
                          const foodSearchElement =
                            document.getElementById('food-search');
                          if (foodSearchElement) {
                            foodSearchElement.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            });
                          }
                        }}
                        disabled={currentPage === 1 || isSearching}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 text-blue-600 text-sm hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-slate-600">
                        Page {currentPage} of {searchResultsPages}
                      </span>
                      <button
                        onClick={async (e) => {
                          e.preventDefault();
                          await searchFoods(currentPage + 1);
                          const foodSearchElement =
                            document.getElementById('food-search');
                          if (foodSearchElement) {
                            foodSearchElement.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            });
                          }
                        }}
                        disabled={
                          currentPage >= searchResultsPages || isSearching
                        }
                        className="px-3 py-1.5 rounded-lg bg-slate-100 text-blue-600 text-sm hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Food Log */}
            <section className="rounded-2xl border bg-white p-4 shadow-sm mt-6 w-full min-w-0">
              <h2 className="mb-1 text-lg font-medium">Food Log</h2>
              <div className="mb-2 text-[12px] uppercase tracking-wide text-slate-500">
                Aggregate
              </div>

              <div className="mb-2 grid grid-cols-4 gap-2 text-[13px]">
                <Stat
                  label="Amount"
                  value={`${round(totals.mass, 1)}`}
                  tooltip="(g)"
                />
                <Stat
                  label="Calories"
                  value={`${round(totals.cal, 0)}`}
                  tooltip="(kcal)"
                  valueColor={
                    selectedEnergy &&
                    ((selectedEnergy === 'bmr' && totals.cal > bmr) ||
                      (selectedEnergy === 'tdee' && totals.cal > tdee) ||
                      (selectedEnergy === 'target' &&
                        totals.cal > targetCalories))
                      ? 'text-red-600'
                      : ''
                  }
                  secondaryLine={
                    selectedEnergy ? (
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {selectedEnergy === 'bmr' && `/ ${round(bmr, 0)}`}
                        {selectedEnergy === 'tdee' && `/ ${round(tdee, 0)}`}
                        {selectedEnergy === 'target' &&
                          `/ ${round(targetCalories, 0)}`}
                      </div>
                    ) : undefined
                  }
                />
                <Stat
                  label="Fiber"
                  value={`${round(totals.fiber, 1)}`}
                  tooltip="(g)"
                />
                <Stat
                  label="Protein"
                  value={`${round(totals.protein, 1)}`}
                  tooltip="(g)"
                />
              </div>

              <div
                className={`mb-0 grid grid-cols-4 gap-2 text-[11px] rounded-xl p-2 ${
                  TWF < 80 ? 'bg-emerald-100' : 'bg-rose-100'
                }`}
              >
                <BadgeHalo
                  label="FF (Fiber Factor)"
                  value={TFF}
                  threshold={50}
                />
                <BadgeHalo
                  label="PF (Protein Factor)"
                  value={TPF}
                  threshold={30}
                />
                <BadgeHalo
                  label="WF (Wellness Factor)"
                  value={TWF}
                  threshold={80}
                />
                <BadgeHalo
                  label="EF (Energy Factor)"
                  value={TEF}
                  threshold={1}
                />
              </div>

              <h3
                id="foods-anchor"
                className="mt-4 text-[12px] uppercase tracking-wide text-slate-500"
              >
                Foods
              </h3>
              <div className="grid gap-2 grid-cols-1 mt-2">
                {log.map((x) => (
                  <FoodCard
                    key={x.id}
                    item={x}
                    setLog={setLog}
                    setFavorites={setFavorites}
                    favoriteFdcIds={favoriteFdcIds}
                    setFavoriteFdcIds={setFavoriteFdcIds}
                    favoriteCustomFoodIds={favoriteCustomFoodIds}
                    setFavoriteCustomFoodIds={setFavoriteCustomFoodIds}
                    setFavoriteFoodCache={setFavoriteFoodCache}
                  />
                ))}
              </div>
              {log.length === 0 && (
                <p className="text-sm text-slate-500">
                  Nothing logged yet. Add foods from the search options above.
                </p>
              )}
              {log.length > 0 && (
                <div className="mt-2 text-right">
                  <button
                    onClick={() => setLog([])}
                    className="text-xs text-blue-600 hover:text-blue-700 cursor-pointer bg-transparent border-0 p-0"
                  >
                    Clear log
                  </button>
                </div>
              )}
            </section>

            {/* Export */}
            <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm w-full min-w-0">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-lg font-medium">Export</h2>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showCsv}
                    onChange={(e) => setShowCsv(e.target.checked)}
                  />
                  Always show preview
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={downloadCSV}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 focus:outline-none focus:ring-0"
                >
                  Download CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const rows = buildCsvRows();
                    const ok = downloadExcelXlsx(rows);
                    if (!ok) {
                      const csv = getCurrentCSV();
                      triggerCSVDownload(csv, 'wellness_results.csv');
                    }
                  }}
                  className="rounded-xl bg-slate-900 px-3 py-2 text-white hover:bg-slate-800 focus:outline-none focus:ring-0"
                >
                  Download Excel (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const csv = getCurrentCSV();
                    setCsvPreview(csv);
                    copyCSVToClipboard(csv);
                  }}
                  className="rounded-xl bg-slate-900 px-3 py-2 text-white hover:bg-slate-800 focus:outline-none focus:ring-0"
                >
                  Copy CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const csv = getCurrentCSV();
                    setCsvPreview(csv);
                    openCSVInNewTab(csv);
                  }}
                  className="rounded-xl bg-slate-900 px-3 py-2 text-white hover:bg-slate-800 focus:outline-none focus:ring-0"
                >
                  Open in new tab
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ta = document.getElementById(
                      'csv-ta'
                    ) as HTMLTextAreaElement | null;
                    if (ta) {
                      ta.focus();
                      ta.select();
                    }
                  }}
                  className="rounded-xl bg-slate-900 px-3 py-2 text-white hover:bg-slate-800 focus:outline-none focus:ring-0"
                >
                  Select all
                </button>
              </div>
              {showCsv && (
                <div className="mt-3">
                  <p className="mb-1 text-xs text-slate-500">
                    Preview (read‑only; safe for incognito):
                  </p>
                  <textarea
                    id="csv-ta"
                    readOnly
                    value={csvPreview}
                    rows={14}
                    wrap="off"
                    className="min-h-48 w-full resize-y rounded-xl border bg-slate-50 p-3 font-mono text-[11px] overflow-auto"
                  ></textarea>
                </div>
              )}
            </section>
          </div>
        </div>

        {showRemoveCustomFoodModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setShowRemoveCustomFoodModal(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-4 text-xl font-semibold">Remove Custom Food</h2>
              <p className="mb-6 text-sm text-slate-600">
                All instances of this custom food will be removed from your Food
                Log. Are you sure you want to do this?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowRemoveCustomFoodModal(false)}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm text-slate-900 hover:bg-slate-300 focus:outline-none focus:ring-0"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!customFoodToRemove) return;
                    try {
                      await supabase
                        .from('custom_foods')
                        .delete()
                        .eq('id', customFoodToRemove.id)
                        .eq('user_id', DEFAULT_USER_ID);

                      await supabase
                        .from('food_log')
                        .delete()
                        .eq('user_id', DEFAULT_USER_ID)
                        .ilike('name', customFoodToRemove.name);

                      await supabase
                        .from('favorites')
                        .delete()
                        .eq('user_id', DEFAULT_USER_ID)
                        .eq('food_name', customFoodToRemove.name.toLowerCase());

                      setCustomFoods((prev) =>
                        prev.filter((food) => food.id !== customFoodToRemove.id)
                      );
                      setLog((prev) =>
                        prev.filter(
                          (item) =>
                            item.name.toLowerCase() !==
                            customFoodToRemove.name.toLowerCase()
                        )
                      );
                      setFavorites((prev) => {
                        const next = new Set(prev);
                        next.delete(customFoodToRemove.name.toLowerCase());
                        return next;
                      });
                      setShowRemoveCustomFoodModal(false);
                      setCustomFoodToRemove(null);
                    } catch (error) {
                      console.error('Error deleting custom food:', error);
                    }
                  }}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 focus:outline-none focus:ring-0"
                >
                  Yes
                </button>
              </div>
            </div>
          </div>
        )}

        {showCustomFoodModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={handleCustomFoodCancel}
          >
            <div
              className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-4 text-xl font-semibold">Add Custom Food</h2>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="customFoodName"
                      className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                    >
                      Food Name
                    </label>
                    <input
                      id="customFoodName"
                      type="text"
                      value={customFoodName}
                      onChange={(e) => {
                        setCustomFoodName(e.target.value);
                        if (validationErrors.customFoodName) {
                          setValidationError('customFoodName', '');
                        }
                      }}
                      className={`w-full rounded-xl border ${
                        validationErrors.customFoodName
                          ? 'border-rose-500'
                          : 'border-slate-400'
                      } focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm`}
                      placeholder="e.g., Homemade Smoothie"
                    />
                    {validationErrors.customFoodName && (
                      <p className="mt-1 text-xs text-rose-600">
                        {validationErrors.customFoodName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="customFoodBrand"
                      className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                    >
                      Brand
                    </label>
                    <input
                      id="customFoodBrand"
                      type="text"
                      value={customFoodBrand}
                      onChange={(e) => setCustomFoodBrand(e.target.value)}
                      className="w-full rounded-xl border border-slate-400 focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm"
                      placeholder="e.g., Homemade"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="customFoodAmount"
                      className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                    >
                      Amount (g)
                    </label>
                    <input
                      id="customFoodAmount"
                      type="number"
                      value={customFoodAmount}
                      onChange={(e) => {
                        setCustomFoodAmount(e.target.value);
                        if (validationErrors.customFoodAmount) {
                          setValidationError('customFoodAmount', '');
                        }
                      }}
                      className={`w-full rounded-xl border ${
                        validationErrors.customFoodAmount
                          ? 'border-rose-500'
                          : 'border-slate-400'
                      } focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm`}
                      placeholder="100"
                    />
                    {validationErrors.customFoodAmount && (
                      <p className="mt-1 text-xs text-rose-600">
                        {validationErrors.customFoodAmount}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="customFoodCalories"
                      className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                    >
                      Calories (kcal)
                    </label>
                    <input
                      id="customFoodCalories"
                      type="number"
                      value={customFoodCalories}
                      onChange={(e) => {
                        setCustomFoodCalories(e.target.value);
                        if (validationErrors.customFoodCalories) {
                          setValidationError('customFoodCalories', '');
                        }
                      }}
                      className={`w-full rounded-xl border ${
                        validationErrors.customFoodCalories
                          ? 'border-rose-500'
                          : 'border-slate-400'
                      } focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm`}
                      placeholder="0"
                    />
                    {validationErrors.customFoodCalories && (
                      <p className="mt-1 text-xs text-rose-600">
                        {validationErrors.customFoodCalories}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="customFoodFiber"
                      className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                    >
                      Fiber (g)
                    </label>
                    <input
                      id="customFoodFiber"
                      type="number"
                      value={customFoodFiber}
                      onChange={(e) => {
                        setCustomFoodFiber(e.target.value);
                        if (validationErrors.customFoodFiber) {
                          setValidationError('customFoodFiber', '');
                        }
                      }}
                      className={`w-full rounded-xl border ${
                        validationErrors.customFoodFiber
                          ? 'border-rose-500'
                          : 'border-slate-400'
                      } focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm`}
                      placeholder="0"
                    />
                    {validationErrors.customFoodFiber && (
                      <p className="mt-1 text-xs text-rose-600">
                        {validationErrors.customFoodFiber}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="customFoodProtein"
                      className="mb-1 block text-xs uppercase tracking-wide text-slate-500"
                    >
                      Protein (g)
                    </label>
                    <input
                      id="customFoodProtein"
                      type="number"
                      value={customFoodProtein}
                      onChange={(e) => {
                        setCustomFoodProtein(e.target.value);
                        if (validationErrors.customFoodProtein) {
                          setValidationError('customFoodProtein', '');
                        }
                      }}
                      className={`w-full rounded-xl border ${
                        validationErrors.customFoodProtein
                          ? 'border-rose-500'
                          : 'border-slate-400'
                      } focus:border-slate-500 focus:ring-0 px-3 py-2 text-sm shadow-sm`}
                      placeholder="0"
                    />
                    {validationErrors.customFoodProtein && (
                      <p className="mt-1 text-xs text-rose-600">
                        {validationErrors.customFoodProtein}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-xl border p-3 bg-slate-50">
                  <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                    Wellness Metrics Preview
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {(() => {
                      const amt = safeNum(customFoodAmount, 100);
                      const cal = safeNum(customFoodCalories, 0);
                      const fib = safeNum(customFoodFiber, 0);
                      const prot = safeNum(customFoodProtein, 0);
                      const VFF = ff(cal, fib);
                      const VPF = pf(cal, prot);
                      const VWF = wf(VFF, VPF);
                      const VEF = ef(cal, amt);
                      return (
                        <>
                          <BadgeHalo
                            label="FF"
                            value={VFF}
                            threshold={50}
                            compact
                          />
                          <BadgeHalo
                            label="PF"
                            value={VPF}
                            threshold={30}
                            compact
                          />
                          <BadgeHalo
                            label="WF"
                            value={VWF}
                            threshold={80}
                            compact
                          />
                          <BadgeHalo
                            label="EF"
                            value={VEF}
                            threshold={1}
                            compact
                          />
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={handleCustomFoodCancel}
                  className="rounded-xl bg-slate-200 px-4 py-2 text-sm text-slate-900 hover:bg-slate-300 focus:outline-none focus:ring-0"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCustomFoodSubmit}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 focus:outline-none focus:ring-0"
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <footer className="text-center py-4">
        <p className="text-gray-500 text-xs">© Ross Andrus, 2025</p>
      </footer>
    </div>
  );
}
