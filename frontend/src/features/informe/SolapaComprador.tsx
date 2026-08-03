import type { Comprador, InformeCompradores } from '../../shared/api/types';
import { claseVar, fMjs, mesLargo, pctTxt } from './formato';

// ─────────────────────────────────────────────────────────────────────────────
// Solapa "Por Comprador": una tarjeta por comprador con su gasto del mes, y adentro las
// barras de gasto por proveedor y por producto. El % de cada barra es la variación de
// PRECIO ponderada por gasto — no la del gasto, que es otra cosa.
// ─────────────────────────────────────────────────────────────────────────────

const ROLES: Record<Comprador, string> = {
  Lautaro: 'Materias Primas',
  Fausto: 'Packaging · Limpieza · Merch · Descartables',
};

const TOP = 12;

export function SolapaComprador({
  mes,
  informes,
}: {
  mes: string;
  informes: Partial<Record<Comprador, InformeCompradores>>;
}) {
  return (
    <div className="section">
      <div className="section-title">Gasto por comprador — {mesLargo(mes)}</div>
      <div className="note">
        <strong>Gasto real por proveedor y por producto</strong> (con IVA, la columna «Valor total» de 3c).
        Atribuido por familia: <strong>Lautaro</strong> = Materias Primas · <strong>Fausto</strong> = Packaging,
        Limpieza, Merchandising, Descartables. El % es la <strong>variación de precio</strong> ponderada por gasto
        (por proveedor) o la del mes (por producto).
      </div>
      <div className="buyer-grid">
        {(['Lautaro', 'Fausto'] as const).map((nombre) => {
          const inf = informes[nombre];
          return inf ? <TarjetaComprador key={nombre} nombre={nombre} informe={inf} /> : null;
        })}
      </div>
    </div>
  );
}

function TarjetaComprador({ nombre, informe }: { nombre: Comprador; informe: InformeCompradores }) {
  const { resumen, proveedores, productos } = informe;

  const gastoA = productos.filter((p) => p.clasificacion_abc === 'A').reduce((a, p) => a + p.gasto, 0);

  // Variación de precio promedio del comprador, ponderada por lo que gastó en cada producto.
  const conVar = productos.filter((p) => p.var_precio !== null && p.gasto > 0);
  const peso = conVar.reduce((a, p) => a + p.gasto, 0);
  const varProm = peso > 0 ? conVar.reduce((a, p) => a + p.var_precio! * p.gasto, 0) / peso : null;

  const topProv = proveedores.filter((p) => p.gasto > 0).slice(0, TOP);
  const topProd = productos.filter((p) => p.gasto > 0).slice(0, TOP);
  const maxProv = Math.max(1, ...topProv.map((p) => p.gasto));
  const maxProd = Math.max(1, ...topProd.map((p) => p.gasto));

  return (
    <div className="buyer-card">
      <div className="bname">{nombre}</div>
      <div className="brole">{ROLES[nombre]}</div>

      <div className="gbox">
        <span className="gl">Gasto del mes</span>
        <span className="gv">{fMjs(resumen.gasto)}</span>
      </div>

      <div className="gbox-sub">
        <span className="gl2">Solo productos A</span>
        <span className="gv2">
          {fMjs(gastoA)}
          {resumen.gasto > 0 && ` · ${Math.round((gastoA / resumen.gasto) * 100)}%`}
        </span>
      </div>

      <div className="bstats">
        <div className="bstat">
          <div className="v">{resumen.productos}</div>
          <div className="l">Productos</div>
        </div>
        <div className="bstat">
          <div className="v">{resumen.proveedores}</div>
          <div className="l">Proveedores</div>
        </div>
        <div className="bstat">
          <div className={`v ${claseVar(varProm)}`}>{pctTxt(varProm)}</div>
          <div className="l">Var. prom</div>
        </div>
      </div>

      <div className="subh">Gasto por proveedor — compras reales del mes</div>
      {topProv.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sin compras registradas este mes</div>
      )}
      {topProv.map((p) => (
        <Barra
          key={`${p.proveedor_id ?? 's'}-${p.nombre}`}
          etiqueta={p.nombre}
          valor={p.gasto}
          ancho={(p.gasto / maxProv) * 100}
          variacion={p.var_precio}
          titulo="Variación de precio ponderada por gasto de los productos comprados a este proveedor"
        />
      ))}

      {topProd.length > 0 && (
        <>
          <div className="subh" style={{ marginTop: 18 }}>
            Gasto por producto — top del mes
          </div>
          {topProd.map((p) => (
            <Barra
              key={p.producto_3c}
              etiqueta={p.nombre}
              sufijo={p.clasificacion_abc === 'A' ? undefined : ' (no A)'}
              valor={p.gasto}
              ancho={(p.gasto / maxProd) * 100}
              variacion={p.var_precio}
              verde
              titulo="Variación del precio de compra del mes"
            />
          ))}
        </>
      )}
    </div>
  );
}

function Barra({
  etiqueta,
  sufijo,
  valor,
  ancho,
  variacion,
  verde = false,
  titulo,
}: {
  etiqueta: string;
  sufijo?: string;
  valor: number;
  ancho: number;
  variacion: number | null;
  verde?: boolean;
  titulo?: string;
}) {
  return (
    <div className="bar-row">
      <div className="bar-label" title={etiqueta}>
        {etiqueta}
        {sufijo && <span style={{ color: 'var(--muted)', fontSize: 9 }}>{sufijo}</span>}
      </div>
      <div className="bar-track">
        <div
          className="bar-fill"
          style={{
            width: `${Math.max(3, ancho)}%`,
            background: verde ? 'linear-gradient(90deg,#8fd6a0,#4fb06a)' : undefined,
          }}
        />
      </div>
      <div className="bar-val">{fMjs(valor)}</div>
      <div className={`bar-var ${claseVar(variacion)}`} title={titulo}>
        {pctTxt(variacion)}
      </div>
    </div>
  );
}
