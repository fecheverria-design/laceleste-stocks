import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { fmt, mesLargo, pctTxt } from './formato';

// ─────────────────────────────────────────────────────────────────────────────
// Los gráficos del informe, con las mismas opciones que el HTML de J: Chart.js,
// misma paleta, mismos ejes en gris y misma grilla. No es casualidad que se parezcan:
// están portados uno a uno.
// ─────────────────────────────────────────────────────────────────────────────

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
);

const TINTA = '#8fa0ab';
const TINTA_EJE = '#5a6b78';
const GRILLA = '#eef4f7';
const CELESTE = '#0aa6c4';
const ROJO = '#d94a4a';
const NARANJA = '#e8823f';

/** Paleta de series múltiples (la `PAL` del script). */
const PALETA = [
  '#0aa6c4',
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#3b82f6',
  '#84cc16',
  '#6366f1',
  '#eab308',
];

const ejeY = (formato: (v: number) => string) => ({
  ticks: { color: TINTA, callback: (v: string | number) => formato(Number(v)) },
  grid: { color: GRILLA },
});

const ejeX = { ticks: { color: TINTA }, grid: { display: false } };

const leyenda = (size = 11) => ({
  labels: { color: TINTA_EJE, font: { size }, usePointStyle: true, pointStyle: 'line' as const, boxWidth: 18 },
});

// ── Variación de precio de compra (barras horizontales) ──────────────────────
// Rojo = subió más que la inflación de la ventana; celeste = por debajo. Sin inflación
// cargada va todo celeste (no se puede juzgar contra nada).
export function BarrasVariacion({
  items,
  inflacion,
  ventana,
}: {
  items: Array<{ producto: string; valor: number }>;
  inflacion: number | null;
  ventana: string;
}) {
  const data: ChartData<'bar'> = {
    labels: items.map((i) => (i.producto.length > 26 ? `${i.producto.slice(0, 25)}…` : i.producto)),
    datasets: [
      {
        label: `Var. ${ventana}m`,
        data: items.map((i) => i.valor * 100),
        backgroundColor: items.map((i) => (inflacion !== null && i.valor > inflacion ? ROJO : CELESTE)),
        borderRadius: 3,
      },
    ],
  };

  const options: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (c) =>
            `${pctTxt(c.parsed.x === null ? null : c.parsed.x / 100)}${inflacion !== null ? `  (infl ${pctTxt(inflacion)})` : ''}`,
        },
      },
    },
    scales: {
      x: ejeY((v) => `${v}%`),
      y: { ticks: { color: TINTA_EJE, font: { size: 10 } }, grid: { display: false } },
    },
  };

  return <Chart type="bar" data={data} options={options} />;
}

// ── Evolución de precios (líneas, 12 meses) ──────────────────────────────────
// La leyenda es clickeable (viene de Chart.js) y los huecos se unen con spanGaps,
// igual que en el informe: un mes sin cotización no corta la línea.
export function LineasPrecios({
  meses,
  series,
}: {
  meses: string[];
  series: Array<{ nombre: string; serie: Array<number | null> }>;
}) {
  const data: ChartData<'line'> = {
    labels: meses.map(mesLargo),
    datasets: series.map((s, i) => {
      const color = PALETA[i % PALETA.length]!;
      return {
        label: s.nombre,
        data: s.serie,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 2,
        spanGaps: true,
      };
    }),
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: leyenda(10),
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y === null ? '—' : fmt(c.parsed.y)}` } },
    },
    scales: { y: ejeY((v) => `$${v.toLocaleString('es-AR')}`), x: ejeX },
  };

  return <Chart type="line" data={data} options={options} />;
}

// ── Canasta A vs inflación ───────────────────────────────────────────────────
// En "Mensual" la canasta va en barras y la inflación en línea; en "Acumulado" son dos
// líneas y la inflación va punteada. Exactamente como el `chCanasta` del script.
export function GraficoCanasta({
  meses,
  canasta,
  inflacion,
  mensual,
  etiqueta,
}: {
  meses: string[];
  canasta: Array<number | null>;
  inflacion: Array<number | null>;
  mensual: boolean;
  etiqueta: string;
}) {
  const data: ChartData<'bar' | 'line'> = {
    labels: meses.map(mesLargo),
    datasets: [
      {
        type: mensual ? ('bar' as const) : ('line' as const),
        label: `Canasta A (${etiqueta})${mensual ? ' — var. mes' : ''}`,
        data: canasta.map((v) => (v === null ? null : v * 100)),
        borderColor: CELESTE,
        backgroundColor: mensual ? '#7fd3e2' : CELESTE,
        borderWidth: mensual ? 0 : 2.5,
        borderRadius: mensual ? 3 : 0,
        tension: 0.3,
        pointRadius: 2,
        spanGaps: true,
      },
      {
        type: 'line' as const,
        label: `Inflación oficial${mensual ? ' — mensual' : ''}`,
        data: inflacion.map((v) => (v === null ? null : v * 100)),
        borderColor: NARANJA,
        backgroundColor: NARANJA,
        borderWidth: 2,
        borderDash: mensual ? [] : [6, 4],
        tension: 0.3,
        pointRadius: 2,
        spanGaps: true,
      },
    ],
  };

  const options: ChartOptions<'bar' | 'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: leyenda(),
      tooltip: {
        callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y === null ? '—' : pctTxt(c.parsed.y / 100)}` },
      },
    },
    scales: { y: ejeY((v) => `${v}%`), x: ejeX },
  };

  return <Chart type={mensual ? 'bar' : 'line'} data={data} options={options} />;
}
