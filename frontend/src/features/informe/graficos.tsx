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
import { mesLargo, pctTxt } from './formato';

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
