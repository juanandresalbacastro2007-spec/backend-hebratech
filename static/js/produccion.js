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
    if (el) el.min = hoy;
  });
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
// MÓDULO DE NOTIFICACIONES
// ============================================================
// Clave base en localStorage. Se combina con el userId para que
// cada administrador tenga su propio registro de leídas.
const NOTIF_STORAGE_KEY = 'ht_notif_leidas';
const NOTIF_SESSION_KEY = 'ht_notif_session_shown';

// Obtiene el userId desde el atributo data-user-id del body,
// o usa 'default' como fallback.
function getNotifUserId() {
  return document.body.dataset.userId || 'default';
}

function getNotifStorageKey() {
  return `${NOTIF_STORAGE_KEY}_${getNotifUserId()}`;
}

// Devuelve el Set de IDs de notificaciones ya leídas por este usuario.
function getNotifLeidas() {
  try {
    const raw = localStorage.getItem(getNotifStorageKey());
    return new Set(JSON.parse(raw) || []);
  } catch {
    return new Set();
  }
}

// Persiste el Set de leídas.
function guardarNotifLeidas(setLeidas) {
  localStorage.setItem(getNotifStorageKey(), JSON.stringify([...setLeidas]));
}

// Genera un ID estable para una alerta basado en su texto + tipo,
// para que la misma alerta no reaparezca entre recargas.
function generarNotifId(alerta) {
  return `${alerta.tipo}::${alerta.texto}`;
}

// Marca una o todas las notificaciones como leídas.
function marcarNotificacionLeida(id) {
  const leidas = getNotifLeidas();
  leidas.add(id);
  guardarNotifLeidas(leidas);
}

function marcarTodasLeidas(alertas) {
  const leidas = getNotifLeidas();
  alertas.forEach(a => leidas.add(generarNotifId(a)));
  guardarNotifLeidas(leidas);
  cerrarPanelNotificaciones();
  actualizarBadgeNotificaciones(0);
  renderNotificacionesDentroPanel([]);
}

// ── Badge del icono de notificaciones ─────────────────────
function actualizarBadgeNotificaciones(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── Panel lateral de notificaciones ───────────────────────
function abrirPanelNotificaciones() {
  const panel = document.getElementById('notif-panel');
  const overlay = document.getElementById('notif-overlay');
  if (panel) panel.classList.add('open');
  if (overlay) overlay.classList.add('open');
}

function cerrarPanelNotificaciones() {
  const panel = document.getElementById('notif-panel');
  const overlay = document.getElementById('notif-overlay');
  if (panel) panel.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

// Renderiza las notificaciones dentro del panel lateral.
function renderNotificacionesDentroPanel(alertasNoLeidas) {
  const lista = document.getElementById('notif-lista');
  const emptyState = document.getElementById('notif-empty');
  const btnMarcarTodas = document.getElementById('notif-btn-marcar-todas');
  if (!lista) return;

  if (!alertasNoLeidas.length) {
    lista.innerHTML = '';
    if (emptyState) emptyState.style.display = 'flex';
    if (btnMarcarTodas) btnMarcarTodas.style.display = 'none';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (btnMarcarTodas) btnMarcarTodas.style.display = 'inline-flex';

  const iconoMap = {
    danger:  { icon: 'bi-exclamation-octagon-fill', label: 'Crítico' },
    warning: { icon: 'bi-exclamation-triangle-fill', label: 'Advertencia' },
    info:    { icon: 'bi-info-circle-fill', label: 'Info' },
    success: { icon: 'bi-check-circle-fill', label: 'OK' },
  };

  lista.innerHTML = alertasNoLeidas.map(a => {
    const id = generarNotifId(a);
    const meta = iconoMap[a.tipo] || iconoMap.info;
    return `
      <div class="notif-item notif-item--${a.tipo}" data-id="${CSS.escape(id)}">
        <div class="notif-item-icon">
          <i class="bi ${meta.icon}"></i>
        </div>
        <div class="notif-item-body">
          <span class="notif-item-texto">${a.texto}</span>
          <span class="notif-item-tipo">${a.icono || ''} ${meta.label}</span>
        </div>
        <button class="notif-item-cerrar" title="Marcar como leída"
                onclick="marcarUnaYRefrescar('${id.replace(/'/g, "\\'")}')">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    `;
  }).join('');
}

// Marca una sola notificación como leída y refresca el panel sin llamar a la API.
function marcarUnaYRefrescar(id) {
  marcarNotificacionLeida(id);

  // Eliminar del DOM con animación
  const item = document.querySelector(`.notif-item[data-id="${CSS.escape(id)}"]`);
  if (item) {
    item.style.transition = 'opacity .25s, transform .25s';
    item.style.opacity = '0';
    item.style.transform = 'translateX(16px)';
    setTimeout(() => item.remove(), 260);
  }

  // Actualizar badge
  const badge = document.getElementById('notif-badge');
  const actual = parseInt(badge?.textContent || '0', 10);
  const nuevo = Math.max(0, actual - 1);
  actualizarBadgeNotificaciones(nuevo);

  // Si no quedan items, mostrar empty state
  setTimeout(() => {
    const lista = document.getElementById('notif-lista');
    if (lista && lista.children.length === 0) {
      const emptyState = document.getElementById('notif-empty');
      const btnMarcarTodas = document.getElementById('notif-btn-marcar-todas');
      if (emptyState) emptyState.style.display = 'flex';
      if (btnMarcarTodas) btnMarcarTodas.style.display = 'none';
    }
  }, 300);
}

// Crea el panel y el overlay en el DOM si aún no existen.
function inicializarPanelNotificaciones() {
  if (document.getElementById('notif-panel')) return;

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = 'notif-overlay';
  overlay.className = 'notif-overlay';
  overlay.addEventListener('click', cerrarPanelNotificaciones);
  document.body.appendChild(overlay);

  // Panel
  const panel = document.createElement('div');
  panel.id = 'notif-panel';
  panel.className = 'notif-panel';
  panel.innerHTML = `
    <div class="notif-panel-header">
      <div class="notif-panel-titulo">
        <i class="bi bi-bell-fill"></i>
        <span>Notificaciones</span>
      </div>
      <div class="notif-panel-acciones">
        <button id="notif-btn-marcar-todas" class="notif-btn-texto" style="display:none;"
                onclick="_marcarTodasDesdePanel()">
          Marcar todas como leídas
        </button>
        <button class="notif-panel-cerrar" onclick="cerrarPanelNotificaciones()" title="Cerrar">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </div>
    <div id="notif-lista" class="notif-lista"></div>
    <div id="notif-empty" class="notif-empty" style="display:none;">
      <i class="bi bi-bell-slash"></i>
      <span>Sin notificaciones pendientes</span>
    </div>
  `;
  document.body.appendChild(panel);

  // Cerrar con Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cerrarPanelNotificaciones();
  });
}

// Wrapper para "marcar todas" que accede a la caché actual.
function _marcarTodasDesdePanel() {
  marcarTodasLeidas(window._HT_ALERTAS_CACHE || []);
}

// Inyecta el botón de notificaciones en el topbar.
function inyectarBotonNotificaciones() {
  if (document.getElementById('notif-trigger')) return;
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'notif-trigger-wrapper ms-auto';
  wrapper.innerHTML = `
    <button id="notif-trigger" class="notif-trigger" title="Notificaciones"
            onclick="abrirPanelNotificaciones()">
      <i class="bi bi-bell-fill"></i>
      <span id="notif-badge" class="notif-badge" style="display:none;">0</span>
    </button>
  `;
  topbar.appendChild(wrapper);
}

// Inyecta los estilos CSS del módulo de notificaciones.
function inyectarEstilosNotificaciones() {
  if (document.getElementById('notif-styles')) return;
  const style = document.createElement('style');
  style.id = 'notif-styles';
  style.textContent = `
    /* ── Trigger button ── */
    .notif-trigger-wrapper { display:flex; align-items:center; }
    .notif-trigger {
      position: relative;
      background: none;
      border: none;
      cursor: pointer;
      width: 40px; height: 40px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.15rem;
      color: var(--primary, #395B64);
      transition: background .18s;
    }
    .notif-trigger:hover { background: rgba(57,91,100,.10); }
    [data-bs-theme="dark"] .notif-trigger { color: #e2e8f0; }
    [data-bs-theme="dark"] .notif-trigger:hover { background: rgba(255,255,255,.08); }

    /* ── Badge ── */
    .notif-badge {
      position: absolute;
      top: 4px; right: 4px;
      background: #ef4444;
      color: #fff;
      font-size: 10px; font-weight: 700;
      min-width: 17px; height: 17px;
      border-radius: 999px;
      display: flex; align-items: center; justify-content: center;
      padding: 0 3px;
      border: 2px solid #fff;
      pointer-events: none;
      line-height: 1;
    }
    [data-bs-theme="dark"] .notif-badge { border-color: #1e293b; }

    /* ── Overlay ── */
    .notif-overlay {
      display: none;
      position: fixed; inset: 0;
      background: rgba(0,0,0,.22);
      z-index: 1300;
      backdrop-filter: blur(1px);
    }
    .notif-overlay.open { display: block; }

    /* ── Panel ── */
    .notif-panel {
      position: fixed;
      top: 0; right: 0;
      width: 360px; max-width: 95vw; height: 100%;
      background: #fff;
      box-shadow: -4px 0 32px rgba(0,0,0,.12);
      z-index: 1400;
      display: flex; flex-direction: column;
      transform: translateX(100%);
      transition: transform .28s cubic-bezier(.4,0,.2,1);
      border-left: 1px solid #e5e7eb;
    }
    .notif-panel.open { transform: translateX(0); }
    [data-bs-theme="dark"] .notif-panel {
      background: #1e293b;
      border-left-color: #334155;
    }

    /* ── Panel header ── */
    .notif-panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 16px 14px;
      border-bottom: 1px solid #e5e7eb;
      gap: 8px; flex-shrink: 0;
    }
    [data-bs-theme="dark"] .notif-panel-header { border-bottom-color: #334155; }
    .notif-panel-titulo {
      display: flex; align-items: center; gap: 8px;
      font-size: .95rem; font-weight: 700;
      color: var(--primary, #395B64);
    }
    [data-bs-theme="dark"] .notif-panel-titulo { color: #7dd3fc; }
    .notif-panel-acciones { display:flex; align-items:center; gap:6px; }
    .notif-btn-texto {
      background: none; border: none; cursor: pointer;
      font-size: .75rem; font-weight: 600;
      color: #6b7280; text-decoration: underline;
      padding: 4px 6px; border-radius: 4px;
      transition: color .15s;
    }
    .notif-btn-texto:hover { color: var(--primary, #395B64); }
    .notif-panel-cerrar {
      background: none; border: none; cursor: pointer;
      width: 30px; height: 30px; border-radius: 50%;
      display: flex; align-items:center; justify-content:center;
      font-size: .9rem; color: #9ca3af;
      transition: background .15s, color .15s;
    }
    .notif-panel-cerrar:hover { background:#f3f4f6; color:#374151; }
    [data-bs-theme="dark"] .notif-panel-cerrar:hover { background:#334155; color:#e2e8f0; }

    /* ── Lista ── */
    .notif-lista {
      flex: 1; overflow-y: auto;
      padding: 10px 12px;
      display: flex; flex-direction: column; gap: 8px;
    }

    /* ── Item individual ── */
    .notif-item {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 12px 12px 12px 10px;
      border-radius: 10px;
      border-left: 3px solid transparent;
      background: #f8fafc;
      transition: background .15s;
    }
    [data-bs-theme="dark"] .notif-item { background: #0f172a; }
    .notif-item:hover { background: #f1f5f9; }
    [data-bs-theme="dark"] .notif-item:hover { background: #1e293b; }

    .notif-item--danger  { border-left-color: #ef4444; }
    .notif-item--warning { border-left-color: #f59e0b; }
    .notif-item--info    { border-left-color: #3b82f6; }
    .notif-item--success { border-left-color: #22c55e; }

    .notif-item-icon {
      flex-shrink: 0; width: 32px; height: 32px;
      border-radius: 50%;
      display: flex; align-items:center; justify-content:center;
      font-size: .9rem;
    }
    .notif-item--danger  .notif-item-icon { background:#fef2f2; color:#ef4444; }
    .notif-item--warning .notif-item-icon { background:#fffbeb; color:#f59e0b; }
    .notif-item--info    .notif-item-icon { background:#eff6ff; color:#3b82f6; }
    .notif-item--success .notif-item-icon { background:#f0fdf4; color:#22c55e; }
    [data-bs-theme="dark"] .notif-item--danger  .notif-item-icon { background:rgba(239,68,68,.15); }
    [data-bs-theme="dark"] .notif-item--warning .notif-item-icon { background:rgba(245,158,11,.15); }
    [data-bs-theme="dark"] .notif-item--info    .notif-item-icon { background:rgba(59,130,246,.15); }
    [data-bs-theme="dark"] .notif-item--success .notif-item-icon { background:rgba(34,197,94,.15); }

    .notif-item-body {
      flex: 1; display:flex; flex-direction:column; gap:3px; min-width:0;
    }
    .notif-item-texto {
      font-size: .83rem; line-height: 1.4;
      color: #1e293b; font-weight: 500;
      word-break: break-word;
    }
    [data-bs-theme="dark"] .notif-item-texto { color: #e2e8f0; }
    .notif-item-tipo {
      font-size: .72rem; color: #94a3b8; text-transform: uppercase;
      letter-spacing: .03em; font-weight: 600;
    }
    .notif-item-cerrar {
      flex-shrink: 0; background: none; border: none;
      cursor: pointer; color: #cbd5e1; font-size: .75rem;
      width: 24px; height: 24px; border-radius: 50%;
      display: flex; align-items:center; justify-content:center;
      transition: background .15s, color .15s; margin-top: 2px;
    }
    .notif-item-cerrar:hover { background:#e2e8f0; color:#475569; }
    [data-bs-theme="dark"] .notif-item-cerrar:hover { background:#334155; color:#cbd5e1; }

    /* ── Empty state ── */
    .notif-empty {
      flex: 1; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 12px; padding: 40px 20px;
      color: #94a3b8; text-align: center;
    }
    .notif-empty i { font-size: 2.2rem; opacity: .5; }
    .notif-empty span { font-size: .87rem; font-weight: 500; }

    /* ── Animación de entrada de badge ── */
    @keyframes notif-pop {
      0%   { transform: scale(.5); opacity: 0; }
      70%  { transform: scale(1.15); }
      100% { transform: scale(1);  opacity: 1; }
    }
    .notif-badge { animation: notif-pop .3s ease; }
  `;
  document.head.appendChild(style);
}

// ── Procesamiento principal de alertas ────────────────────
function procesarAlertas(alertas) {
  const leidas = getNotifLeidas();
  const noLeidas = alertas.filter(a => !leidas.has(generarNotifId(a)));

  // Cachear para uso en "marcar todas"
  window._HT_ALERTAS_CACHE = alertas;

  // Badge
  actualizarBadgeNotificaciones(noLeidas.length);

  // Render en panel
  renderNotificacionesDentroPanel(noLeidas);

  // También actualizar la zona de alertas del dashboard (solo no leídas, sin botón de cierre)
  const cont = document.getElementById('dashboard-alertas');
  if (cont) {
    if (noLeidas.length === 0) {
      cont.innerHTML = '';
    } else {
      cont.innerHTML = noLeidas.map(a => `
        <div class="alerta-banner alerta-${a.tipo}">
          <span>${a.icono}</span> ${a.texto}
        </div>
      `).join('');
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

    procesarAlertas(d.alertas || []);
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

  if (fechaEntrega && fechaEntrega < hoyISO()) {
    mostrarToast('La fecha de entrega no puede ser anterior a hoy.', 'error');
    return;
  }

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

  const hoy = hoyISO();
  limpiarValidacion(['op-producto', 'op-cantidad', 'op-cliente', 'op-fecha-inicio', 'op-fecha-entrega']);
  let valido = true;
  if (!idProducto) { marcarError('op-producto'); valido = false; }
  if (!cantidad || cantidad < 1) { marcarError('op-cantidad'); valido = false; }
  if (!clienteNombre) { marcarError('op-cliente'); valido = false; }
  if (!fechaInicio) { marcarError('op-fecha-inicio'); valido = false; }
  else if (fechaInicio < hoy) { marcarError('op-fecha-inicio'); mostrarToast('La fecha de inicio no puede ser anterior a hoy.', 'error'); valido = false; }
  if (!fechaEntrega) { marcarError('op-fecha-entrega'); valido = false; }
  else if (fechaEntrega < hoy) { marcarError('op-fecha-entrega'); mostrarToast('La fecha de entrega no puede ser anterior a hoy.', 'error'); valido = false; }
  else if (fechaInicio && fechaEntrega < fechaInicio) { marcarError('op-fecha-entrega'); mostrarToast('La fecha de entrega no puede ser anterior a la fecha de inicio.', 'error'); valido = false; }
  if (fechaFinReal && fechaFinReal < hoy) { mostrarToast('La fecha fin real no puede ser anterior a hoy.', 'error'); valido = false; }
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
  // Módulo de notificaciones — se inicializa antes del dashboard
  inyectarEstilosNotificaciones();
  inyectarBotonNotificaciones();
  inicializarPanelNotificaciones();

  aplicarMinFechaHoy();
  cargarDashboard();
  cargarOrdenesCliente();
  cargarProductosLista();
  cargarClientes();
  cargarOperarios();
});