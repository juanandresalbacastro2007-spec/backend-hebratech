// ============================================================
// HebraTech — Centro de Control de Producción
// ============================================================

const API_BASE = '/produccion';
let ORDENES_PROD_CACHE = [];
let OPERARIOS_CACHE = [];
let PRODUCTOS_LISTA_CACHE = [];
let CLIENTES_CACHE = [];
let ORDENES_CLIENTE_CACHE = [];
let FILTRO_ACTUAL = '';
let calendar = null;

// Cuando se edita una orden antigua cuya fecha de entrega ya pasó,
// guardamos aquí el valor original para:
//   1) No borrarlo silenciosamente al abrir el modal.
//   2) Permitir guardar sin cambios aunque la fecha sea pasada.
let _entregaHistoricaOriginal = null;

// ── Utilidades ─────────────────────────────
function mostrarToast(mensaje, tipo = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = mensaje;
  toast.className = `toast show ${tipo}`;
  setTimeout(() => { toast.className = 'toast'; }, 4000);
}

function limpiarValidacion(ids) {
  ids.forEach(id => {
    const campo = document.getElementById(id);
    const err = document.getElementById('err-' + id);
    if (campo) campo.classList.remove('campo-error');
    if (err) err.style.display = 'none';
  });
}

function marcarError(id) {
  const campo = document.getElementById(id);
  const err = document.getElementById('err-' + id);
  if (campo) campo.classList.add('campo-error');
  if (err) err.style.display = 'block';
}

function enfocarPrimerCampo(id) {
  const el = document.getElementById(id);
  if (el) setTimeout(() => el.focus(), 50);
}

async function apiFetch(url, opciones = {}) {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opciones,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || 'Ocurrió un error inesperado.');
  }
  return data;
}

function formatearFecha(fechaStr) {
  if (!fechaStr) return '—';
  const fecha = new Date(fechaStr);
  return fecha.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Restricción de fechas: nunca antes de hoy ─────────
function hoyISO() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function aplicarMinFechaHoy() {
  const hoy = hoyISO();
  ['op-fecha-inicio', 'op-fecha-entrega', 'op-fecha-fin-real', 'c-fecha-entrega'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.min = hoy;
      el.setAttribute('min', hoy);
    }
  });
}

// ── Sincroniza el min de "Fecha Entrega" con hoy y con "Fecha Inicio" ──
// Opciones:
//   conservarHistorico: si true y el valor actual es una fecha pasada
//     (orden antigua), NO se aplica `min` para que el navegador no la
//     marque como inválida. El min real queda guardado en data-min-real
//     y se aplicará en cuanto el usuario interactúe con el campo.
function sincronizarMinFechaEntrega(opts = {}) {
  const { conservarHistorico = false } = opts;
  const inicioInput  = document.getElementById('op-fecha-inicio');
  const entregaInput = document.getElementById('op-fecha-entrega');
  if (!entregaInput) return;

  const hoy = hoyISO();
  const inicioVal = (inicioInput?.value || '').slice(0, 10);
  const nuevoMin = (inicioVal && inicioVal > hoy) ? inicioVal : hoy;

  // Guardamos el min "real" siempre, para poder aplicarlo después.
  entregaInput.dataset.minReal = nuevoMin;

  // ¿El valor actual es una fecha histórica que queremos conservar?
  const esHistorico = (
    conservarHistorico &&
    entregaInput.value &&
    entregaInput.value < nuevoMin
  );

  if (esHistorico) {
    // OJO: antes esta rama quitaba el atributo `min` por completo para
    // que el valor antiguo no quedara marcado como :invalid. Ese era el
    // bug real: al no existir `min`, el calendario nativo dejaba de
    // restringir cualquier selección y el usuario podía elegir CUALQUIER
    // fecha pasada, no solo conservar la original de la orden.
    // Ahora `min` = hoy queda siempre aplicado (el calendario sigue
    // bloqueando fechas pasadas para cualquier selección nueva) y solo
    // suavizamos el estilo rojo de :invalid del valor histórico ya
    // guardado con la clase `campo-historico` (ver CSS).
    entregaInput.min = hoy;
    entregaInput.setAttribute('min', hoy);
    entregaInput.setCustomValidity('');
    entregaInput.classList.add('campo-historico');
    return;
  }

  // Modo normal: min aplicado por ambos métodos (compatibilidad)
  entregaInput.classList.remove('campo-historico');
  entregaInput.min = nuevoMin;
  entregaInput.setAttribute('min', nuevoMin);

  // Si el valor quedó fuera de rango, limpiar
  if (entregaInput.value && entregaInput.value < nuevoMin) {
    entregaInput.value = '';
    entregaInput.setCustomValidity('');
  }
}

// Reaplica el min un instante después (por si el navegador cacheó el
// estado del picker mientras el modal estaba oculto).
function reforzarMinFechaEntrega(opts = {}) {
  setTimeout(() => {
    sincronizarMinFechaEntrega(opts);
    const entregaInput = document.getElementById('op-fecha-entrega');
    if (entregaInput && !opts.conservarHistorico) {
      const min = entregaInput.getAttribute('min');
      if (min) {
        entregaInput.min = min;
        entregaInput.setAttribute('min', min);
      }
    }
  }, 60);
}

// Fuerza el min REAL aunque el input esté en "modo histórico". Se llama
// en cuanto el usuario toca el campo, para que el picker nativo bloquee
// las fechas pasadas.
function _aplicarMinRealAlInteractuar() {
  const el = document.getElementById('op-fecha-entrega');
  if (!el) return;
  const minReal = el.dataset.minReal;
  if (!minReal) return;
  if (el.min !== minReal) {
    el.min = minReal;
    el.setAttribute('min', minReal);
  }
  el.classList.remove('campo-historico');
}

// Devuelve true si el valor actual del input de entrega es válido.
// Si `permitirHistorico` es true y el valor coincide con el original
// (una orden antigua que no se ha tocado), se considera válido.
function _validarEntregaActual(opts = {}) {
  const { permitirHistorico = false } = opts;
  const el = document.getElementById('op-fecha-entrega');
  if (!el) return true;

  const min = el.dataset.minReal || el.min || el.getAttribute('min');
  if (!el.value || !min) {
    el.setCustomValidity('');
    return true;
  }

  const esHistorico = (
    permitirHistorico &&
    _entregaHistoricaOriginal !== null &&
    el.value === _entregaHistoricaOriginal
  );

  if (el.value < min && !esHistorico) {
    el.setCustomValidity('La fecha de entrega debe ser hoy o posterior.');
    return false;
  }

  el.setCustomValidity('');
  return true;
}

function switchTab(nombre, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + nombre).classList.add('active');

  if (nombre === 'ordenes' && ORDENES_PROD_CACHE.length === 0) cargarOrdenesProduccion();
  if (nombre === 'operarios' && OPERARIOS_CACHE.length === 0) cargarOperarios();
  if (nombre === 'calendario') {
    if (!calendar) {
      iniciarCalendario();
    } else {
      calendar.render();
    }
  }
}

// ============================================================
// DASHBOARD
// ============================================================
async function cargarDashboard() {
  try {
    const d = await apiFetch(`${API_BASE}/dashboard/`);
    document.getElementById('kpi-total').textContent = d.totalOrdenes;
    document.getElementById('kpi-pendientes').textContent = d.pendientes;
    document.getElementById('kpi-en-progreso').textContent = d.enProgreso;
    document.getElementById('kpi-completadas').textContent = d.completadas;
    document.getElementById('kpi-atrasadas').textContent = d.atrasadas;
    document.getElementById('kpi-hoy').textContent = d.programadasHoy;

    document.getElementById('progreso-general-pct').textContent = d.progresoGeneral + '%';
    document.getElementById('progreso-general-fill').style.width = d.progresoGeneral + '%';

    const cont = document.getElementById('dashboard-alertas');
    cont.innerHTML = (d.alertas || []).map(a => `
      <div class="alerta-banner alerta-${a.tipo}">
        <span>${a.icono}</span> ${a.texto}
      </div>
    `).join('');
  } catch (e) {
    console.error('Error cargando dashboard', e);
  }
}

// PRODUCTOS PARA SELECT, CLIENTES
// ============================================================
async function cargarProductosLista() {
  try {
    PRODUCTOS_LISTA_CACHE = await apiFetch(`${API_BASE}/productos-lista/`);
    poblarSelectProductos();
  } catch (e) {
    console.error('Error cargando productos:', e);
  }
}

async function cargarClientes() {
  try {
    CLIENTES_CACHE = await apiFetch(`${API_BASE}/clientes/`);
    poblarSelectClientes();
  } catch (e) {
    console.error('Error cargando clientes:', e);
  }
}

function poblarSelectProductos() {
  const select = document.getElementById('op-producto');
  if (!select) return;
  const seleccionado = select.value;
  select.innerHTML = `<option value="">Seleccionar producto...</option>` +
    PRODUCTOS_LISTA_CACHE.map(p => `<option value="${p.idProducto}">${p.nombre}</option>`).join('');
  if (seleccionado) select.value = seleccionado;
}

function poblarSelectClientes() {
  const select = document.getElementById('op-cliente');
  if (!select) return;
  const seleccionado = select.value;
  select.innerHTML = `<option value="">Seleccionar cliente...</option>` +
    CLIENTES_CACHE.map(c => `<option value="${c.idCliente}">${c.nombre}</option>`).join('');
  if (seleccionado) select.value = seleccionado;
}

// ── Órdenes de cliente (para vincular y autocompletar la orden de producción) ──
async function cargarOrdenesCliente() {
  try {
    ORDENES_CLIENTE_CACHE = await apiFetch(`${API_BASE}/ordenes-cliente/`);
  } catch (e) {
    console.error('Error cargando órdenes de cliente:', e);
    ORDENES_CLIENTE_CACHE = [];
  }
  poblarSelectOrdenesCliente();
}

function poblarSelectOrdenesCliente() {
  const select = document.getElementById('op-orden-cliente');
  if (!select) return;
  select.innerHTML = `<option value="">Sin vincular (orden manual)</option>` +
    ORDENES_CLIENTE_CACHE.map(o => `
      <option value="${o.idOrden}">
        Orden #${o.idOrden} — ${o.cliente} (${o.nombreProducto || 'sin producto'}, ${o.cantidad || 0} u.)
      </option>
    `).join('');
  select.value = '';
}

const CAMPOS_DESDE_ORDEN_CLIENTE = ['op-cantidad', 'op-cliente'];
const CAMPOS_FECHA_SUGERIDOS_DESDE_ORDEN_CLIENTE = ['op-fecha-inicio', 'op-fecha-entrega'];

function aplicarOrdenCliente() {
  const select = document.getElementById('op-orden-cliente');
  const hint = document.getElementById('hint-op-orden-cliente');
  const idOrden = select.value;

  // Al cambiar de orden de cliente, olvidamos la marca de "histórico":
  // los valores que se carguen a continuación son frescos.
  _entregaHistoricaOriginal = null;

  if (!idOrden) {
    CAMPOS_DESDE_ORDEN_CLIENTE.forEach(id => { document.getElementById(id).disabled = false; });
    document.getElementById('op-producto').disabled = false;
    hint.style.display = 'none';
    return;
  }

  const orden = ORDENES_CLIENTE_CACHE.find(o => String(o.idOrden) === String(idOrden));
  if (!orden) return;

  const prodSelect = document.getElementById('op-producto');
  if (orden.idProducto) {
    prodSelect.value = orden.idProducto;
    prodSelect.disabled = true;
  } else {
    prodSelect.value = '';
    prodSelect.disabled = false;
  }

  document.getElementById('op-cantidad').value = orden.cantidad || 1;

  const clienteSelect = document.getElementById('op-cliente');
  let opt = Array.from(clienteSelect.options).find(o2 => o2.text === orden.cliente);
  if (!opt) {
    opt = document.createElement('option');
    opt.value = orden.cliente;
    opt.text = orden.cliente;
    clienteSelect.add(opt);
  }
  clienteSelect.value = opt.value;

  const inicioInput = document.getElementById('op-fecha-inicio');
  if (!inicioInput.value) inicioInput.value = hoyISO();

  const entregaInput = document.getElementById('op-fecha-entrega');
  const fechaEstimada = orden.fechaEntregaEstimada || '';
  const hoy = hoyISO();

  if (fechaEstimada && fechaEstimada >= hoy) {
    entregaInput.value = fechaEstimada;
  } else {
    entregaInput.value = '';
    if (fechaEstimada) {
      mostrarToast(
        'La fecha estimada del cliente ya pasó. Selecciona una nueva fecha de entrega.',
        'error'
      );
    } else {
      mostrarToast(
        'Esta orden de cliente aún no tiene fecha de entrega estimada. Selecciónala manualmente.',
        'error'
      );
    }
  }

  document.getElementById('op-prioridad').value = orden.prioridad || 'Normal';
  if (orden.instrucciones) {
    document.getElementById('op-observaciones').value = orden.instrucciones;
  }

  CAMPOS_DESDE_ORDEN_CLIENTE.forEach(id => { document.getElementById(id).disabled = true; });
  hint.style.display = 'block';

  sincronizarMinFechaEntrega();
  reforzarMinFechaEntrega();
}

// ============================================================
// ÓRDENES DE PRODUCCIÓN
// ============================================================
async function cargarOrdenesProduccion(filtro = FILTRO_ACTUAL) {
  try {
    const qs = filtro ? `?filtro=${filtro}` : '';
    ORDENES_PROD_CACHE = await apiFetch(`${API_BASE}/ordenes-produccion/${qs}`);
    renderOrdenesGrid(ORDENES_PROD_CACHE);
  } catch (e) {
    mostrarToast('No se pudieron cargar las órdenes de producción.', 'error');
  }
  cargarDashboard();
}

function badgeEstado(estado) {
  const map = {
    'Pendiente':   'badge-gris',
    'En Progreso': 'badge-azul',
    'Completado':  'badge-verde',
    'Fuera de Plazo': 'badge-rojo',
    'Cancelada':   'badge-rojo',
  };
  return `<span class="badge ${map[estado] || 'badge-gris'}">${estado.toUpperCase()}</span>`;
}

function renderOrdenesGrid(lista) {
  const cont = document.getElementById('ordenes-grid');
  if (!lista.length) {
    cont.innerHTML = `<div class="empty-state">No hay órdenes que coincidan con este filtro.</div>`;
    return;
  }

  cont.innerHTML = lista.map(o => {
    const avance = o.progreso || 0;
    return `
    <div class="orden-card ${o.estado === 'Fuera de Plazo' ? 'orden-card-atrasada' : ''}" onclick="abrirModalDetalle(${o.idOrdenProduccion})">
      <div class="orden-card-header">
        <span class="orden-card-id">${o.numero}</span>
        ${badgeEstado(o.estado)}
      </div>
      <div class="orden-card-producto">${o.nombreProducto}</div>
      <div class="orden-card-cantidad">${o.cantidad} unidades · Cliente: ${o.cliente}</div>
      <div class="progress-bar-track progress-bar-sm">
        <div class="progress-bar-fill" style="width:${avance}%"></div>
      </div>
      <div class="orden-card-progreso-pct">${avance}% completado</div>
      <div class="orden-card-fechas">
        <span>Inicio: ${formatearFecha(o.fechaInicio)}</span>
        <span>Entrega: ${formatearFecha(o.fechaEntrega)}</span>
      </div>
      <div class="orden-card-acciones" onclick="event.stopPropagation()">
        <button class="action-btn edit" onclick="editarOrden(${o.idOrdenProduccion})">✏️</button>
        <button class="action-btn delete" onclick="eliminarOrden(${o.idOrdenProduccion})">🗑️</button>
      </div>
    </div>
  `}).join('');
}

function filtrarOrdenes() {
  const texto = (document.getElementById('search-ordenes').value || '').toLowerCase();
  if (!texto) { renderOrdenesGrid(ORDENES_PROD_CACHE); return; }
  const filtradas = ORDENES_PROD_CACHE.filter(o =>
    o.nombreProducto.toLowerCase().includes(texto) ||
    o.numero.toLowerCase().includes(texto) ||
    o.cliente.toLowerCase().includes(texto)
  );
  renderOrdenesGrid(filtradas);
}

// Filtros rápidos
document.addEventListener('DOMContentLoaded', () => {
  const cont = document.getElementById('filtros-rapidos');
  if (!cont) return;
  cont.querySelectorAll('.chip-filtro').forEach(chip => {
    chip.addEventListener('click', () => {
      cont.querySelectorAll('.chip-filtro').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      FILTRO_ACTUAL = chip.dataset.filtro;
      cargarOrdenesProduccion(FILTRO_ACTUAL);
    });
  });
});

// ── Abrir modal de nueva orden ──────────────────────
function abrirModalNuevaOrden() {
  _entregaHistoricaOriginal = null;
  limpiarValidacion(['op-producto', 'op-cantidad', 'op-cliente', 'op-fecha-inicio', 'op-fecha-entrega']);
  document.getElementById('modal-orden-title').textContent = '🗒 Nueva Orden de Producción';
  document.getElementById('orden-id').value = '';

  poblarSelectProductos();
  poblarSelectClientes();

  const orderSelect = document.getElementById('op-orden-cliente');
  orderSelect.disabled = false;
  orderSelect.innerHTML = `<option value="">Sin vincular (orden manual)</option>`;
  document.getElementById('hint-op-orden-cliente').style.display = 'none';
  ['op-producto', 'op-cantidad', 'op-cliente', 'op-fecha-inicio', 'op-fecha-entrega'].forEach(id => {
    document.getElementById(id).disabled = false;
  });

  document.getElementById('op-producto').value = '';
  document.getElementById('op-cantidad').value = 1;
  document.getElementById('op-cliente').value = '';
  document.getElementById('op-fecha-inicio').value = '';
  document.getElementById('op-fecha-entrega').value = '';
  document.getElementById('op-fecha-fin-real').value = '';
  document.getElementById('op-prioridad').value = 'Normal';
  document.getElementById('op-estado').value = 'Pendiente';
  document.getElementById('op-observaciones').value = '';

  const entregaInput = document.getElementById('op-fecha-entrega');
  entregaInput.classList.remove('campo-historico');
  entregaInput.setCustomValidity('');

  aplicarMinFechaHoy();
  sincronizarMinFechaEntrega();
  reforzarMinFechaEntrega();

  document.getElementById('modal-orden').classList.add('open');
  enfocarPrimerCampo('op-orden-cliente');

  cargarOrdenesCliente();
}

// ── Editar orden ──────────────────────────────────────
function editarOrden(id) {
  const o = ORDENES_PROD_CACHE.find(x => x.idOrdenProduccion === id);
  if (!o) return;

  limpiarValidacion(['op-producto', 'op-cantidad', 'op-cliente', 'op-fecha-inicio', 'op-fecha-entrega']);
  document.getElementById('modal-orden-title').textContent = `✏️ Editar Orden ${o.numero}`;
  document.getElementById('orden-id').value = o.idOrdenProduccion;

  poblarSelectProductos();
  poblarSelectClientes();

  ['op-producto', 'op-cantidad', 'op-cliente', 'op-fecha-inicio', 'op-fecha-entrega'].forEach(id => {
    document.getElementById(id).disabled = false;
  });

  document.getElementById('op-producto').value = o.idProducto || '';
  document.getElementById('op-cantidad').value = o.cantidad;
  const clienteSelect = document.getElementById('op-cliente');
  const clienteOpt = Array.from(clienteSelect.options).find(opt => opt.text === o.cliente);
  if (clienteOpt) {
    clienteSelect.value = clienteOpt.value;
  } else if (o.cliente) {
    const option = document.createElement('option');
    option.value = o.cliente;
    option.text = o.cliente;
    clienteSelect.add(option);
    clienteSelect.value = o.cliente;
  }

  document.getElementById('op-fecha-inicio').value = o.fechaInicio;

  // ── BUG FIX ──
  // Aquí es donde se vaciaba la fecha histórica. Guardamos el original,
  // y si es una fecha pasada la conservamos visible con estilo ámbar.
  const entregaInput = document.getElementById('op-fecha-entrega');
  entregaInput.value = o.fechaEntrega;
  _entregaHistoricaOriginal = o.fechaEntrega;

  const hoy = hoyISO();
  const esHistorico = !!(o.fechaEntrega && o.fechaEntrega < hoy);

  document.getElementById('op-fecha-fin-real').value = o.fechaFinReal || '';
  document.getElementById('op-prioridad').value = o.prioridad;
  document.getElementById('op-estado').value = o.estado;
  document.getElementById('op-observaciones').value = o.observaciones || '';

  const ordenSelect = document.getElementById('op-orden-cliente');
  const hint = document.getElementById('hint-op-orden-cliente');
  if (o.idOrden) {
    ordenSelect.innerHTML = `<option value="${o.idOrden}" selected>Vinculada a orden de cliente #${o.idOrden}</option>`;
    ordenSelect.value = o.idOrden;
    ordenSelect.disabled = true;
    hint.style.display = 'block';
  } else {
    ordenSelect.disabled = false;
    ordenSelect.innerHTML = `<option value="" selected>Sin vincular (orden manual)</option>`;
    hint.style.display = 'none';
  }

  // Aplicar min solo si NO es histórico; si lo es, se preserva el valor
  // y se le pone la clase ámbar.
  aplicarMinFechaHoy();
  sincronizarMinFechaEntrega({ conservarHistorico: esHistorico });
  reforzarMinFechaEntrega({ conservarHistorico: esHistorico });

  if (esHistorico) {
    // Aviso visual: la fecha está en el pasado y se conserva por
    // tratarse de una orden antigua.
    setTimeout(() => {
      mostrarToast(
        `⚠️ Esta orden tiene fecha de entrega vencida (${formatearFecha(o.fechaEntrega)}). ` +
        `Se conserva tal cual, pero si la cambias debe ser hoy o posterior.`,
        'error'
      );
    }, 200);
  }

  document.getElementById('modal-orden').classList.add('open');
}

function cerrarModalOrden() {
  document.getElementById('modal-orden').classList.remove('open');
  _entregaHistoricaOriginal = null;
}

async function guardarOrden() {
  const id = document.getElementById('orden-id').value;
  const idOrdenCliente = document.getElementById('op-orden-cliente').value || null;
  const idProducto = document.getElementById('op-producto').value;
  const cantidad = parseInt(document.getElementById('op-cantidad').value, 10);
  const clienteSelect = document.getElementById('op-cliente');
  const clienteNombre = clienteSelect.options[clienteSelect.selectedIndex]?.text || '';
  const fechaInicio = document.getElementById('op-fecha-inicio').value;
  const fechaEntrega = document.getElementById('op-fecha-entrega').value;
  const fechaFinReal = document.getElementById('op-fecha-fin-real').value || null;
  const prioridad = document.getElementById('op-prioridad').value;
  const estado = document.getElementById('op-estado').value;
  const observaciones = document.getElementById('op-observaciones').value.trim();

  const hoy = hoyISO();
  limpiarValidacion(['op-producto', 'op-cantidad', 'op-cliente', 'op-fecha-inicio', 'op-fecha-entrega']);
  let valido = true;
  if (!idProducto) { marcarError('op-producto'); valido = false; }
  if (!cantidad || cantidad < 1) { marcarError('op-cantidad'); valido = false; }
  if (!clienteNombre) { marcarError('op-cliente'); valido = false; }
  if (!fechaInicio) { marcarError('op-fecha-inicio'); valido = false; }
  if (!fechaEntrega) { marcarError('op-fecha-entrega'); valido = false; }
  else if (fechaInicio && fechaEntrega < fechaInicio) {
    marcarError('op-fecha-entrega');
    mostrarToast('La fecha de entrega no puede ser anterior a la fecha de inicio.', 'error');
    valido = false;
  }

  // Fecha entrega: nunca antes de hoy, SALVO si es una orden antigua cuya
  // fecha no se ha tocado (mismo valor con el que se abrió el modal).
  const esHistorico = (
    _entregaHistoricaOriginal !== null &&
    fechaEntrega === _entregaHistoricaOriginal
  );
  if (fechaEntrega && fechaEntrega < hoy && !esHistorico) {
    marcarError('op-fecha-entrega');
    mostrarToast('La fecha de entrega no puede ser anterior a hoy.', 'error');
    valido = false;
  }
  if (!idOrdenCliente && fechaInicio && fechaInicio < hoy) {
    marcarError('op-fecha-inicio');
    mostrarToast('La fecha de inicio no puede ser anterior a hoy.', 'error');
    valido = false;
  }
  if (fechaFinReal && fechaFinReal < hoy) {
    mostrarToast('La fecha fin real no puede ser anterior a hoy.', 'error');
    valido = false;
  }

  if (!valido) return;

  const payload = {
    idOrden: idOrdenCliente ? parseInt(idOrdenCliente, 10) : null,
    idProducto: parseInt(idProducto, 10),
    cantidad,
    cliente: clienteNombre,
    fechaInicio,
    fechaEntrega,
    fechaFinReal,
    prioridad,
    estado,
    observaciones,
  };

  const url = id ? `${API_BASE}/ordenes-produccion/${id}/` : `${API_BASE}/ordenes-produccion/`;
  const metodo = id ? 'PUT' : 'POST';

  try {
    await apiFetch(url, { method: metodo, body: JSON.stringify(payload) });
    mostrarToast(id ? 'Orden actualizada.' : 'Orden creada.');
    cerrarModalOrden();
    await cargarOrdenesProduccion();
  } catch (e) {
    mostrarToast(e.message, 'error');
  }
}

async function eliminarOrden(id) {
  if (!confirm('¿Eliminar esta orden de producción?')) return;
  try {
    await apiFetch(`${API_BASE}/ordenes-produccion/${id}/`, { method: 'DELETE' });
    mostrarToast('Orden eliminada.');
    await cargarOrdenesProduccion();
  } catch (e) {
    mostrarToast(e.message, 'error');
  }
}

// ── Modal de detalle con timeline ────────────────────
async function abrirModalDetalle(id) {
  let o;
  try {
    o = await apiFetch(`${API_BASE}/ordenes-produccion/${id}/`);
  } catch (e) {
    mostrarToast('No se pudo cargar el detalle de la orden.', 'error');
    return;
  }

  const avance = o.progreso || 0;

  document.getElementById('detalle-titulo').textContent = `${o.numero} — ${o.nombreProducto}`;
  document.getElementById('detalle-subtitulo').innerHTML =
    `${o.cantidad} unidades · Cliente: ${o.cliente} ${badgeEstado(o.estado)}`;
  document.getElementById('detalle-progress-fill').style.width = avance + '%';
  document.getElementById('detalle-progress-pct').textContent = avance + '%';

  const estados = ['Pendiente', 'En Progreso', 'Completado'];
  const estadoActual = o.estado;
  const timelineHtml = `
    <div class="timeline-container">
      ${estados.map((est, idx) => {
        let clase = 'timeline-step';
        if (est === estadoActual) clase += ' active';
        else if (estados.indexOf(estadoActual) > idx) clase += ' completed';
        return `
          <div class="${clase}">
            <div class="timeline-dot"></div>
            <div class="timeline-label">${est}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  document.getElementById('panel-resumen').innerHTML = `
    <div class="resumen-grid">
      <div><strong>Número</strong><br>${o.numero}</div>
      <div><strong>Producto</strong><br>${o.nombreProducto}</div>
      <div><strong>Cantidad</strong><br>${o.cantidad} unidades</div>
      <div><strong>Cliente</strong><br>${o.cliente}</div>
      <div><strong>Fecha Inicio</strong><br>${formatearFecha(o.fechaInicio)}</div>
      <div><strong>Fecha Entrega</strong><br>${formatearFecha(o.fechaEntrega)}</div>
      <div><strong>Fecha Fin Real</strong><br>${o.fechaFinReal ? formatearFecha(o.fechaFinReal) : '—'}</div>
      <div><strong>Prioridad</strong><br>${o.prioridad}</div>
      <div><strong>Estado</strong><br>${o.estado}</div>
      <div><strong>Observaciones</strong><br>${o.observaciones || '—'}</div>
    </div>
    <div style="margin-top:20px;">
      <strong>Progreso</strong>
      ${timelineHtml}
    </div>
  `;

  document.getElementById('panel-historial').innerHTML = `
    <div class="empty-state">No hay historial de cambios disponible.</div>
  `;

  cambiarTabDetalle('resumen');
  document.getElementById('btn-editar-desde-detalle').onclick = () => {
    cerrarModalDetalle();
    editarOrden(o.idOrdenProduccion);
  };
  document.getElementById('modal-detalle-orden').classList.add('open');
}

function cambiarTabDetalle(tab) {
  document.querySelectorAll('.detalle-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.detalle-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.detalle-tab[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
}

function cerrarModalDetalle() {
  document.getElementById('modal-detalle-orden').classList.remove('open');
}

// ============================================================
// CALENDARIO (con español)
// ============================================================
function iniciarCalendario() {
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) return;
  if (calendar) {
    calendar.destroy();
    calendar = null;
  }

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'es',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay'
    },
    buttonText: {
      today: 'Hoy',
      month: 'Mes',
      week: 'Semana',
      day: 'Día'
    },
    events: function(info, successCallback, failureCallback) {
      fetch(`${API_BASE}/eventos-calendario/`)
        .then(res => res.json())
        .then(data => {
          const events = data.map(e => ({
            id: String(e.id),
            title: e.title,
            start: e.start,
            end: e.end,
            color: e.color,
            extendedProps: {
              estado: e.estado,
              producto: e.producto,
              cantidad: e.cantidad
            }
          }));
          successCallback(events);
        })
        .catch(err => {
          console.error('Error cargando eventos:', err);
          failureCallback(err);
        });
    },
    eventDrop: function(info) {
      const id = parseInt(info.event.id, 10);
      const nuevaFecha = info.event.startStr.slice(0, 10);
      if (nuevaFecha < hoyISO()) {
        mostrarToast('No puedes mover una orden a una fecha anterior a hoy.', 'error');
        info.revert();
        return;
      }
      fetch(`${API_BASE}/ordenes-produccion/${id}/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fechaInicio: nuevaFecha })
      })
      .then(res => res.json())
      .then(() => {
        mostrarToast('Fecha de inicio actualizada correctamente.');
        calendar.refetchEvents();
        cargarDashboard();
        cargarOrdenesProduccion();
      })
      .catch(err => {
        mostrarToast('Error al actualizar la fecha.', 'error');
        console.error(err);
        info.revert();
      });
    },
    eventResize: function(info) {
      const id = parseInt(info.event.id, 10);
      const nuevaFecha = info.event.endStr ? info.event.endStr.slice(0, 10) : null;
      if (nuevaFecha && nuevaFecha < hoyISO()) {
        mostrarToast('No puedes fijar una fecha de entrega anterior a hoy.', 'error');
        info.revert();
        return;
      }
      if (nuevaFecha) {
        fetch(`${API_BASE}/ordenes-produccion/${id}/`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fechaEntrega: nuevaFecha })
        })
        .then(res => res.json())
        .then(() => {
          mostrarToast('Fecha de entrega actualizada.');
          calendar.refetchEvents();
          cargarDashboard();
          cargarOrdenesProduccion();
        })
        .catch(err => {
          mostrarToast('Error al redimensionar.', 'error');
          console.error(err);
          info.revert();
        });
      }
    },
    eventClick: function(info) {
      const id = parseInt(info.event.id, 10);
      abrirModalDetalle(id);
    },
    height: 'auto'
  });

  calendar.render();
}

// ============================================================
// AVANCE DE OPERARIOS
// ============================================================
async function cargarOperarios() {
  try {
    const data = await apiFetch(`${API_BASE}/operarios-avance/`);
    OPERARIOS_CACHE = data.operarios || [];
    renderOperarios(OPERARIOS_CACHE);
  } catch (e) {
    mostrarToast('No se pudo cargar el avance de operarios.', 'error');
  }
}

let OPERARIOS_EXPANDIDOS = {};

function renderOperarios(lista) {
  const cont = document.getElementById('operarios-grid');
  if (!lista.length) {
    cont.innerHTML = `<div class="empty-state">No hay operarios activos.</div>`;
    return;
  }

  cont.innerHTML = lista.map(op => {
    const expandido = !!OPERARIOS_EXPANDIDOS[op.idOperario];
    const tareasVisibles = expandido ? op.tareas : op.tareas.slice(0, 4);
    const hayMas = op.tareas.length > 4;

    return `
    <div class="operario-card">
      <div class="operario-card-header">
        <span class="operario-nombre">👤 ${op.nombre}</span>
        <span class="operario-especialidad">${op.especialidad}</span>
      </div>
      <div class="progress-bar-track progress-bar-sm">
        <div class="progress-bar-fill" style="width:${op.avancePct}%; transition: width .4s ease;"></div>
      </div>
      <div class="operario-contadores">
        <span>⏳ ${op.contadores.pendiente}</span>
        <span>⚙️ ${op.contadores.enProgreso}</span>
        <span>✅ ${op.contadores.completada}</span>
        <span>🚫 ${op.contadores.cancelada}</span>
        <span style="margin-left:auto;font-weight:600;">${op.avancePct}%</span>
      </div>
      <div class="operario-tareas">
        ${tareasVisibles.map(t => {
          const conHoras = t.horasEstimadas != null && t.horasEstimadas > 0;
          const pctHoras = conHoras ? Math.min(100, Math.round(((t.horasReales || 0) / t.horasEstimadas) * 100)) : null;
          return `
          <div class="operario-tarea-row" style="flex-direction:column;align-items:stretch;gap:2px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span>${t.nombreTarea} (${t.proceso || 'General'})</span>
              ${badgeEstado(t.estado)}
            </div>
            ${conHoras ? `
              <div class="progress-bar-track progress-bar-sm" style="height:4px;">
                <div class="progress-bar-fill" style="width:${pctHoras}%;"></div>
              </div>
              <span style="font-size:11px;color:#6b7280;">${t.horasReales || 0}h / ${t.horasEstimadas}h estimadas</span>
            ` : ''}
          </div>
        `}).join('') || '<span class="empty-inline">Sin tareas asignadas.</span>'}
      </div>
      ${hayMas ? `
        <button class="btn btn-outline" style="width:100%;margin-top:8px;font-size:12px;" onclick="toggleOperarioExpandido(${op.idOperario})">
          ${expandido ? 'Ver menos' : `Ver todas (${op.tareas.length})`}
        </button>
      ` : ''}
    </div>
  `}).join('');
}

function toggleOperarioExpandido(idOperario) {
  OPERARIOS_EXPANDIDOS[idOperario] = !OPERARIOS_EXPANDIDOS[idOperario];
  filtrarOperarios();
}

function filtrarOperarios() {
  const texto = (document.getElementById('search-operarios').value || '').toLowerCase();
  const estado = document.getElementById('filter-estado-tarea').value;
  const filtrados = OPERARIOS_CACHE
    .map(op => ({
      ...op,
      tareas: estado ? op.tareas.filter(t => t.estado === estado) : op.tareas,
    }))
    .filter(op => !texto || op.nombre.toLowerCase().includes(texto));
  renderOperarios(filtrados);
}

// ============================================================
// INICIALIZACIÓN
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  aplicarMinFechaHoy();

  const inicioInput  = document.getElementById('op-fecha-inicio');
  const entregaInput = document.getElementById('op-fecha-entrega');

  // Fecha inicio: la fecha entrega se re-sincroniza cuando cambia el inicio
  inicioInput?.addEventListener('change', () => sincronizarMinFechaEntrega());
  inicioInput?.addEventListener('input',  () => sincronizarMinFechaEntrega());

  if (entregaInput) {
    // Al recibir foco, forzamos el min real (por si estaba suavizado por
    // una fecha histórica). El picker nativo bloqueará fechas pasadas.
    entregaInput.addEventListener('focus', () => {
      _aplicarMinRealAlInteractuar();
    });

    // Mientras escribe/pega: validación en vivo con mensaje nativo del
    // navegador (reportValidity) sin esperar a blur.
    const validarEnVivo = () => {
      _aplicarMinRealAlInteractuar();
      const ok = _validarEntregaActual({ permitirHistorico: false });
      if (!ok) {
        // El navegador muestra su burbuja de "valor inválido"
        entregaInput.reportValidity();
      }
    };
    entregaInput.addEventListener('input',  validarEnVivo);
    entregaInput.addEventListener('change', validarEnVivo);

    // Al salir del campo: si el valor quedó inválido y NO es la fecha
    // histórica original, lo limpiamos y avisamos.
    entregaInput.addEventListener('blur', () => {
      _aplicarMinRealAlInteractuar();
      const ok = _validarEntregaActual({ permitirHistorico: true });
      if (!ok) {
        const esHistoricoOriginal = (
          _entregaHistoricaOriginal !== null &&
          entregaInput.value === _entregaHistoricaOriginal
        );
        if (!esHistoricoOriginal) {
          entregaInput.value = '';
          entregaInput.setCustomValidity('');
          mostrarToast('La fecha de entrega no puede ser anterior a hoy.', 'error');
        }
      }
    });
  }

  cargarDashboard();
  cargarOrdenesProduccion();
  cargarProductosLista();
  cargarClientes();
  cargarOperarios();
});