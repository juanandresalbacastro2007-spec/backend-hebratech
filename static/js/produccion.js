// ============================================================
// HebraTech — Centro de Control de Producción
// ============================================================

const API_BASE = '/produccion';
let PRODUCTOS_CACHE = [];
let ORDENES_CACHE = [];
let OPERARIOS_CACHE = [];
let FILTRO_ACTUAL = '';

// ── Utilidades generales ─────────────────────────────
function mostrarToast(mensaje, tipo = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = mensaje;
  toast.className = `toast show ${tipo}`;
  setTimeout(() => { toast.className = 'toast'; }, 3500);
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

function switchTab(nombre, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + nombre).classList.add('active');

  if (nombre === 'productos' && PRODUCTOS_CACHE.length === 0) cargarProductos();
  if (nombre === 'ordenes' && ORDENES_CACHE.length === 0) cargarOrdenes();
  if (nombre === 'operarios' && OPERARIOS_CACHE.length === 0) cargarOperarios();
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

// ============================================================
// PRODUCTOS
// ============================================================

async function cargarProductos() {
  try {
    PRODUCTOS_CACHE = await apiFetch(`${API_BASE}/productos/`);
    renderProductos(PRODUCTOS_CACHE);
    poblarSelectProductos();
  } catch (e) {
    mostrarToast('No se pudieron cargar los productos.', 'error');
  }
}

function renderProductos(lista) {
  const tbody = document.getElementById('tbody-productos');
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No hay productos registrados.</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map(p => `
    <tr>
      <td>${p.nombre}</td>
      <td>${p.categoria}</td>
      <td>$${Number(p.precio).toLocaleString()}</td>
      <td class="celda-truncada">${p.descripcion || ''}</td>
      <td>
        <button class="action-btn edit" onclick="editarProducto(${p.idProducto})">✏️</button>
        <button class="action-btn delete" onclick="eliminarProducto(${p.idProducto})">🗑️</button>
      </td>
    </tr>
  `).join('');
}

function filtrarProductos() {
  const texto = (document.getElementById('search-productos').value || '').toLowerCase();
  const cat = document.getElementById('filter-cat').value;
  const filtrados = PRODUCTOS_CACHE.filter(p =>
    (!texto || p.nombre.toLowerCase().includes(texto)) &&
    (!cat || p.categoria === cat)
  );
  renderProductos(filtrados);
}

function poblarSelectProductos() {
  const select = document.getElementById('o-producto');
  if (!select) return;
  const seleccionado = select.value;
  select.innerHTML = `<option value="">Seleccionar producto...</option>` +
    PRODUCTOS_CACHE.map(p => `<option value="${p.idProducto}">${p.nombre}</option>`).join('');
  if (seleccionado) select.value = seleccionado;
}

function abrirModalNuevoProducto() {
  limpiarValidacion(['prod-nombre', 'prod-categoria', 'prod-descripcion']);
  document.getElementById('modal-producto-title').textContent = '➕ Nuevo Producto';
  document.getElementById('producto-id').value = '';
  document.getElementById('prod-nombre').value = '';
  document.getElementById('prod-categoria').value = '';
  document.getElementById('prod-precio').value = 0;
  document.getElementById('prod-descripcion').value = '';
  document.getElementById('modal-producto').classList.add('open');
  enfocarPrimerCampo('prod-nombre');
}

function editarProducto(id) {
  const p = PRODUCTOS_CACHE.find(x => x.idProducto === id);
  if (!p) return;
  limpiarValidacion(['prod-nombre', 'prod-categoria', 'prod-descripcion']);
  document.getElementById('modal-producto-title').textContent = '✏️ Editar Producto';
  document.getElementById('producto-id').value = p.idProducto;
  document.getElementById('prod-nombre').value = p.nombre;
  document.getElementById('prod-categoria').value = p.categoria;
  document.getElementById('prod-precio').value = p.precio;
  document.getElementById('prod-descripcion').value = p.descripcion || '';
  document.getElementById('modal-producto').classList.add('open');
}

function cerrarModalProducto() {
  document.getElementById('modal-producto').classList.remove('open');
}

async function guardarProducto() {
  const id = document.getElementById('producto-id').value;
  const nombre = document.getElementById('prod-nombre').value.trim();
  const categoria = document.getElementById('prod-categoria').value;
  const descripcion = document.getElementById('prod-descripcion').value.trim();
  const precio = parseFloat(document.getElementById('prod-precio').value) || 0;

  limpiarValidacion(['prod-nombre', 'prod-categoria', 'prod-descripcion']);
  let valido = true;
  if (!nombre) { marcarError('prod-nombre'); valido = false; }
  if (!categoria) { marcarError('prod-categoria'); valido = false; }
  if (!descripcion) { marcarError('prod-descripcion'); valido = false; }
  if (!valido) return;

  const payload = { nombre, categoria, descripcion, precio };
  const url = id ? `${API_BASE}/productos/${id}/` : `${API_BASE}/productos/`;
  const metodo = id ? 'PUT' : 'POST';

  try {
    await apiFetch(url, { method: metodo, body: JSON.stringify(payload) });
    mostrarToast(id ? 'Producto actualizado.' : 'Producto creado.');
    cerrarModalProducto();
    await cargarProductos();
  } catch (e) {
    mostrarToast(e.message, 'error');
  }
}

async function eliminarProducto(id) {
  if (!confirm('¿Eliminar este producto?')) return;
  try {
    await apiFetch(`${API_BASE}/productos/${id}/`, { method: 'DELETE' });
    mostrarToast('Producto eliminado.');
    await cargarProductos();
  } catch (e) {
    mostrarToast(e.message, 'error');
  }
}

// ============================================================
// ÓRDENES DE PRODUCCIÓN (cards con progreso + etapas)
// ============================================================

async function cargarOrdenes(filtro = FILTRO_ACTUAL) {
  try {
    const qs = filtro ? `?filtro=${filtro}` : '';
    ORDENES_CACHE = await apiFetch(`${API_BASE}/ordenes/${qs}`);
    renderOrdenesGrid(ORDENES_CACHE);
  } catch (e) {
    mostrarToast('No se pudieron cargar las órdenes.', 'error');
  }
  cargarDashboard();
}

function badgeEstado(estado, atrasada) {
  if (atrasada) return `<span class="badge badge-rojo">🔴 ATRASADA</span>`;
  const map = {
    'Pendiente':   'badge-gris',
    'En Progreso': 'badge-azul',
    'Completado':  'badge-verde',
    'Detenido':    'badge-amarillo',
    'Retrasado':   'badge-rojo',
  };
  return `<span class="badge ${map[estado] || 'badge-gris'}">${estado.toUpperCase()}</span>`;
}

function renderOrdenesGrid(lista) {
  const cont = document.getElementById('ordenes-grid');
  if (!lista.length) {
    cont.innerHTML = `<div class="empty-state">No hay órdenes que coincidan con este filtro.</div>`;
    return;
  }

  cont.innerHTML = lista.map(o => `
    <div class="orden-card ${o.atrasada ? 'orden-card-atrasada' : ''}" onclick="abrirModalDetalle(${o.idProduccion})">
      <div class="orden-card-header">
        <span class="orden-card-id">ORD-${String(o.idProduccion).padStart(5, '0')}</span>
        ${badgeEstado(o.estado, o.atrasada)}
      </div>
      <div class="orden-card-producto">${o.producto}</div>
      <div class="orden-card-cantidad">${o.cantidadRequerida} unidades ${o.cliente ? '· ' + o.cliente : ''}</div>

      <div class="progress-bar-track progress-bar-sm">
        <div class="progress-bar-fill" style="width:${o.avancePct}%"></div>
      </div>
      <div class="orden-card-progreso-pct">${o.avancePct}% completado</div>

      <div class="orden-card-fechas">
        <span>Inicio: ${o.fechaInicio}</span>
        <span>Entrega: ${o.fechaEstimadaFin}</span>
      </div>

      <div class="orden-card-acciones" onclick="event.stopPropagation()">
        <button class="action-btn edit" onclick="editarOrden(${o.idProduccion})">✏️</button>
        <button class="action-btn delete" onclick="eliminarOrden(${o.idProduccion})">🗑️</button>
      </div>
    </div>
  `).join('');
}

function filtrarOrdenes() {
  const texto = (document.getElementById('search-ordenes').value || '').toLowerCase();
  if (!texto) { renderOrdenesGrid(ORDENES_CACHE); return; }
  const filtradas = ORDENES_CACHE.filter(o =>
    o.producto.toLowerCase().includes(texto) ||
    String(o.idProduccion).includes(texto) ||
    (o.cliente || '').toLowerCase().includes(texto)
  );
  renderOrdenesGrid(filtradas);
}

// Filtros rápidos (chips)
document.addEventListener('DOMContentLoaded', () => {
  const cont = document.getElementById('filtros-rapidos');
  if (!cont) return;
  cont.querySelectorAll('.chip-filtro').forEach(chip => {
    chip.addEventListener('click', () => {
      cont.querySelectorAll('.chip-filtro').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      FILTRO_ACTUAL = chip.dataset.filtro;
      cargarOrdenes(FILTRO_ACTUAL);
    });
  });
});

function poblarSelectEstado(o) {
  const select = document.getElementById('o-estado');
  select.innerHTML = `<option value="${o.estado}">${o.estado} (actual)</option>`;
  (o.transicionesDisponibles || []).forEach(destino => {
    select.innerHTML += `<option value="${destino}">${destino}</option>`;
  });
}

function poblarSelectEstadoNuevaOrden() {
  const select = document.getElementById('o-estado');
  select.innerHTML = `<option value="Pendiente">Pendiente</option>`;
}

function abrirModalNuevaOrden() {
  limpiarValidacion(['o-producto', 'o-cantidad', 'o-fecha-inicio', 'o-fecha-fin', 'o-estado']);
  document.getElementById('modal-orden-title').textContent = '🗒 Nueva Orden de Producción';
  document.getElementById('orden-id').value = '';
  poblarSelectProductos();
  document.getElementById('o-producto').value = '';
  document.getElementById('o-cantidad').value = 1;
  document.getElementById('o-descripcion').value = '';
  document.getElementById('o-fecha-inicio').value = '';
  document.getElementById('o-fecha-fin').value = '';
  poblarSelectEstadoNuevaOrden();
  document.getElementById('modal-orden').classList.add('open');
  enfocarPrimerCampo('o-producto');
}

function editarOrden(id) {
  const o = ORDENES_CACHE.find(x => x.idProduccion === id);
  if (!o) return;
  limpiarValidacion(['o-producto', 'o-cantidad', 'o-fecha-inicio', 'o-fecha-fin', 'o-estado']);
  document.getElementById('modal-orden-title').textContent = `✏️ Editar Orden ORD-${String(id).padStart(5, '0')}`;
  document.getElementById('orden-id').value = o.idProduccion;
  poblarSelectProductos();
  document.getElementById('o-producto').value = o.idProducto;
  document.getElementById('o-cantidad').value = o.cantidadRequerida;
  document.getElementById('o-descripcion').value = o.descripcion || '';
  document.getElementById('o-fecha-inicio').value = o.fechaInicio;
  document.getElementById('o-fecha-fin').value = o.fechaEstimadaFin;
  poblarSelectEstado(o);
  document.getElementById('modal-orden').classList.add('open');
  ajustarMinFechasOrden(o.fechaInicio, o.fechaEstimadaFin);
}

function ajustarMinFechasOrden(fechaInicioExistente, fechaFinExistente) {
  const inpInicio = document.getElementById('o-fecha-inicio');
  const inpFin = document.getElementById('o-fecha-fin');
  if (fechaInicioExistente) inpInicio.value = fechaInicioExistente;
  if (fechaFinExistente) inpFin.value = fechaFinExistente;
}

function cerrarModalOrden() {
  document.getElementById('modal-orden').classList.remove('open');
}

async function guardarOrden() {
  const id = document.getElementById('orden-id').value;
  const idProducto = document.getElementById('o-producto').value;
  const cantidad = parseInt(document.getElementById('o-cantidad').value, 10);
  const descripcion = document.getElementById('o-descripcion').value.trim();
  const fechaInicio = document.getElementById('o-fecha-inicio').value;
  const fechaFin = document.getElementById('o-fecha-fin').value;
  const estado = document.getElementById('o-estado').value;

  limpiarValidacion(['o-producto', 'o-cantidad', 'o-fecha-inicio', 'o-fecha-fin']);
  let valido = true;
  if (!idProducto) { marcarError('o-producto'); valido = false; }
  if (!cantidad || cantidad < 1) { marcarError('o-cantidad'); valido = false; }
  if (!fechaInicio) { marcarError('o-fecha-inicio'); valido = false; }
  if (!fechaFin) { marcarError('o-fecha-fin'); valido = false; }
  if (!valido) return;

  const payload = {
    idProducto: parseInt(idProducto, 10),
    cantidadRequerida: cantidad,
    descripcion,
    fechaInicio,
    fechaEstimadaFin: fechaFin,
    estado,
  };

  const url = id ? `${API_BASE}/ordenes/${id}/` : `${API_BASE}/ordenes/`;
  const metodo = id ? 'PUT' : 'POST';

  try {
    await apiFetch(url, { method: metodo, body: JSON.stringify(payload) });
    mostrarToast(id ? 'Orden actualizada.' : 'Orden creada.');
    cerrarModalOrden();
    await cargarOrdenes();
  } catch (e) {
    mostrarToast(e.message, 'error');
  }
}

async function eliminarOrden(id) {
  if (!confirm('¿Eliminar esta orden de producción?')) return;
  try {
    await apiFetch(`${API_BASE}/ordenes/${id}/`, { method: 'DELETE' });
    mostrarToast('Orden eliminada.');
    await cargarOrdenes();
  } catch (e) {
    mostrarToast(e.message, 'error');
  }
}

// ── Modal de detalle grande, con pestañas ────────────
async function abrirModalDetalle(id) {
  let o;
  try {
    o = await apiFetch(`${API_BASE}/ordenes/${id}/`);
  } catch (e) {
    mostrarToast('No se pudo cargar el detalle de la orden.', 'error');
    return;
  }

  document.getElementById('detalle-titulo').textContent = `ORD-${String(o.idProduccion).padStart(5, '0')} — ${o.producto}`;
  document.getElementById('detalle-subtitulo').innerHTML =
    `${o.cantidadRequerida} unidades ${o.cliente ? '· ' + o.cliente : ''} ${badgeEstado(o.estado, o.atrasada)}`;
  document.getElementById('detalle-progress-fill').style.width = o.avancePct + '%';
  document.getElementById('detalle-progress-pct').textContent = o.avancePct + '%';

  // Panel Resumen
  document.getElementById('panel-resumen').innerHTML = `
    <div class="resumen-grid">
      <div><strong>Producto</strong><br>${o.producto}</div>
      <div><strong>Cantidad</strong><br>${o.cantidadRequerida} unidades</div>
      <div><strong>Fecha inicio</strong><br>${o.fechaInicio}</div>
      <div><strong>Entrega estimada</strong><br>${o.fechaEstimadaFin}</div>
      <div><strong>Fecha real de fin</strong><br>${o.fechaRealFin || '—'}</div>
      <div><strong>Cliente</strong><br>${o.cliente || '—'}</div>
      <div><strong>Descripción</strong><br>${o.descripcion || '—'}</div>
    </div>
  `;

  // Panel Etapas — timeline horizontal con colores reales
  const etapas = o.etapas || [];
  document.getElementById('panel-etapas').innerHTML = etapas.length
    ? `<div class="etapas-timeline">${etapas.map((e, i) => `
        <div class="etapa-item">
          <div class="etapa-marcador" style="background:${e.color}">
            ${e.estado === 'COMPLETADA' ? '✓' : (i === etapas.findIndex(x => x.estado !== 'COMPLETADA') ? '●' : '○')}
          </div>
          <div class="etapa-info">
            <div class="etapa-nombre">${e.nombre}</div>
            <div class="etapa-meta">${e.estado} · ${e.avancePct}% · ${e.completadas}/${e.totalTareas} tareas</div>
            <div class="etapa-operarios">${e.operarios.join(', ') || 'Sin operario asignado'}</div>
          </div>
        </div>
      `).join('')}</div>`
    : `<div class="empty-state">Esta orden todavía no tiene tareas asignadas por etapa.</div>`;

  // Panel Operarios (resumen por operario involucrado en esta orden)
  const operariosUnicos = [...new Set(etapas.flatMap(e => e.operarios))];
  document.getElementById('panel-operarios-tab').innerHTML = operariosUnicos.length
    ? `<ul class="lista-simple">${operariosUnicos.map(n => `<li>👤 ${n}</li>`).join('')}</ul>`
    : `<div class="empty-state">Sin operarios asignados todavía.</div>`;

  // Panel Historial — viene de django-simple-history
  const historial = o.historial || [];
  document.getElementById('panel-historial').innerHTML = historial.length
    ? `<div class="historial-lista">${historial.map(h => `
        <div class="historial-item">
          <span class="historial-fecha">${h.fecha}</span>
          <span class="historial-texto">Estado cambiado a <strong>${h.estado}</strong></span>
        </div>
      `).join('')}</div>`
    : `<div class="empty-state">Sin historial registrado todavía.</div>`;

  cambiarTabDetalle('resumen');

  document.getElementById('btn-editar-desde-detalle').onclick = () => {
    cerrarModalDetalle();
    editarOrden(o.idProduccion);
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

function renderOperarios(lista) {
  const cont = document.getElementById('operarios-grid');
  if (!lista.length) {
    cont.innerHTML = `<div class="empty-state">No hay operarios activos.</div>`;
    return;
  }

  cont.innerHTML = lista.map(op => `
    <div class="operario-card">
      <div class="operario-card-header">
        <span class="operario-nombre">👤 ${op.nombre}</span>
        <span class="operario-especialidad">${op.especialidad}</span>
      </div>
      <div class="progress-bar-track progress-bar-sm">
        <div class="progress-bar-fill" style="width:${op.avancePct}%"></div>
      </div>
      <div class="operario-contadores">
        <span>⏳ ${op.contadores.pendiente}</span>
        <span>⚙️ ${op.contadores.enProgreso}</span>
        <span>✅ ${op.contadores.completada}</span>
      </div>
      <div class="operario-tareas">
        ${op.tareas.slice(0, 4).map(t => `
          <div class="operario-tarea-row">
            <span>${t.nombreTarea} (${t.proceso || 'General'})</span>
            ${badgeEstado(t.estado === 'Completada' ? 'Completado' : t.estado, false)}
          </div>
        `).join('') || '<span class="empty-inline">Sin tareas asignadas.</span>'}
      </div>
    </div>
  `).join('');
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
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  cargarDashboard();
  cargarProductos();
});
