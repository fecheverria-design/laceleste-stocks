import { cruceAppContra3c, ventanaEspejo, type FilaCruce } from '../repositories/desempeno.repository.js';

// ─────────────────────────────────────────────────────────────────────────────
// Desempeño del depósito. Dos números, no uno (y el orden importa):
//
//   COBERTURA  = de lo que 3c registró, ¿qué parte pasó también por la app?
//   FIDELIDAD  = de lo que pasó por las dos, ¿qué parte coincide en cantidad?
//
// Están separados porque miden cosas distintas y un solo % los mezclaría en algo que no
// significa nada. La cobertura habla del circuito (hay áreas que no usan la app del
// compañero en absoluto); la fidelidad, de la cantidad cargada.
//
// La FIDELIDAD se puede medir contra dos cosas, y son preguntas distintas (`Base`):
//   SUGERIDO → ¿despachó lo que había que despachar? (lo que la app dijo que había que
//              abastecer contra lo que 3c dice que salió). Es la pregunta operativa.
//   REAL     → ¿lo que la app registró coincide con lo que se cargó en 3c? Es la pregunta
//              de calidad del dato: mide el registro, no el despacho.
//
// ⚠ Lo que este cruce NO es: un puntaje de la persona. Medido en agosto, la cobertura de
// registro en 3c es excelente y lo que falta está casi siempre del lado de la app.
// ─────────────────────────────────────────────────────────────────────────────

// Las cantidades son numeric(12,3) / numeric(14,4): por debajo de esto es ruido de redondeo.
const EPSILON = 0.001;

/** Contra qué se compara lo que 3c registró. */
export type Base = 'SUGERIDO' | 'REAL';

export type Clasificacion = 'EXACTO' | 'DENTRO_BULTO' | 'DIFIERE' | 'SOLO_3C' | 'SOLO_APP' | 'SIN_SUGERIDO';

export interface ItemDesempeno {
  area_dep_3c: number;
  area_nombre: string;
  producto_3c: string;
  producto_nombre: string;
  unidad_base: string | null;
  unidades_por_bulto: number | null;
  /** Lo que la app dijo que había que abastecer (0 si no lo capturó). */
  cantidad_sugerida: number;
  /** Lo que la app dice que se despachó realmente. */
  cantidad_app: number;
  cantidad_3c: number;
  /** La punta de la app con la que se comparó, según la base elegida. */
  cantidad_comparada: number;
  diferencia: number; // comparada − 3c (positivo = la app dice más que 3c)
  diferencia_bultos: number | null; // la misma diferencia medida en bultos
  renglones_app: number;
  renglones_3c: number;
  renglones_sin_sugerido: number;
  clasificacion: Clasificacion;
}

export interface ResumenDesempeno {
  combinaciones: number; // (área, producto) que aparecen en alguna de las dos puntas
  en_3c: number; // las que 3c registró
  registradas: number; // de esas, las que la app también registró
  cobertura_pct: number | null; // registradas / en_3c (null si 3c no tiene nada)
  exactos: number;
  dentro_bulto: number;
  difieren: number;
  /** Registradas que no se pueden juzgar: la app las tiene pero sin sugerido. */
  sin_sugerido: number;
  comparables: number; // exactos + dentro_bulto + difieren
  fidelidad_pct: number | null; // (exactos + dentro_bulto) / comparables
  solo_3c: number;
  solo_app: number;
}

export interface AreaDesempeno extends ResumenDesempeno {
  area_dep_3c: number;
  area_nombre: string;
}

export interface Desempeno {
  desde: string;
  hasta: string;
  /** Contra qué punta de la app se comparó 3c. */
  base: Base;
  espejo: { desde: string; hasta: string; renglones: number } | null;
  // El período pedido se sale de lo que cubre el espejo → lo que "falta" ahí no es que no
  // se haya cargado en 3c, es que el export todavía no se importó.
  aviso: string | null;
  total: ResumenDesempeno;
  areas: AreaDesempeno[];
  items: ItemDesempeno[];
}

// Clasifica un (área, producto). La tolerancia de bulto es regla de J: si la diferencia
// entra en un bulto entero, cuenta como bien abastecido — nadie despacha huevos sueltos.
//
// La COBERTURA se mide siempre contra `cantidadApp` (¿la app registró este despacho?), aunque
// la fidelidad se juzgue contra el sugerido: que un renglón no tenga sugerido no significa que
// no haya pasado por la app. Por eso SIN_SUGERIDO es una categoría propia y no un "solo 3c".
export function clasificar(
  cantidades: { app: number; sugerida: number; tresC: number },
  unidadesPorBulto: number | null,
  base: Base,
): Clasificacion {
  const hayApp = cantidades.app > EPSILON;
  const hay3c = cantidades.tresC > EPSILON;
  if (!hayApp && hay3c) return 'SOLO_3C';
  if (hayApp && !hay3c) return 'SOLO_APP';
  if (base === 'SUGERIDO' && cantidades.sugerida <= EPSILON) return 'SIN_SUGERIDO';
  const comparada = base === 'SUGERIDO' ? cantidades.sugerida : cantidades.app;
  const dif = Math.abs(comparada - cantidades.tresC);
  if (dif <= EPSILON) return 'EXACTO';
  if (unidadesPorBulto !== null && unidadesPorBulto > 1 && dif <= unidadesPorBulto) return 'DENTRO_BULTO';
  return 'DIFIERE';
}

function resumenVacio(): ResumenDesempeno {
  return {
    combinaciones: 0,
    en_3c: 0,
    registradas: 0,
    cobertura_pct: null,
    exactos: 0,
    dentro_bulto: 0,
    difieren: 0,
    sin_sugerido: 0,
    comparables: 0,
    fidelidad_pct: null,
    solo_3c: 0,
    solo_app: 0,
  };
}

function acumular(r: ResumenDesempeno, item: ItemDesempeno): void {
  r.combinaciones++;
  if (item.clasificacion !== 'SOLO_APP') r.en_3c++;
  if (item.clasificacion === 'SOLO_3C') r.solo_3c++;
  if (item.clasificacion === 'SOLO_APP') r.solo_app++;
  if (item.clasificacion === 'EXACTO') r.exactos++;
  if (item.clasificacion === 'DENTRO_BULTO') r.dentro_bulto++;
  if (item.clasificacion === 'DIFIERE') r.difieren++;
  if (item.clasificacion === 'SIN_SUGERIDO') r.sin_sugerido++;
}

function redondear(n: number): number {
  return Math.round(n * 10) / 10;
}

function cerrar<T extends ResumenDesempeno>(r: T): T {
  r.comparables = r.exactos + r.dentro_bulto + r.difieren;
  // Registradas = pasó por las dos puntas, aunque no se pueda juzgar la cantidad.
  r.registradas = r.comparables + r.sin_sugerido;
  r.cobertura_pct = r.en_3c === 0 ? null : redondear((r.registradas / r.en_3c) * 100);
  r.fidelidad_pct = r.comparables === 0 ? null : redondear(((r.exactos + r.dentro_bulto) / r.comparables) * 100);
  return r;
}

// Arma los items desde las filas crudas. Pura: sin DB, se testea sola.
export function armarItems(filas: FilaCruce[], base: Base): ItemDesempeno[] {
  return filas.map((f) => {
    const cantidadApp = Number(f.cantidad_app);
    const cantidadSugerida = Number(f.cantidad_sugerida);
    const cantidad3c = Number(f.cantidad_3c);
    const bulto = f.unidades_por_bulto === null ? null : Number(f.unidades_por_bulto);
    const clasificacion = clasificar(
      { app: cantidadApp, sugerida: cantidadSugerida, tresC: cantidad3c },
      bulto,
      base,
    );
    // Contra el sugerido, una combinación sin sugerido no tiene diferencia que mostrar.
    const comparada = base === 'SUGERIDO' ? cantidadSugerida : cantidadApp;
    const diferencia = comparada - cantidad3c;
    return {
      area_dep_3c: f.area_dep_3c,
      // Un depósito de 3c sin alta en la app igual tiene que verse: es justamente el aviso
      // de que falta darlo de alta (pasó con el 225 GRUPO PACK).
      area_nombre: f.area_nombre ?? `Dep ${f.area_dep_3c} (sin alta)`,
      producto_3c: f.producto_3c,
      producto_nombre: f.producto_nombre ?? `${f.producto_3c} (sin alta en el maestro)`,
      unidad_base: f.unidad_base,
      unidades_por_bulto: bulto,
      cantidad_sugerida: cantidadSugerida,
      cantidad_app: cantidadApp,
      cantidad_3c: cantidad3c,
      cantidad_comparada: comparada,
      diferencia: Math.round(diferencia * 1000) / 1000,
      diferencia_bultos: bulto !== null && bulto > 1 ? Math.round((diferencia / bulto) * 100) / 100 : null,
      renglones_app: f.renglones_app,
      renglones_3c: f.renglones_3c,
      renglones_sin_sugerido: f.renglones_sin_sugerido,
      clasificacion,
    };
  });
}

export function resumir(items: ItemDesempeno[]): { total: ResumenDesempeno; areas: AreaDesempeno[] } {
  const total = resumenVacio();
  const porArea = new Map<number, AreaDesempeno>();
  for (const it of items) {
    acumular(total, it);
    let a = porArea.get(it.area_dep_3c);
    if (!a) {
      a = { ...resumenVacio(), area_dep_3c: it.area_dep_3c, area_nombre: it.area_nombre };
      porArea.set(it.area_dep_3c, a);
    }
    acumular(a, it);
  }
  cerrar(total);
  const areas = [...porArea.values()].map((a) => cerrar(a));
  // Primero las áreas donde más falta por registrar: es lo accionable.
  areas.sort((x, y) => y.solo_3c - x.solo_3c || y.en_3c - x.en_3c);
  return { total, areas };
}

export function avisoDeVentana(
  desde: string,
  hasta: string,
  espejo: { desde: string; hasta: string } | null,
  hoy: string,
): string | null {
  if (!espejo) return 'No hay movimientos de 3c importados todavía: el cruce no puede decir nada.';
  const partes: string[] = [];
  if (desde < espejo.desde) partes.push(`el export de 3c arranca el ${espejo.desde}`);
  if (hasta > espejo.hasta) partes.push(`el export de 3c llega hasta el ${espejo.hasta}`);
  if (hasta >= hoy) partes.push('3c todavía no tiene el día en curso');
  if (partes.length === 0) return null;
  return `El período pedido se sale de lo que cubre el export de 3c (${partes.join(' y ')}): ahí lo que figura como "no registrado" puede ser export faltante, no falta de carga.`;
}

// Sin fechas, el período por defecto es LO QUE CUBRE EL EXPORT DE 3c, sin el día en curso.
// Cualquier otro default (últimos 30 días, el mes) arrancaría con el aviso puesto y con
// combinaciones que figuran "sin registrar" solo porque el export no llega hasta ahí.
export async function obtenerDesempeno(filtros: {
  desde?: string;
  hasta?: string;
  base?: Base;
  hoy: string;
  ayer: string;
}): Promise<Desempeno> {
  const base = filtros.base ?? 'SUGERIDO';
  const espejo = await ventanaEspejo();
  const desde = filtros.desde ?? espejo?.desde ?? filtros.ayer;
  const topeEspejo = espejo && espejo.hasta < filtros.ayer ? espejo.hasta : filtros.ayer;
  const hasta = filtros.hasta ?? topeEspejo;
  const filas = await cruceAppContra3c({ desde, hasta });
  const items = armarItems(filas, base);
  const { total, areas } = resumir(items);
  return {
    desde,
    hasta,
    base,
    espejo,
    aviso: avisoDeVentana(desde, hasta, espejo, filtros.hoy),
    total,
    areas,
    items,
  };
}
