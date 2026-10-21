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
  const dateEl  = document.getElementById('dateDisplay');
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
  // formNuevaOrden y formCotizacion ya tienen su propio manejador de submit
  // (secciones 3 y 9b más abajo). Si este listener genérico también actúa
  // sobre ellos, cancela el submit incluso cuando el formulario es válido
  // y el POST real nunca llega al servidor.
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
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
});

function getCsrfCookie() {
  const c = document.cookie.split(';').find(x => x.trim().startsWith('csrftoken='));
  return c ? c.split('=')[1] : '';
}

function calcularCotizacion() {
  const prendaEl   = document.getElementById('quotePrenda');
  const cantidadEl = document.getElementById('quoteCantidad');
  const precioEl   = document.getElementById('quotePrecioUnitario');
  const subtotalEl = document.getElementById('quoteSubtotalDisplay');
  if (!prendaEl || !cantidadEl) return;

  // El value del <option> es el idProducto; el precio va en data-precio.
  const opcion   = prendaEl.options[prendaEl.selectedIndex];
  const precio   = opcion ? parseFloat(opcion.getAttribute('data-precio')) || 0 : 0;
  const cantidad = parseInt(cantidadEl.value) || 0;

  if (precioEl) {
    precioEl.value = precio > 0 ? precio.toLocaleString('es-CO') : '';
  }
  if (subtotalEl) {
    subtotalEl.textContent = formatterCOP.format(precio * cantidad);
  }
}

document.getElementById('quotePrenda')?.addEventListener('change', calcularCotizacion);
document.getElementById('quoteCantidad')?.addEventListener('input', calcularCotizacion);

// ── Modal Nueva Orden: sincronizar precio y subtotal ──────────
document.getElementById('modalProducto')?.addEventListener('change', actualizarPrecio);
document.getElementById('modalCantidad')?.addEventListener('input', actualizarSubtotalOrden);

const formCotizacion = document.getElementById('formCotizacion');
if (formCotizacion) {
  formCotizacion.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!formCotizacion.checkValidity()) {
      formCotizacion.classList.add('was-validated');
      return;
    }

    const url = formCotizacion.dataset.url;
    const btnSubmit = formCotizacion.querySelector('button[type="submit"]');
    const labelOriginal = btnSubmit ? btnSubmit.innerHTML : '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Enviando...';
    }

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': getCsrfCookie(),
        },
        body: new FormData(formCotizacion),
      });
      const data = await resp.json();

      if (!resp.ok || data.error) {
        throw new Error(data.error || 'No se pudo generar la cotización.');
      }

      bootstrap.Modal.getInstance(document.getElementById('quoteModal'))?.hide();

      mostrarToast({
        tipo: 'success', icono: 'bi-file-earmark-check',
        titulo: 'Cotización enviada',
        mensaje: data.mensaje || 'La solicitud se registró. Evaluaremos costos según tus especificaciones.',
        accion: null,
      });

      formCotizacion.reset();
      formCotizacion.classList.remove('was-validated');
      const subtotalEl = document.getElementById('quoteSubtotalDisplay');
      if (subtotalEl) subtotalEl.textContent = '$0';
      const precioEl = document.getElementById('quotePrecioUnitario');
      if (precioEl) precioEl.value = '';

      // Refrescamos la página para que 'Mis cotizaciones' muestre la nueva.
      setTimeout(() => window.location.reload(), 900);

    } catch (err) {
      mostrarToast({
        tipo: 'error', icono: 'bi-exclamation-triangle',
        titulo: 'Error al generar la cotización',
        mensaje: err.message || 'Intenta nuevamente en unos segundos.',
        accion: null,
      });
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = labelOriginal;
      }
    }
  });
}


/* ══════════════════════════════════════════════════════════════
   4. MODAL NUEVA ORDEN — precio y subtotal
══════════════════════════════════════════════════════════════ */
let precioModalOrden = 0;

/**
 * Parsea data-precio sea cual sea el formato que Django renderice:
 *   "85000"      → 85000
 *   "85000.00"   → 85000
 *   "85.000"     → 85000  (punto como separador de miles)
 *   "85.000,00"  → 85000  (es-CO)
 *   "85000,00"   → 85000
 */
function parsearPrecio(raw) {
  if (!raw) return 0;
  var s = String(raw).trim();
  if (s.includes('.') && s.includes(',')) {
    // es-CO: punto=miles, coma=decimal
    s = s.replace(/\./g, '').replace(',', '.');
    return Math.round(parseFloat(s)) || 0;
  }
  if (s.includes(',')) {
    // coma como decimal
    s = s.replace(',', '.');
    return Math.round(parseFloat(s)) || 0;
  }
  // Punto: detectar si es separador de miles (exactamente 3 dígitos al final)
  if (/\.\d{3}$/.test(s)) {
    return parseInt(s.replace('.', ''), 10) || 0;
  }
  return Math.round(parseFloat(s)) || 0;
}

function actualizarPrecio() {
  const sel = document.getElementById('modalProducto');
  const dispEl = document.getElementById('modalPrecioDisplay');
  if (!sel) return;

  const opcion = sel.options[sel.selectedIndex];
  precioModalOrden = opcion?.value ? parsearPrecio(opcion.getAttribute('data-precio')) : 0;
  if (dispEl) {
    dispEl.value = precioModalOrden > 0
      ? precioModalOrden.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      : '';
  }
  actualizarSubtotalOrden();
}

function actualizarSubtotalOrden() {
  const cant = parseInt(document.getElementById('modalCantidad')?.value) || 0;
  const el   = document.getElementById('modalSubtotalDisplay');
  if (el) {
    el.textContent = cant > 0 && precioModalOrden > 0
      ? '$' + (cant * precioModalOrden).toLocaleString('es-CO', { minimumFractionDigits: 0 })
      : '$0';
  }
}


/* ══════════════════════════════════════════════════════════════
   5. TOAST — sistema de notificaciones flotantes
══════════════════════════════════════════════════════════════ */
function mostrarToast(notif, delay = 0) {
  setTimeout(() => {
    const id       = 'toast-' + Date.now() + Math.random().toString(36).slice(2);
    const duracion = 6000;

    const accionHtml = notif.accion
      ? `<button class="ht-toast-action"
           onclick="document.getElementById('${id}').remove();
                    bootstrap.Modal.getOrCreateInstance(document.getElementById('${notif.accion.modal}')).show();">
           ${notif.accion.texto} →
         </button>`
      : '';

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
    if (prog) {
      prog.style.transition = `width ${duracion}ms linear`;
      setTimeout(() => { prog.style.width = '0%'; }, 50);
    }
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
   NUEVO: BIENVENIDA FLOTANTE (una vez por sesión)
   Mismo patrón que el dashboard del administrador.
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
  // textContent evita inyectar HTML con el nombre del usuario
  el.querySelector('.ht-toast-title').textContent = '¡Hola, ' + nombre + '!';
  el.querySelector('.ht-toast-msg').textContent = momento + '. Bienvenido/a a tu portal de clientes HebraTech.';
  el.querySelector('.ht-toast-close').addEventListener('click', () => cerrarToast(id));

  document.getElementById('toastContainer')?.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));

  const prog = document.getElementById('prog-' + id);
  if (prog) {
    prog.style.transition = `width ${duracion}ms linear`;
    setTimeout(() => { prog.style.width = '0%'; }, 50);
  }
  setTimeout(() => cerrarToast(id), duracion);
}


/* ══════════════════════════════════════════════════════════════
   6. FORMULARIO DE CONTACTO / SOPORTE
══════════════════════════════════════════════════════════════ */
function previewContactFile(input) {
  const label = document.getElementById('contactFileLabel');
  if (label) {
    label.textContent = input.files.length > 0
      ? Array.from(input.files).map(f => f.name).join(', ')
      : 'Sin archivos';
  }
}

function enviarContacto() {
  const asunto  = document.getElementById('contactAsunto')?.value;
  const mensaje = document.getElementById('contactMensaje')?.value.trim();

  if (!asunto || !mensaje) {
    mostrarToast({
      tipo: 'warning', icono: 'bi-exclamation-circle',
      titulo: 'Campos requeridos',
      mensaje: 'Selecciona un asunto y escribe tu mensaje.',
      accion: null,
    });
    return;
  }

  const pedido     = document.getElementById('contactPedido')?.value || '';
  const pedidoText = pedido ? `\nPedido: ${pedido}` : '';
  const subject    = encodeURIComponent(`[Portal Cliente] ${asunto}${pedido ? ' — ' + pedido : ''}`);
  const body       = encodeURIComponent(`Asunto: ${asunto}${pedidoText}\n\n${mensaje}`);
  window.location.href = `mailto:produccion@hebratech.com?subject=${subject}&body=${body}`;

  document.getElementById('contactFormWrap')?.classList.add('d-none');
  document.getElementById('contactConfirm')?.classList.remove('d-none');
}

function resetContactForm() {
  const ids = ['contactAsunto', 'contactPedido', 'contactMensaje'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const label = document.getElementById('contactFileLabel');
  if (label) label.textContent = 'Sin archivos';
  document.getElementById('contactFormWrap')?.classList.remove('d-none');
  document.getElementById('contactConfirm')?.classList.add('d-none');
}

function handleUpload(input) {
  if (input.files.length > 0) {
    mostrarToast({
      tipo: 'success', icono: 'bi-cloud-check',
      titulo: 'Archivo subido',
      mensaje: Array.from(input.files).map(f => f.name).join(', '),
      accion: null,
    });
  }
}


/* ══════════════════════════════════════════════════════════════
   7. NOTIFICACIONES EN TIEMPO REAL — Polling a Django
══════════════════════════════════════════════════════════════ */
(function () {
  const POLL_MS        = 30_000;
  const URL_NOTIF      = '/clientes/notificaciones/';
  const URL_LEER       = (id) => `/clientes/notificaciones/${id}/leer/`;
  const URL_ORDENES    = '/clientes/actualizar-ordenes/';

  const badgeContador      = document.getElementById('notifCount');
  const listaDropdown      = document.getElementById('notifDropdownList');
  const contenedorTracker  = document.getElementById('orderTrackerContainer');

  async function consultarNotificaciones() {
    try {
      const resp = await fetch(URL_NOTIF, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      actualizarBadge(data.no_leidas);
      actualizarDropdown(data.notificaciones);
      if (data.no_leidas > 0) await refrescarTracker();
    } catch (err) {
      console.warn('[HebraTech] notificaciones:', err);
    }
  }

  function actualizarBadge(cantidad) {
    if (!badgeContador) return;
    badgeContador.textContent     = cantidad > 9 ? '9+' : cantidad;
    badgeContador.style.display   = cantidad > 0 ? 'inline-flex' : 'none';
  }

  function actualizarDropdown(notificaciones) {
    if (!listaDropdown) return;

    if (!notificaciones.length) {
      listaDropdown.innerHTML = `
        <li class="px-3 py-3 text-center text-muted small">
          <i class="bi bi-bell-slash d-block mb-1 fs-4 opacity-50"></i>
          Sin notificaciones nuevas
        </li>`;
      return;
    }

    const iconos = {
      orden:   'bi-box-seam text-primary',
      factura: 'bi-receipt text-warning',
      sistema: 'bi-info-circle text-info',
    };

    listaDropdown.innerHTML = notificaciones.map(n => `
      <li class="notif-item px-2 py-2 ${n.leida ? 'opacity-50' : ''}"
          style="cursor:pointer;border-radius:8px;transition:background 0.15s;"
          onmouseenter="this.style.background='#f4f9fa'"
          onmouseleave="this.style.background=''"
          onclick="window.htMarcarLeida(${n.id}, this)">
        <div class="d-flex align-items-start gap-2">
          <i class="bi ${iconos[n.tipo] || 'bi-bell'} mt-1" style="font-size:1rem;flex-shrink:0;"></i>
          <div style="min-width:0;">
            <div class="small fw-semibold text-dark" style="line-height:1.3;">
              ${n.titulo}
              ${!n.leida
                ? '<span class="badge bg-primary ms-1" style="font-size:0.55rem;padding:2px 5px;border-radius:999px;">NUEVO</span>'
                : ''}
            </div>
            <div class="text-muted" style="font-size:0.75rem;margin-top:2px;line-height:1.4;white-space:normal;">
              ${n.mensaje}
            </div>
            <div style="font-size:0.65rem;color:#aab;margin-top:3px;">${n.fecha}</div>
          </div>
        </div>
      </li>
    `).join('<li><hr class="dropdown-divider my-1"></li>');
  }

  window.htMarcarLeida = async function (id, elemento) {
    try {
      await fetch(URL_LEER(id), {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': getCsrf() },
      });
      elemento?.classList.add('opacity-50');
      consultarNotificaciones();
    } catch (err) {
      console.warn('[HebraTech] marcar leída:', err);
    }
  };

  window.htMarcarTodasLeidas = async function () {
    try {
      await fetch(URL_LEER(0), {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': getCsrf() },
      });
      consultarNotificaciones();
    } catch (err) {
      console.warn('[HebraTech] marcar todas:', err);
    }
  };

  async function refrescarTracker() {
    if (!contenedorTracker) return;
    try {
      const resp = await fetch(URL_ORDENES, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.html) contenedorTracker.innerHTML = data.html;
    } catch (err) {
      console.warn('[HebraTech] tracker:', err);
    }
  }

  function getCsrf() {
    const c = document.cookie.split(';').find(x => x.trim().startsWith('csrftoken='));
    return c ? c.split('=')[1] : '';
  }

  document.addEventListener('DOMContentLoaded', function () {
    consultarNotificaciones();
    setInterval(consultarNotificaciones, POLL_MS);
    document.getElementById('btnMarcarTodasLeidas')
      ?.addEventListener('click', window.htMarcarTodasLeidas);
  });
})();


/* ══════════════════════════════════════════════════════════════
   8. GESTIÓN DE SEDES (Modal Configuración)
══════════════════════════════════════════════════════════════ */
let listaSedes = [
  { id: 1, nombre: 'Sede Principal - Norte',    direccion: 'Calle 100 #15-23, Piso 4',     ciudad: 'Bogotá, D.C.' },
  { id: 2, nombre: 'Centro de Distribución Sur', direccion: 'Av. Ciudad de Cali #32-10 Sur', ciudad: 'Bogotá, D.C.' },
];

let sedeCollapse = null;

function renderSedesTable() {
  const tbody = document.getElementById('tablaSedesBody');
  if (!tbody) return;
  tbody.innerHTML = listaSedes.map(s => `
    <tr>
      <td class="ps-3 fw-semibold text-dark">${s.nombre}</td>
      <td>${s.direccion}</td>
      <td>${s.ciudad}</td>
      <td class="text-end pe-3">
        <button class="btn btn-sm btn-link text-muted p-1 me-1" onclick="prepareEditSede(${s.id})" title="Editar">
          <i class="bi bi-pencil-square"></i>
        </button>
        <button class="btn btn-sm btn-link text-danger p-1" onclick="deleteSede(${s.id})" title="Eliminar">
          <i class="bi bi-trash3"></i>
        </button>
      </td>
    </tr>`).join('');
}

function _getCollapse() {
  if (!sedeCollapse) {
    const el = document.getElementById('formSedeCollapse');
    if (el) sedeCollapse = new bootstrap.Collapse(el, { toggle: false });
  }
  return sedeCollapse;
}

function showSedeForm() {
  document.getElementById('formSedeTitle').textContent = 'Nueva Sede de Despacho';
  ['sedeId', 'sedeNombre', 'sedeDireccion'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const ciudad = document.getElementById('sedeCiudad');
  if (ciudad) ciudad.value = 'Bogotá, D.C.';
  _getCollapse()?.show();
}

function hideSedeForm() {
  _getCollapse()?.hide();
}

function prepareEditSede(id) {
  const s = listaSedes.find(x => x.id === id);
  if (!s) return;
  document.getElementById('formSedeTitle').textContent = 'Modificar Sede';
  document.getElementById('sedeId').value        = s.id;
  document.getElementById('sedeNombre').value    = s.nombre;
  document.getElementById('sedeDireccion').value = s.direccion;
  document.getElementById('sedeCiudad').value    = s.ciudad;
  _getCollapse()?.show();
}

function saveSedeData() {
  const idVal     = document.getElementById('sedeId')?.value;
  const nombre    = document.getElementById('sedeNombre')?.value.trim();
  const direccion = document.getElementById('sedeDireccion')?.value.trim();
  const ciudad    = document.getElementById('sedeCiudad')?.value.trim();

  if (!nombre || !direccion || !ciudad) {
    alert('Por favor completa todos los campos de la sede.');
    return;
  }

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

  hideSedeForm();
  renderSedesTable();
}

function deleteSede(id) {
  const s = listaSedes.find(x => x.id === id);
  if (!s || !confirm(`¿Eliminar la sede "${s.nombre}"?`)) return;
  listaSedes = listaSedes.filter(x => x.id !== id);
  renderSedesTable();
  mostrarToast({ tipo: 'warning', icono: 'bi-trash3', titulo: 'Sede eliminada', mensaje: s.nombre, accion: null });
}


/* ══════════════════════════════════════════════════════════════
   9b. VALIDACIÓN — modal Nueva Orden de Producción
       (mismo patrón needs-validation que formCotizacion)
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function () {
  const formNuevaOrden = document.getElementById('formNuevaOrden');
  if (!formNuevaOrden) return;

  formNuevaOrden.addEventListener('submit', function (e) {
    let valido = formNuevaOrden.checkValidity();

    if (!valido) {
      e.preventDefault();
      e.stopPropagation();
    }
    formNuevaOrden.classList.add('was-validated');
  });

  // Si el usuario corrige un campo, quitamos el estado inválido visual al vuelo
  formNuevaOrden.querySelectorAll('input, select, textarea').forEach(function (campo) {
    campo.addEventListener('input', function () {
      if (campo.checkValidity()) campo.classList.remove('is-invalid');
    });
    campo.addEventListener('change', function () {
      if (campo.checkValidity()) campo.classList.remove('is-invalid');
    });
  });
});


/* ══════════════════════════════════════════════════════════════
   9. CALENDARIO AUTOMATIZADO (DateRangePicker)
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function () {
  renderSedesTable();

  if (window.jQuery && jQuery.fn.daterangepicker) {
    moment.locale('es');
    const pickerInput = $('#o-fecha-rango');

    pickerInput.daterangepicker({
      autoUpdateInput: false,
      minDate: moment().startOf('day'), // 👈 AQUÍ BLOQUEAS LAS FECHAS ANTERIORES A HOY
      locale: {
        format: 'YYYY-MM-DD',
        applyLabel: 'Aplicar',
        cancelLabel: 'Limpiar',
        fromLabel: 'Desde',
        toLabel: 'Hasta',
        daysOfWeek: ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'],
        monthNames: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
        firstDay: 1
      },
      isCustomDate: function(date) {
        const drp = pickerInput.data('daterangepicker');
        if (!drp || !drp.startDate || !drp.endDate) return '';

        const start = drp.startDate;
        const end = drp.endDate;

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
        </div>
      `;
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