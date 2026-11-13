/* ============================================================
   cliente.js — HebraTech Portal de Clientes
   ============================================================ */

'use strict';

/* ══════════════════════════════════════════════════════════════
   1. RELOJ EN TIEMPO REAL
══════════════════════════════════════════════════════════════ */
function actualizarReloj() {
  const ahora = new Date();
  const h = String(ahora.getHours()).padStart(2, '0');
  const m = String(ahora.getMinutes()).padStart(2, '0');
  const s = String(ahora.getSeconds()).padStart(2, '0');
  const clockEl = document.getElementById('clockDisplay');
  const dateEl = document.getElementById('dateDisplay');
  if (clockEl) clockEl.textContent = `${h}:${m}:${s}`;
  if (dateEl) {
    const opcionesFecha = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
    dateEl.textContent = ahora.toLocaleDateString('es-CO', opcionesFecha).toUpperCase();
  }
}
actualizarReloj();
setInterval(actualizarReloj, 1000);

/* ══════════════════════════════════════════════════════════════
   2. VALIDACIÓN — MODAL NUEVA ORDEN
══════════════════════════════════════════════════════════════ */
document.querySelectorAll('.needs-validation').forEach(function (form) {
  if (form.id === 'formNuevaOrden' || form.id === 'formCotizacion') return;
  form.addEventListener('submit', function (e) {
    if (!form.checkValidity()) {
      e.preventDefault();
      e.stopPropagation();
    }
    form.classList.add('was-validated');
  });
});

/* ══════════════════════════════════════════════════════════════
   3. MODAL COTIZACIÓN — precios y subtotal
══════════════════════════════════════════════════════════════ */
const formatterCOP = new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', minimumFractionDigits: 0,
});

function getCsrfCookie() {
  const c = document.cookie.split(';').find(x => x.trim().startsWith('csrftoken='));
  return c ? c.split('=')[1] : '';
}

function calcularCotizacion() {
  const prendaEl = document.getElementById('quotePrenda');
  const cantidadEl = document.getElementById('quoteCantidad');
  const precioEl = document.getElementById('quotePrecioUnitario');
  const subtotalEl = document.getElementById('quoteSubtotalDisplay');
  if (!prendaEl || !cantidadEl) return;
  const opcion = prendaEl.options[prendaEl.selectedIndex];
  const precio = opcion ? parseFloat(opcion.getAttribute('data-precio')) || 0 : 0;
  const cantidad = parseInt(cantidadEl.value) || 0;
  if (precioEl) precioEl.value = precio > 0 ? precio.toLocaleString('es-CO') : '';
  if (subtotalEl) subtotalEl.textContent = formatterCOP.format(precio * cantidad);
}

document.getElementById('quotePrenda')?.addEventListener('change', calcularCotizacion);
document.getElementById('quoteCantidad')?.addEventListener('input', calcularCotizacion);

document.getElementById('modalProducto')?.addEventListener('change', actualizarPrecio);
document.getElementById('modalCantidad')?.addEventListener('input', actualizarSubtotalOrden);

const formCotizacion = document.getElementById('formCotizacion');
if (formCotizacion) {
  formCotizacion.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!formCotizacion.checkValidity()) {
      formCotizacion.classList.add('was-validated'); return;
    }
    const url = formCotizacion.dataset.url;
    const btnSubmit = formCotizacion.querySelector('button[type="submit"]');
    const labelOriginal = btnSubmit ? btnSubmit.innerHTML : '';
    if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Enviando...'; }

    try {
      const resp = await fetch(url, {
        method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': getCsrfCookie() }, body: new FormData(formCotizacion),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'No se pudo generar la cotización.');
      bootstrap.Modal.getInstance(document.getElementById('quoteModal'))?.hide();
      mostrarToast({
        tipo: 'success', icono: 'bi-file-earmark-check', titulo: 'Cotización enviada',
        mensaje: data.mensaje || 'La solicitud se registró.', accion: null,
      });
      formCotizacion.reset();
      formCotizacion.classList.remove('was-validated');
      const subtotalEl = document.getElementById('quoteSubtotalDisplay');
      if (subtotalEl) subtotalEl.textContent = '$0';
      const precioEl = document.getElementById('quotePrecioUnitario');
      if (precioEl) precioEl.value = '';
      setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      mostrarToast({ tipo: 'error', icono: 'bi-exclamation-triangle', titulo: 'Error', mensaje: err.message, accion: null });
    } finally {
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   4. MODAL NUEVA ORDEN — precio y subtotal
══════════════════════════════════════════════════════════════ */
let precioModalOrden = 0;

function parsearPrecio(raw) {
  if (!raw) return 0;
  var s = String(raw).trim();
  if (s.includes('.') && s.includes(',')) { s = s.replace(/\./g, '').replace(',', '.'); return Math.round(parseFloat(s)) || 0; }
  if (s.includes(',')) { s = s.replace(',', '.'); return Math.round(parseFloat(s)) || 0; }
  if (/\.\d{3}$/.test(s)) { return parseInt(s.replace('.', ''), 10) || 0; }
  return Math.round(parseFloat(s)) || 0;
}

function actualizarPrecio() {
  const sel = document.getElementById('modalProducto');
  const dispEl = document.getElementById('modalPrecioDisplay');
  if (!sel) return;
  const opcion = sel.options[sel.selectedIndex];
  precioModalOrden = opcion?.value ? parsearPrecio(opcion.getAttribute('data-precio')) : 0;
  if (dispEl) dispEl.value = precioModalOrden > 0 ? precioModalOrden.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '';
  actualizarSubtotalOrden();
}

function actualizarSubtotalOrden() {
  const cant = parseInt(document.getElementById('modalCantidad')?.value) || 0;
  const el = document.getElementById('modalSubtotalDisplay');
  if (el) el.textContent = cant > 0 && precioModalOrden > 0 ? '$' + (cant * precioModalOrden).toLocaleString('es-CO', { minimumFractionDigits: 0 }) : '$0';
}

/* ══════════════════════════════════════════════════════════════
   5. TOAST — sistema de notificaciones flotantes
══════════════════════════════════════════════════════════════ */
function mostrarToast(notif, delay = 0) {
  setTimeout(() => {
    const id = 'toast-' + Date.now() + Math.random().toString(36).slice(2);
    const duracion = 6000;
    const accionHtml = notif.accion ? `<button class="ht-toast-action" onclick="document.getElementById('${id}').remove(); bootstrap.Modal.getOrCreateInstance(document.getElementById('${notif.accion.modal}')).show();">${notif.accion.texto} →</button>` : '';
    const el = document.createElement('div');
    el.className = 'ht-toast';
    el.id = id;
    el.innerHTML = `
      <div class="ht-toast-icon ${notif.tipo}"><i class="bi ${notif.icono}"></i></div>
      <div class="ht-toast-body">
        <div class="ht-toast-title">${notif.titulo}</div>
        <div class="ht-toast-msg">${notif.mensaje}</div>
        ${accionHtml}
      </div>
      <button class="ht-toast-close" onclick="cerrarToast('${id}')"><i class="bi bi-x"></i></button>
      <div class="ht-toast-progress" id="prog-${id}" style="width:100%;"></div>
    `;
    document.getElementById('toastContainer')?.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    const prog = document.getElementById('prog-' + id);
    if (prog) { prog.style.transition = `width ${duracion}ms linear`; setTimeout(() => { prog.style.width = '0%'; }, 50); }
    setTimeout(() => cerrarToast(id), duracion);
  }, delay);
}

function cerrarToast(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.replace('show', 'hide');
  setTimeout(() => el.remove(), 400);
}

/* ══════════════════════════════════════════════════════════════
   6. BIENVENIDA FLOTANTE
══════════════════════════════════════════════════════════════ */
function mostrarBienvenida(nombre) {
  const hora = new Date().getHours();
  const momento = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
  const id = 'toast-welcome-' + Date.now();
  const duracion = 5500;
  const el = document.createElement('div');
  el.className = 'ht-toast ht-toast--welcome';
  el.id = id;
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <div class="ht-toast-icon"><span class="ht-welcome-wave">👋</span></div>
    <div class="ht-toast-body">
      <div class="ht-toast-title"></div>
      <div class="ht-toast-msg"></div>
    </div>
    <button type="button" class="ht-toast-close" aria-label="Cerrar"><i class="bi bi-x"></i></button>
    <div class="ht-toast-progress" id="prog-${id}" style="width:100%;"></div>
  `;
  el.querySelector('.ht-toast-title').textContent = '¡Hola, ' + nombre + '!';
  el.querySelector('.ht-toast-msg').textContent = momento + '. Bienvenido/a a tu portal de clientes HebraTech.';
  el.querySelector('.ht-toast-close').addEventListener('click', () => cerrarToast(id));
  document.getElementById('toastContainer')?.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  const prog = document.getElementById('prog-' + id);
  if (prog) { prog.style.transition = `width ${duracion}ms linear`; setTimeout(() => { prog.style.width = '0%'; }, 50); }
  setTimeout(() => cerrarToast(id), duracion);
}

/* ══════════════════════════════════════════════════════════════
   7. CONTACTO Y SOPORTE
══════════════════════════════════════════════════════════════ */
function enviarContacto() {
  const asunto = document.getElementById('contactAsunto')?.value;
  const mensaje = document.getElementById('contactMensaje')?.value.trim();
  if (!asunto || !mensaje) {
    mostrarToast({ tipo: 'warning', icono: 'bi-exclamation-circle', titulo: 'Campos requeridos', mensaje: 'Selecciona un asunto y escribe tu mensaje.', accion: null });
    return;
  }
  const pedido = document.getElementById('contactPedido')?.value || '';
  const pedidoText = pedido ? `\nPedido: ${pedido}` : '';
  const subject = encodeURIComponent(`[Portal Cliente] ${asunto}${pedido ? ' — ' + pedido : ''}`);
  const body = encodeURIComponent(`Asunto: ${asunto}${pedidoText}\n\n${mensaje}`);
  window.location.href = `mailto:produccion@hebratech.com?subject=${subject}&body=${body}`;
  document.getElementById('contactFormWrap')?.classList.add('d-none');
  document.getElementById('contactConfirm')?.classList.remove('d-none');
}

function resetContactForm() {
  ['contactAsunto', 'contactPedido', 'contactMensaje'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const label = document.getElementById('contactFileLabel');
  if (label) label.textContent = 'Sin archivos';
  document.getElementById('contactFormWrap')?.classList.remove('d-none');
  document.getElementById('contactConfirm')?.classList.add('d-none');
}

/* ══════════════════════════════════════════════════════════════
   8. SISTEMA DE NOTIFICACIONES (HT_ClientNotif)
══════════════════════════════════════════════════════════════ */
window.HT_ClientNotif = (function () {
  'use strict';

  let alertas = [];
  let ui = null;
  let pollTimer = null;
  const POLL_MS = 30000;

  const TIPOS = {
    orden:   { icon: 'bi-box-seam-fill',    label: 'Orden',   color: 'orden' },
    factura: { icon: 'bi-receipt',          label: 'Factura', color: 'factura' },
    sistema: { icon: 'bi-info-circle-fill', label: 'Sistema', color: 'sistema' }
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getCsrf = () => {
    const c = document.cookie.split(';').find(x => x.trim().startsWith('csrftoken='));
    return c ? c.split('=')[1] : '';
  };

  function render() {
    if (!ui) return;
    const nuevas = alertas.filter(a => !a.leida);
    const leidas = alertas.filter(a => a.leida);
    
    const n = nuevas.length;
    ui.badge.hidden = n === 0;
    ui.badge.textContent = n > 9 ? '9+' : n;
    ui.btn.setAttribute('aria-label', n ? `Notificaciones, ${n} sin leer` : 'Notificaciones, sin novedades');
    ui.btn.classList.toggle('has-unread', n > 0);
    ui.markAllBtn.hidden = n === 0;

    const lista = [...nuevas, ...leidas];
    ui.empty.hidden = lista.length > 0;

    ui.list.innerHTML = lista.map(a => {
      const t = TIPOS[a.tipo] || TIPOS.sistema;
      
      // Se usa la URL que viene desde el backend, o /clientes/ por defecto.
      return `
        <li class="ht-notif-item ht-notif--${t.color} ${a.leida ? 'is-read' : ''}" data-id="${a.id}">
          <button type="button" class="ht-notif-main" data-action="abrir" data-url="${a.url || '/clientes/'}">
            <span class="ht-notif-ico"><i class="bi ${t.icon}"></i></span>
            <span class="ht-notif-body">
              <span class="ht-notif-txt"><strong>${esc(a.titulo)}</strong><br>${esc(a.mensaje)}</span>
              <span class="ht-notif-meta">${a.fecha} · <b>Ver detalle →</b></span>
            </span>
          </button>
          <button type="button" class="ht-notif-toggle" data-action="${a.leida ? 'no-leida' : 'leida'}" title="${a.leida ? 'Marcar como no leída' : 'Marcar como leída'}">
            <i class="bi ${a.leida ? 'bi-arrow-counterclockwise' : 'bi-check2'}"></i>
          </button>
        </li>`;
    }).join('');
  }

  function abrir() { ui.panel.hidden = false; ui.btn.setAttribute('aria-expanded', 'true'); }
  function cerrar(devolverFoco) { if (ui.panel.hidden) return; ui.panel.hidden = true; ui.btn.setAttribute('aria-expanded', 'false'); if (devolverFoco) ui.btn.focus(); }

  async function fetchNotificaciones() {
    const url = ui.mount.dataset.url;
    if (!url) return;
    try {
      const r = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      alertas = data.notificaciones || [];
      render();
    } catch (e) {
      console.warn('[HebraTech] notificaciones:', e);
    }
  }

  async function marcar(id, leida) {
    const url = `/clientes/notificaciones/${id}/leer/`;
    try {
      await fetch(url, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': getCsrf() } });
      fetchNotificaciones();
    } catch (e) { console.warn('[HebraTech] marcar leída:', e); }
  }

  async function marcarTodas() {
    const url = `/clientes/notificaciones/0/leer/`;
    try {
      await fetch(url, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': getCsrf() } });
      fetchNotificaciones();
    } catch (e) { console.warn('[HebraTech] marcar todas:', e); }
  }

  function build() {
    if (ui) return;
    const mount = document.getElementById('notifMount');
    if (!mount) return;

    mount.classList.add('ht-notif');
    mount.innerHTML = `
      <button type="button" class="ht-notif-btn" id="htNotifBtn" aria-haspopup="dialog" aria-expanded="false" aria-controls="htNotifPanel" aria-label="Notificaciones">
        <i class="bi bi-bell-fill"></i>
        <span class="ht-notif-badge" hidden>0</span>
      </button>
      <div class="ht-notif-panel" id="htNotifPanel" role="dialog" aria-label="Notificaciones" hidden>
        <div class="ht-notif-head">
          <strong>Notificaciones</strong>
          <button type="button" class="ht-notif-link" data-action="todas" hidden>Marcar todas leídas</button>
        </div>
        <ul class="ht-notif-list"></ul>
        <div class="ht-notif-empty" hidden><i class="bi bi-bell-slash"></i><span>Sin notificaciones nuevas</span></div>
      </div>`;

    ui = {
      mount, btn: mount.querySelector('.ht-notif-btn'), badge: mount.querySelector('.ht-notif-badge'),
      panel: mount.querySelector('.ht-notif-panel'), list: mount.querySelector('.ht-notif-list'),
      empty: mount.querySelector('.ht-notif-empty'), markAllBtn: mount.querySelector('[data-action="todas"]')
    };

    ui.btn.addEventListener('click', e => { e.stopPropagation(); ui.panel.hidden ? abrir() : cerrar(); });
    
    ui.panel.addEventListener('click', e => {
      e.stopPropagation();
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const item = el.closest('.ht-notif-item');
      const id = item && item.dataset.id;

      if (el.dataset.action === 'todas') { marcarTodas(); }
      else if (el.dataset.action === 'leida') { marcar(id, true); }
      else if (el.dataset.action === 'no-leida') { marcar(id, false); }
      else if (el.dataset.action === 'abrir') {
        marcar(id, true);
        if (el.dataset.url) window.location.href = el.dataset.url;
      }
    });

    document.addEventListener('click', () => cerrar());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(true); });

    fetchNotificaciones();
    pollTimer = setInterval(fetchNotificaciones, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchNotificaciones(); });
  }

  return { init: build };
})();

/* ══════════════════════════════════════════════════════════════
   9. INICIALIZACIÓN FINAL Y POLLING DE ÓRDENES
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function () {
  HT_ClientNotif.init();

  function actualizarTablaOrdenes() {
    fetch("/clientes/actualizar-ordenes/")
      .then(r => r.json())
      .then(data => {
        const contenedor = document.getElementById('contenedorOrdenes');
        if (contenedor && data.html) contenedor.innerHTML = data.html;
      })
      .catch(err => console.warn('Error actualizando órdenes:', err));
  }
  setInterval(actualizarTablaOrdenes, 30000);
});

/* ══════════════════════════════════════════════════════════════
   10. GESTIÓN DE SEDES (si se usa)
══════════════════════════════════════════════════════════════ */
let listaSedes = [
  { id: 1, nombre: 'Sede Principal - Norte',    direccion: 'Calle 100 #15-23, Piso 4',     ciudad: 'Bogotá, D.C.' },
  { id: 2, nombre: 'Centro de Distribución Sur', direccion: 'Av. Ciudad de Cali #32-10 Sur', ciudad: 'Bogotá, D.C.' },
];

function renderSedesTable() {
  const tbody = document.getElementById('tablaSedesBody');
  if (!tbody) return;
  tbody.innerHTML = listaSedes.map(s => `
    <tr>
      <td class="ps-3 fw-semibold text-dark">${s.nombre}</td>
      <td>${s.direccion}</td>
      <td>${s.ciudad}</td>
      <td class="text-end pe-3">
        <button class="btn btn-sm btn-link text-muted p-1 me-1" onclick="prepareEditSede(${s.id})" title="Editar"><i class="bi bi-pencil-square"></i></button>
        <button class="btn btn-sm btn-link text-danger p-1" onclick="deleteSede(${s.id})" title="Eliminar"><i class="bi bi-trash3"></i></button>
      </td>
    </tr>`).join('');
}

let sedeCollapse = null;
function _getCollapse() {
  if (!sedeCollapse) { const el = document.getElementById('formSedeCollapse'); if (el) sedeCollapse = new bootstrap.Collapse(el, { toggle: false }); }
  return sedeCollapse;
}
function showSedeForm() {
  document.getElementById('formSedeTitle').textContent = 'Nueva Sede de Despacho';
  ['sedeId', 'sedeNombre', 'sedeDireccion'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const ciudad = document.getElementById('sedeCiudad'); if (ciudad) ciudad.value = 'Bogotá, D.C.';
  _getCollapse()?.show();
}
function hideSedeForm() { _getCollapse()?.hide(); }
function prepareEditSede(id) {
  const s = listaSedes.find(x => x.id === id); if (!s) return;
  document.getElementById('formSedeTitle').textContent = 'Modificar Sede';
  document.getElementById('sedeId').value        = s.id;
  document.getElementById('sedeNombre').value    = s.nombre;
  document.getElementById('sedeDireccion').value = s.direccion;
  document.getElementById('sedeCiudad').value    = s.ciudad;
  _getCollapse()?.show();
}
function saveSedeData() {
  const idVal = document.getElementById('sedeId')?.value;
  const nombre = document.getElementById('sedeNombre')?.value.trim();
  const direccion = document.getElementById('sedeDireccion')?.value.trim();
  const ciudad = document.getElementById('sedeCiudad')?.value.trim();
  if (!nombre || !direccion || !ciudad) { alert('Por favor completa todos los campos.'); return; }
  if (!idVal) {
    const nuevoId = listaSedes.length ? Math.max(...listaSedes.map(s => s.id)) + 1 : 1;
    listaSedes.push({ id: nuevoId, nombre, direccion, ciudad });
    mostrarToast({ tipo: 'success', icono: 'bi-geo-alt-fill', titulo: 'Sede agregada', mensaje: nombre, accion: null });
  } else {
    const idx = listaSedes.findIndex(s => s.id === parseInt(idVal));
    if (idx !== -1) {
      listaSedes[idx] = { id: parseInt(idVal), nombre, direccion, ciudad };
      mostrarToast({ tipo: 'success', icono: 'bi-pencil-square', titulo: 'Sede actualizada', mensaje: nombre, accion: null });
    }
  }
  hideSedeForm(); renderSedesTable();
}
function deleteSede(id) {
  const s = listaSedes.find(x => x.id === id);
  if (!s || !confirm(`¿Eliminar la sede "${s.nombre}"?`)) return;
  listaSedes = listaSedes.filter(x => x.id !== id);
  renderSedesTable();
  mostrarToast({ tipo: 'warning', icono: 'bi-trash3', titulo: 'Sede eliminada', mensaje: s.nombre, accion: null });
}

/* ══════════════════════════════════════════════════════════════
   11. CALENDARIO (DateRangePicker)
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function () {
  renderSedesTable();
  if (window.jQuery && jQuery.fn.daterangepicker) {
    moment.locale('es');
    const pickerInput = $('#o-fecha-rango');
    pickerInput.daterangepicker({
      autoUpdateInput: false,
      minDate: moment().startOf('day'),
      locale: {
        format: 'YYYY-MM-DD', applyLabel: 'Aplicar', cancelLabel: 'Limpiar',
        fromLabel: 'Desde', toLabel: 'Hasta', firstDay: 1,
        daysOfWeek: ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'],
        monthNames: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
      },
      isCustomDate: function(date) {
        const drp = pickerInput.data('daterangepicker');
        if (!drp || !drp.startDate || !drp.endDate) return '';
        const start = drp.startDate; const end = drp.endDate;
        if (start.isSame(end, 'day')) return '';
        if (date.isSame(start, 'day') || date.isSame(end, 'day')) return '';
        const totalDays = end.diff(start, 'days') + 1;
        const chunk = Math.floor(totalDays / 3);
        const remainder = totalDays % 3;
        const duracion1 = chunk + (remainder > 0 ? 1 : 0);
        const duracion2 = chunk + (remainder > 1 ? 1 : 0);
        const e1End = start.clone().add(duracion1 - 1, 'days');
        const e2Start = e1End.clone().add(1, 'days');
        const e2End = e2Start.clone().add(duracion2 - 1, 'days');
        const e3Start = e2End.clone().add(1, 'days');
        if (date.isBetween(start, e1End, 'day', '[]')) return 'etapa-1-bg';
        if (date.isBetween(e2Start, e2End, 'day', '[]')) return 'etapa-2-bg';
        if (date.isBetween(e3Start, end, 'day', '[]')) return 'etapa-3-bg';
        return '';
      }
    });

    const drp = pickerInput.data('daterangepicker');
    function actualizarLeyendasFooter() {
      const footer = drp.container.find('.drp-buttons');
      footer.find('.etapas-legend-container').remove();
      const legendHTML = `
        <div class="etapas-legend-container">
          <span class="etapa-badge etapa-1">Etapa 1</span>
          <span class="etapa-badge etapa-2">Etapa 2</span>
          <span class="etapa-badge etapa-3">Etapa 3</span>
        </div>`;
      footer.prepend(legendHTML);
    }
    pickerInput.on('show.daterangepicker', actualizarLeyendasFooter);
    pickerInput.on('apply.daterangepicker', function(ev, picker) {
      $(this).val(picker.startDate.format('YYYY-MM-DD') + ' hasta ' + picker.endDate.format('YYYY-MM-DD'));
      this.dispatchEvent(new Event('change', { bubbles: true }));
      actualizarLeyendasFooter();
    });
    pickerInput.on('cancel.daterangepicker', function() {
      $(this).val('');
      drp.container.find('.etapas-legend-container').remove();
    });
  }
});