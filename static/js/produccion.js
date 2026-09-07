// ============================================================
// HebraTech — Centro de Control de Producción
// ============================================================

const API_BASE = '/produccion';
let PRODUCTOS_CACHE = [];
let ORDENES_PROD_CACHE = [];
let ORDENES_CLIENTE_CACHE = [];
let OPERARIOS_CACHE = [];
let PRODUCTOS_LISTA_CACHE = [];
let CLIENTES_CACHE = [];
let FILTRO_ACTUAL = '';
let calendar = null;

// ── Utilidades ─────────────────────────────
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

function formatearFecha(fechaStr) {
  if (!fechaStr) return '—';
  const fecha = new Date(fechaStr);
  return fecha.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
}

function switchTab(nombre, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + nombre).classList.add('active');

  if (nombre === 'clientes' && ORDENES_CLIENTE_CACHE.length === 0) cargarOrdenesCliente();
  if (nombre === 'ordenes' && ORDENES_PROD_CACHE.length === 0) cargarOrdenesProduccion();
  if (nombre === 'productos' && PRODUCTOS_CACHE.length === 0) cargarProductos();
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

// ============================================================
// ÓRDENES DE CLIENTE
// ============================================================
async function cargarOrdenesCliente() {
  try {
    ORDENES_CLIENTE_CACHE = await apiFetch(`${API_BASE}/ordenes-cliente/`);
    renderOrdenesCliente(ORDENES_CLIENTE_CACHE);
    poblarSelectOrdenesCliente();
  } catch (e) {
    mostrarToast('No se pudieron cargar las órdenes de clientes.', 'error');
  }
}

function renderOrdenesCliente(lista) {
  const tbody = document.getElementById('tbody-clientes');
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No hay órdenes de clientes.</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map(o => `
    <tr>
      <td><strong>#${o.idOrden}</strong></td>
      <td>${o.cliente}</td>
      <td>${formatearFecha(o.fechaPedido)}</td>
      <td>${formatearFecha(o.fechaEntrega)}</td>
      <td><span class="badge ${estadoClienteBadge(o.estado)}">${o.estado}</span></td>
      <td>
        <button class="action-btn edit" onclick="editarCliente(${o.idOrden})">✏️</button>
      </td>
    </tr>
  `).join('');
}

function estadoClienteBadge(estado) {
  const map = {
    'Pendiente': 'badge-gris',
    'En Proceso': 'badge-azul',
    'Completado': 'badge-verde',
    'Cancelado': 'badge-rojo'
  };
  return map[estado] || 'badge-gris';
}

function filtrarOrdenesCliente() {
  const texto = (document.getElementById('search-clientes').value || '').toLowerCase();
  if (!texto) { renderOrdenesCliente(ORDENES_CLIENTE_CACHE); return; }
  const filtradas = ORDENES_CLIENTE_CACHE.filter(o =>
    o.cliente.toLowerCase().includes(texto) ||
    String(o.idOrden).includes(texto)
  );
  renderOrdenesCliente(filtradas);
}

function editarCliente(id) {
  const o = ORDENES_CLIENTE_CACHE.find(x => x.idOrden === id);
  if (!o) return;
  document.getElementById('cliente-id').value = o.idOrden;
  document.getElementById('c-estado').value = o.estado;
  document.getElementById('c-fecha-entrega').value = o.fechaEntrega || '';
  document.getElementById('modal-cliente').classList.add('open');
}

function cerrarModalCliente() {
  document.getElementById('modal-cliente').classList.remove('open');
}

async function guardarCliente() {
  const id = document.getElementById('cliente-id').value;
  const estado = document.getElementById('c-estado').value;
  const fechaEntrega = document.getElementById('c-fecha-entrega').value;

  try {
    await apiFetch(`${API_BASE}/ordenes-cliente/${id}/`, {
      method: 'PUT',
      body: JSON.stringify({ estado, fechaEntrega })
    });
    mostrarToast('Orden de cliente actualizada.');
    cerrarModalCliente();
    cargarOrdenesCliente();
  } catch (e) {
    mostrarToast(e.message, 'error');
  }
}

// ============================================================
// PRODUCTOS (gestión)
// ============================================================
async function cargarProductos() {
  try {
    PRODUCTOS_CACHE = await apiFetch(`${API_BASE}/productos/`);
    renderProductos(PRODUCTOS_CACHE);
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

function poblarSelectOrdenesCliente() {
  const select = document.getElementById('op-orden-cliente');
  if (!select) return;
  const seleccionado = select.value;
  select.innerHTML = `<option value="">-- Seleccionar orden de cliente --</option>` +
    ORDENES_CLIENTE_CACHE.map(o => `<option value="${o.idOrden}">#${o.idOrden} - ${o.cliente}</option>`).join('');
  if (seleccionado) select.value = seleccionado;
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
    'Atrasada':    'badge-rojo',
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
    <div class="orden-card ${o.estado === 'Atrasada' ? 'orden-card-atrasada' : ''}" onclick="abrirModalDetalle(${o.idOrdenProduccion})">
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
function abrirModalNuevaOrden(idOrden = null) {
  limpiarValidacion(['op-producto', 'op-cantidad', 'op-cliente', 'op-fecha-inicio', 'op-fecha-entrega']);
  document.getElementById('modal-orden-title').textContent = '🗒 Nueva Orden de Producción';
  document.getElementById('orden-id').value = '';
  document.getElementById('orden-cliente-id').value = idOrden || '';

  // Cargar datos en selects
  poblarSelectProductos();
  poblarSelectClientes();
  poblarSelectOrdenesCliente();

  // Limpiar campos
  document.getElementById('op-producto').value = '';
  document.getElementById('op-cantidad').value = 1;
  document.getElementById('op-cliente').value = '';
  document.getElementById('op-fecha-inicio').value = '';
  document.getElementById('op-fecha-entrega').value = '';
  document.getElementById('op-fecha-fin-real').value = '';
  document.getElementById('op-prioridad').value = 'Normal';
  document.getElementById('op-estado').value = 'Pendiente';
  document.getElementById('op-observaciones').value = '';
  document.getElementById('op-orden-cliente').value = '';

  // Si se pasa idOrden, autocompletar
  if (idOrden) {
    autocompletarDesdeOrdenCliente(idOrden);
  }

  document.getElementById('modal-orden').classList.add('open');
  enfocarPrimerCampo('op-producto');
}

// ── Autocompletar desde orden de cliente ────────────
async function autocompletarDesdeOrdenCliente(idOrden) {
  try {
    const data = await apiFetch(`${API_BASE}/orden-cliente/${idOrden}/`);
    // Cliente
    if (data.cliente) {
      const clienteSelect = document.getElementById('op-cliente');
      const clienteOpt = Array.from(clienteSelect.options).find(opt => opt.text === data.cliente);
      if (clienteOpt) {
        clienteSelect.value = clienteOpt.value;
      } else {
        const option = document.createElement('option');
        option.value = data.cliente;
        option.text = data.cliente;
        clienteSelect.add(option);
        clienteSelect.value = data.cliente;
      }
    }
    // Producto
    if (data.idProducto) {
      document.getElementById('op-producto').value = data.idProducto;
    } else if (data.nombreProducto) {
      const productoSelect = document.getElementById('op-producto');
      const prodOpt = Array.from(productoSelect.options).find(opt => opt.text === data.nombreProducto);
      if (prodOpt) {
        productoSelect.value = prodOpt.value;
      } else {
        const option = document.createElement('option');
        option.value = data.nombreProducto;
        option.text = data.nombreProducto;
        productoSelect.add(option);
        productoSelect.value = data.nombreProducto;
      }
    }
    // Cantidad
    if (data.cantidad) {
      document.getElementById('op-cantidad').value = data.cantidad;
    }
    // Fecha entrega
    if (data.fechaEntrega) {
      document.getElementById('op-fecha-entrega').value = data.fechaEntrega;
    }
    if (data.fechaPedido) {
      document.getElementById('op-fecha-inicio').value = data.fechaPedido;
    }
    mostrarToast('Datos de la orden de cliente cargados automáticamente.', 'info');
  } catch (e) {
    mostrarToast('Error al cargar datos de la orden de cliente.', 'error');
  }
}

// ── Evento change del selector de orden de cliente ──
document.addEventListener('DOMContentLoaded', () => {
  const selectOrdenCliente = document.getElementById('op-orden-cliente');
  if (selectOrdenCliente) {
    selectOrdenCliente.addEventListener('change', function() {
      const id = this.value;
      if (id) {
        autocompletarDesdeOrdenCliente(id);
      }
    });
  }
});

// ── Editar orden ──────────────────────────────────────
function editarOrden(id) {
  const o = ORDENES_PROD_CACHE.find(x => x.idOrdenProduccion === id);
  if (!o) return;
  limpiarValidacion(['op-producto', 'op-cantidad', 'op-cliente', 'op-fecha-inicio', 'op-fecha-entrega']);
  document.getElementById('modal-orden-title').textContent = `✏️ Editar Orden ${o.numero}`;
  document.getElementById('orden-id').value = o.idOrdenProduccion;
  document.getElementById('orden-cliente-id').value = o.idOrden || '';

  poblarSelectProductos();
  poblarSelectClientes();

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
  document.getElementById('op-fecha-entrega').value = o.fechaEntrega;
  document.getElementById('op-fecha-fin-real').value = o.fechaFinReal || '';
  document.getElementById('op-prioridad').value = o.prioridad;
  document.getElementById('op-estado').value = o.estado;
  document.getElementById('op-observaciones').value = o.observaciones || '';
  document.getElementById('op-orden-cliente').value = '';

  document.getElementById('modal-orden').classList.add('open');
}

function cerrarModalOrden() {
  document.getElementById('modal-orden').classList.remove('open');
}

async function guardarOrden() {
  const id = document.getElementById('orden-id').value;
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
  const idOrden = document.getElementById('orden-cliente-id').value || null;

  limpiarValidacion(['op-producto', 'op-cantidad', 'op-cliente', 'op-fecha-inicio', 'op-fecha-entrega']);
  let valido = true;
  if (!idProducto) { marcarError('op-producto'); valido = false; }
  if (!cantidad || cantidad < 1) { marcarError('op-cantidad'); valido = false; }
  if (!clienteNombre) { marcarError('op-cliente'); valido = false; }
  if (!fechaInicio) { marcarError('op-fecha-inicio'); valido = false; }
  if (!fechaEntrega) { marcarError('op-fecha-entrega'); valido = false; }
  if (!valido) return;

  const payload = {
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
  if (idOrden) payload.idOrden = parseInt(idOrden, 10);

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
            ${badgeEstado(t.estado)}
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
// INICIALIZACIÓN
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  cargarDashboard();
  cargarOrdenesCliente();
  cargarProductosLista();
  cargarClientes();
  cargarOperarios();
});