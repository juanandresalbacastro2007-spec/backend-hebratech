// admin.js — HebraTech Panel de Administración

// Cerrar sidebar al hacer click fuera (mobile)

// ── Reloj en topbar ──────────────────────────────────────
function updateClock() {
  const el = document.getElementById('topClock');
  if (!el || document.getElementById('clockText')) return;   // el dashboard maneja su propio reloj
  const now = new Date();
  const hora = now.toLocaleTimeString('es-CO');
  const fecha = now.toLocaleDateString('es-CO', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  });
  el.innerHTML = `<strong>${hora}</strong><br><span style="font-size:0.68rem;">${fecha}</span>`;
}
setInterval(updateClock, 1000);
updateClock();  

// ── Marcar nav-item activo según URL actual ──────────────
document.addEventListener('DOMContentLoaded', function () {
  if (document.querySelector('.nav-item.active')) return;   // Django ya marcó la sección activa
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-item').forEach(function (item) {
    const href = item.getAttribute('href');
    if (href && currentPath.startsWith(href) && href !== '/') {
      item.classList.add('active');
    }
  });
});

       document.addEventListener("DOMContentLoaded", function() {
            const buscarInput = document.getElementById('buscarInput');
            const searchForm = document.getElementById('searchForm');

            if (buscarInput && searchForm) {
                buscarInput.addEventListener('input', function() {
                    // Si el usuario vacía el input por completo, envía el form automáticamente para traer todo
                    if (this.value.trim() === "") {
                        searchForm.submit();
                    }
                });
            }
        });

document.addEventListener("DOMContentLoaded", function () {
  const forms = document.querySelectorAll('.needs-validation');

  Array.from(forms).forEach(form => {
    form.addEventListener('submit', event => {
      // 1. Sincronizar y validar el costo unitario (debe ser mayor a 0)
      const costoVis = form.querySelector('#costoVisible');
      const costoHid = form.querySelector('#costoUnitario');
      if (costoVis && costoHid) {
        const valCosto = parseInt(costoHid.value, 10);
        if (!costoHid.value || isNaN(valCosto) || valCosto <= 0) {
          costoVis.setCustomValidity("El costo debe ser mayor a 0");
        } else {
          costoVis.setCustomValidity("");
        }
      }

      // 2. Validar que stockActual y stockMinimo sean mayores a 0
      const stockAct = form.querySelector('[name="stockActual"]');
      if (stockAct) {
        if (!stockAct.value || parseInt(stockAct.value, 10) <= 0) {
          stockAct.setCustomValidity("Debe ser mayor a 0");
        } else {
          stockAct.setCustomValidity("");
        }
      }

      const stockMin = form.querySelector('[name="stockMinimo"]');
      if (stockMin) {
        if (!stockMin.value || parseInt(stockMin.value, 10) <= 0) {
          stockMin.setCustomValidity("Debe ser mayor a 0");
        } else {
          stockMin.setCustomValidity("");
        }
      }

      if (!form.checkValidity()) {
        event.preventDefault();
        event.stopPropagation();
      }

      form.classList.add('was-validated');
    }, false);
  });
});

function formatearMiles(input) {
  let valor = input.value.replace(/\D/g, "");
  const hiddenField = document.getElementById("costoUnitario");

  if (hiddenField) {
    hiddenField.value = valor;
  }

  if (valor !== "" && parseInt(valor, 10) > 0) {
    input.value = new Intl.NumberFormat("es-CO").format(valor);
    input.setCustomValidity("");
  } else {
    input.value = valor === "0" ? "0" : "";
    input.setCustomValidity("El costo debe ser mayor a 0");
  }
}

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar, aside, .app-sidebar');
  if (sidebar) {
    sidebar.classList.toggle('open');
  } else {
    alert("Error: No se encontró ningún elemento de menú lateral en el HTML.");
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const formPerfil = document.getElementById("formEditarPerfil");
  const alertBox = document.getElementById("perfilAlert");

  if (formPerfil) {
    formPerfil.addEventListener("submit", function (e) {
      e.preventDefault();

      const formData = new FormData(this);
      const token = document.querySelector('[name=csrfmiddlewaretoken]').value;

      fetch(this.action, {
        method: 'POST',
        headers: {
          'X-CSRFToken': token
        },
        body: formData
      })
      .then(async res => {
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || "Error al actualizar la información.");
        }
        return data;
      })
      .then(data => {
        window.location.reload();
      })
      .catch(err => {
        console.error("Detalle del error:", err);
        if (alertBox) {
          alertBox.classList.remove("d-none");
          alertBox.innerText = err.message;
        }
      });
    });
  }
});


// ============================================================
// MÓDULO DE NOTIFICACIONES — HebraTech
// ============================================================
// Campana + panel con pestañas Nuevas/Leídas, marcar una/todas.
// Dashboard:  HT_Notif.procesar(alertas)
// Otras páginas: <div id="notifMount" data-url="{% url 'api_alertas' %}"></div>
// ============================================================

window.HT_Notif = (function () {
  'use strict';

  const BASE_KEY = 'ht_notif_leidas';          // mismo formato que antes (array de ids)
  const MAX_LEIDAS = 200;                      // límite para no crecer sin fin
  const POLL_MS = 60000;

  const TIPOS = {
    danger:  { icon: 'bi-exclamation-octagon-fill',  label: 'Crítico',     orden: 0 },
    warning: { icon: 'bi-exclamation-triangle-fill', label: 'Advertencia', orden: 1 },
    info:    { icon: 'bi-info-circle-fill',          label: 'Información', orden: 2 },
    success: { icon: 'bi-check-circle-fill',         label: 'OK',          orden: 3 },
  };

  const RUTAS = {
    admin_ordenes: '/administrador/ordenes/',
    ordenes: '/administrador/ordenes/',
    admin_usuarios: '/administrador/usuarios/',
    admin_tareas: '/administrador/tareas/',
    admin_incidencias: '/administrador/incidencias/',
    admin_inventario: '/administrador/inventario/',
  };

  let alertas = [];
  let tab = 'nuevas';
  let vistas = null;            // ids ya vistos (para detectar nuevas tras el primer load)
  let onNueva = null;           // callback(alerta) cuando aparece una no leída nueva
  let ui = null;                // referencias al DOM
  let pollTimer = null;

  // ── Utilidades ────────────────────────────────────────────
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Id estable: ignora los números del texto, así "5 incidencia(s)" y "6 incidencia(s)"
  // son la misma alerta y, una vez leída, no vuelve a aparecer aunque cambie el conteo.
  const idDe = a => a.id ? String(a.id)
    : `${a.tipo}::${a.modulo || ''}::${String(a.texto || '').replace(/\d+/g, '#').trim()}`;
  const idLegacy = a => `${a.tipo}::${a.texto}`;          // formato anterior (compatibilidad)
  const esLeida = (set, a) => set.has(idDe(a)) || set.has(idLegacy(a));
  const tipoDe = a => TIPOS[a.tipo] || TIPOS.info;

  function urlDe(a) {
    if (a.url) return a.url;
    const m = a.modulo;
    if (!m) return '';
    if (m.startsWith('/')) return m;
    return RUTAS[m] || `/administrador/${m}/`;
  }

  // ── Persistencia ──────────────────────────────────────────
  const storageKey = () => `${BASE_KEY}_${document.body.dataset.userId || 'default'}`;

  function getLeidas() {
    try {
      const arr = JSON.parse(localStorage.getItem(storageKey()));
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return new Set(); }
  }

  function saveLeidas(set) {
    try { localStorage.setItem(storageKey(), JSON.stringify([...set].slice(-MAX_LEIDAS))); }
    catch { /* almacenamiento lleno o bloqueado: seguimos sin persistir */ }
  }

  // ── Acciones ──────────────────────────────────────────────
  function marcar(id, leida) {
    const set = getLeidas();
    leida ? set.add(id) : set.delete(id);
    saveLeidas(set);
    render();
  }

  function marcarTodas() {
    const set = getLeidas();
    alertas.forEach(a => set.add(idDe(a)));
    saveLeidas(set);
    render();
  }

  // ── Render ────────────────────────────────────────────────
  function render() {
    if (!ui) return;
    const leidas = getLeidas();
    const porTipo = (a, b) => tipoDe(a).orden - tipoDe(b).orden;
    const nuevas = alertas.filter(a => !esLeida(leidas, a)).sort(porTipo);
    const viejas = alertas.filter(a => esLeida(leidas, a)).sort(porTipo);

    // Badge + accesibilidad del botón
    const n = nuevas.length;
    ui.badge.hidden = n === 0;
    ui.badge.textContent = n > 9 ? '9+' : n;
    ui.btn.setAttribute('aria-label', n ? `Notificaciones, ${n} sin leer` : 'Notificaciones, sin novedades');
    ui.btn.classList.toggle('has-unread', n > 0);

    // Pestañas
    ui.tabNuevas.querySelector('span').textContent = n;
    ui.tabLeidas.querySelector('span').textContent = viejas.length;
    ui.tabNuevas.classList.toggle('active', tab === 'nuevas');
    ui.tabLeidas.classList.toggle('active', tab === 'leidas');
    ui.tabNuevas.setAttribute('aria-selected', tab === 'nuevas');
    ui.tabLeidas.setAttribute('aria-selected', tab === 'leidas');
    ui.marcarTodas.hidden = n === 0;

    // Lista
    const lista = tab === 'nuevas' ? nuevas : viejas;
    ui.empty.hidden = lista.length > 0;
    ui.emptyTxt.textContent = tab === 'nuevas' ? 'Todo al día, sin notificaciones nuevas' : 'Aún no hay notificaciones leídas';
    ui.list.innerHTML = lista.map(a => {
      const id = esc(idDe(a));
      const t = tipoDe(a);
      const url = urlDe(a);
      const leida = tab === 'leidas';
      return `
        <li class="ht-notif-item ht-notif--${esc(a.tipo || 'info')} ${leida ? 'is-read' : ''}" data-id="${id}">
          <button type="button" class="ht-notif-main" data-action="abrir" data-url="${esc(url)}">
            <span class="ht-notif-ico"><i class="bi ${t.icon}"></i></span>
            <span class="ht-notif-body">
              <span class="ht-notif-txt">${esc(a.texto)}</span>
              <span class="ht-notif-meta">${esc(a.icono || '')} ${t.label}${url ? ' · <b>Ver detalle →</b>' : ''}</span>
            </span>
          </button>
          <button type="button" class="ht-notif-toggle" data-action="${leida ? 'no-leida' : 'leida'}"
                  title="${leida ? 'Marcar como no leída' : 'Marcar como leída'}"
                  aria-label="${leida ? 'Marcar como no leída' : 'Marcar como leída'}">
            <i class="bi ${leida ? 'bi-arrow-counterclockwise' : 'bi-check2'}"></i>
          </button>
        </li>`;
    }).join('');
  }

  // ── Panel ─────────────────────────────────────────────────
  function abrir() {
    ui.panel.hidden = false;
    ui.btn.setAttribute('aria-expanded', 'true');
  }

  function cerrar(devolverFoco) {
    if (ui.panel.hidden) return;
    ui.panel.hidden = true;
    ui.btn.setAttribute('aria-expanded', 'false');
    if (devolverFoco) ui.btn.focus();
  }

  // ── Entrada de datos ──────────────────────────────────────
  function procesar(lista) {
    alertas = Array.isArray(lista) ? lista : [];
    const leidas = getLeidas();

    // Detectar no leídas que no habíamos visto (solo después de la primera carga)
    if (vistas !== null && onNueva) {
      paraToast(alertas.filter(a => !vistas.has(idDe(a)))).forEach(onNueva);
    }
    vistas = new Set(alertas.map(idDe));

    // Compatibilidad con el bloque inline del dashboard
    const cont = document.getElementById('dashboard-alertas');
    if (cont) {
      cont.innerHTML = alertas.filter(a => !esLeida(leidas, a)).map(a =>
        `<div class="alerta-banner alerta-${esc(a.tipo)}"><span>${esc(a.icono)}</span> ${esc(a.texto)}</div>`).join('');
    }
    render();
  }

  // Toasts: solo alertas no leídas y que no se hayan mostrado antes (persistente)
  function paraToast(lista) {
    const key = `ht_notif_toasts_${document.body.dataset.userId || 'default'}`;
    let vistasT;
    try { vistasT = new Set(JSON.parse(localStorage.getItem(key)) || []); } catch { vistasT = new Set(); }
    const leidas = getLeidas();
    const salida = (lista || []).filter(a => !esLeida(leidas, a) && !vistasT.has(idDe(a)));
    salida.forEach(a => vistasT.add(idDe(a)));
    try { localStorage.setItem(key, JSON.stringify([...vistasT].slice(-MAX_LEIDAS))); } catch {}
    return salida;
  }

  async function cargar() {
    const url = ui && ui.mount.dataset.url;
    if (!url) return;
    try {
      const r = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!r.ok) throw new Error(r.status);
      const data = await r.json();
      procesar(data.alertas);
    } catch (e) {
      console.warn('[HT_Notif] no se pudo actualizar:', e);
    }
  }

  // ── Construcción del DOM ──────────────────────────────────
  function build() {
    if (ui) return;
    let mount = document.getElementById('notifMount');
    if (!mount) {
      const topbar = document.querySelector('.topbar');
      if (!topbar) return;
      // Las páginas con botones propios en el topbar (topbar_extra) ya los empujan a la
      // derecha con margin auto; un segundo margin auto los dejaba en el centro.
      // Solución: mover esos botones a un grupo a la derecha y poner la campana al final.
      const grupo = document.createElement('div');
      grupo.className = 'ht-topbar-right ms-auto d-flex align-items-center gap-3';
      const bloqueTitulo = [...topbar.children].find(c => c.querySelector('.topbar-title'));
      let n = bloqueTitulo ? bloqueTitulo.nextSibling : null;
      while (n) {
        const sig = n.nextSibling;
        grupo.appendChild(n);
        n = sig;
      }
      mount = document.createElement('div');
      mount.id = 'notifMount';
      grupo.appendChild(mount);
      topbar.appendChild(grupo);
    }
    mount.classList.add('ht-notif');
    mount.innerHTML = `
      <button type="button" class="ht-notif-btn" id="htNotifBtn" aria-haspopup="dialog"
              aria-expanded="false" aria-controls="htNotifPanel" aria-label="Notificaciones">
        <i class="bi bi-bell-fill"></i>
        <span class="ht-notif-badge" hidden>0</span>
      </button>
      <div class="ht-notif-panel" id="htNotifPanel" role="dialog" aria-label="Notificaciones" hidden>
        <div class="ht-notif-head">
          <strong>Notificaciones</strong>
          <button type="button" class="ht-notif-link" data-action="todas" hidden>
            <i class="bi bi-check2-all"></i> Marcar todas como leídas
          </button>
        </div>
        <div class="ht-notif-tabs" role="tablist">
          <button type="button" role="tab" data-tab="nuevas" class="active">Nuevas <span>0</span></button>
          <button type="button" role="tab" data-tab="leidas">Leídas <span>0</span></button>
        </div>
        <ul class="ht-notif-list"></ul>
        <div class="ht-notif-empty" hidden><i class="bi bi-bell-slash"></i><span></span></div>
      </div>`;

    ui = {
      mount,
      btn: mount.querySelector('.ht-notif-btn'),
      badge: mount.querySelector('.ht-notif-badge'),
      panel: mount.querySelector('.ht-notif-panel'),
      list: mount.querySelector('.ht-notif-list'),
      empty: mount.querySelector('.ht-notif-empty'),
      emptyTxt: mount.querySelector('.ht-notif-empty span'),
      marcarTodas: mount.querySelector('[data-action="todas"]'),
      tabNuevas: mount.querySelector('[data-tab="nuevas"]'),
      tabLeidas: mount.querySelector('[data-tab="leidas"]'),
    };

    ui.btn.addEventListener('click', e => {
      e.stopPropagation();
      ui.panel.hidden ? abrir() : cerrar();
    });
    ui.panel.addEventListener('click', e => {
      e.stopPropagation();
      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) { tab = tabBtn.dataset.tab; render(); return; }
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const item = el.closest('.ht-notif-item');
      const id = item && item.dataset.id;
      switch (el.dataset.action) {
        case 'todas':    marcarTodas(); break;
        case 'leida':    marcar(id, true); break;
        case 'no-leida': marcar(id, false); break;
        case 'abrir': {
          marcar(id, true);                       // abrir = leer
          const url = el.dataset.url;
          if (url) window.location.href = url;
          break;
        }
      }
    });
    document.addEventListener('click', () => cerrar());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(true); });
    // Si otra pestaña marca como leída, sincronizamos
    window.addEventListener('storage', e => { if (e.key === storageKey()) render(); });

    render();

    if (mount.dataset.url) {
      cargar();
      pollTimer = setInterval(cargar, POLL_MS);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) cargar(); });
    }
  }

  function init(opts) {
    if (opts && typeof opts.onNueva === 'function') onNueva = opts.onNueva;
    build();
  }

  document.addEventListener('DOMContentLoaded', () => init());

  return { init, procesar, cargar, marcarTodas, abrir, cerrar, urlDe, paraToast };
})();