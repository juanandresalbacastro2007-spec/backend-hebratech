// admin.js — HebraTech Panel de Administración

// Cerrar sidebar al hacer click fuera (mobile)

// ── Reloj en topbar ──────────────────────────────────────
function updateClock() {
  const el = document.getElementById('topClock');
  if (!el) return;
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
// Funciona en todas las páginas del panel porque vive en admin.js.
// produccion.js solo necesita llamar a window.HT_Notif.procesar(alertas)
// cuando recibe los datos del dashboard.
// ============================================================

window.HT_Notif = (function () {

  // ── Claves de almacenamiento ──────────────────────────────
  const BASE_KEY = 'ht_notif_leidas';

  function getUserId() {
    return document.body.dataset.userId || 'default';
  }

  function storageKey() {
    return `${BASE_KEY}_${getUserId()}`;
  }

  // ── Persistencia de leídas ────────────────────────────────
  function getLeidas() {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey())) || []);
    } catch {
      return new Set();
    }
  }

  function saveLeidas(set) {
    localStorage.setItem(storageKey(), JSON.stringify([...set]));
  }

  // Genera un ID estable por alerta basado en tipo + texto.
  // Si el backend cambia el texto de una alerta, se trata como nueva.
  function alertaId(a) {
    return `${a.tipo}::${a.texto}`;
  }

  // ── Caché interna de alertas recibidas ────────────────────
  let _alertasActuales = [];

  // ── Badge ─────────────────────────────────────────────────
  function setBadge(count) {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 9 ? '9+' : count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // ── Panel lateral ─────────────────────────────────────────
  function abrirPanel() {
    document.getElementById('notif-panel')?.classList.add('open');
    document.getElementById('notif-overlay')?.classList.add('open');
  }

  function cerrarPanel() {
    document.getElementById('notif-panel')?.classList.remove('open');
    document.getElementById('notif-overlay')?.classList.remove('open');
  }

  // ── Render de items dentro del panel ─────────────────────
  const ICONO_MAP = {
    danger:  { bi: 'bi-exclamation-octagon-fill', label: 'Crítico'      },
    warning: { bi: 'bi-exclamation-triangle-fill', label: 'Advertencia' },
    info:    { bi: 'bi-info-circle-fill',          label: 'Información'  },
    success: { bi: 'bi-check-circle-fill',         label: 'OK'           },
  };

  function renderPanel(noLeidas) {
    const lista        = document.getElementById('notif-lista');
    const empty        = document.getElementById('notif-empty');
    const btnTodas     = document.getElementById('notif-btn-marcar-todas');
    const countEl      = document.getElementById('notif-panel-count');
    if (!lista) return;

    if (countEl) {
      countEl.textContent = noLeidas.length
        ? `${noLeidas.length} sin leer`
        : '';
    }

    if (!noLeidas.length) {
      lista.innerHTML = '';
      empty?.style.setProperty('display', 'flex');
      if (btnTodas) btnTodas.style.display = 'none';
      return;
    }

    empty?.style.setProperty('display', 'none');
    if (btnTodas) btnTodas.style.display = 'inline-flex';

    lista.innerHTML = noLeidas.map(a => {
      const id   = alertaId(a);
      const meta = ICONO_MAP[a.tipo] || ICONO_MAP.info;
      // Escapar comillas simples para el atributo onclick
      const idEsc = id.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `
        <div class="notif-item notif-item--${a.tipo}" data-notif-id="${id.replace(/"/g, '&quot;')}">
          <div class="notif-item-icon">
            <i class="bi ${meta.bi}"></i>
          </div>
          <div class="notif-item-body">
            <span class="notif-item-texto">${a.texto}</span>
            <span class="notif-item-etiqueta">${a.icono || ''} ${meta.label}</span>
          </div>
          <button class="notif-item-cerrar" title="Marcar como leída"
                  onclick="HT_Notif.marcarUna('${idEsc}')">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      `;
    }).join('');
  }

  // ── Marcar una notificación como leída ────────────────────
  function marcarUna(id) {
    const leidas = getLeidas();
    leidas.add(id);
    saveLeidas(leidas);

    // Animación de salida
    const item = document.querySelector(`.notif-item[data-notif-id="${id.replace(/"/g, '\\"')}"]`);
    if (item) {
      item.style.transition = 'opacity .22s ease, transform .22s ease';
      item.style.opacity    = '0';
      item.style.transform  = 'translateX(14px)';
      setTimeout(() => {
        item.remove();
        // Si ya no quedan items, mostrar empty state
        const lista = document.getElementById('notif-lista');
        if (lista && lista.children.length === 0) {
          document.getElementById('notif-empty')?.style.setProperty('display', 'flex');
          const btn = document.getElementById('notif-btn-marcar-todas');
          if (btn) btn.style.display = 'none';
          const countEl = document.getElementById('notif-panel-count');
          if (countEl) countEl.textContent = '';
        }
      }, 240);
    }

    // Actualizar badge
    const badge = document.getElementById('notif-badge');
    const actual = parseInt(badge?.textContent || '0', 10);
    setBadge(Math.max(0, actual - 1));
  }

  // ── Marcar todas como leídas ──────────────────────────────
  function marcarTodas() {
    const leidas = getLeidas();
    _alertasActuales.forEach(a => leidas.add(alertaId(a)));
    saveLeidas(leidas);
    cerrarPanel();
    setBadge(0);
    renderPanel([]);
    // Limpiar también el bloque de alertas del dashboard si existe
    const dashAlertas = document.getElementById('dashboard-alertas');
    if (dashAlertas) dashAlertas.innerHTML = '';
  }

  // ── Punto de entrada público: procesar alertas del API ───
  function procesar(alertas) {
    _alertasActuales = alertas || [];
    const leidas     = getLeidas();
    const noLeidas   = _alertasActuales.filter(a => !leidas.has(alertaId(a)));

    setBadge(noLeidas.length);
    renderPanel(noLeidas);

    // Zona de alertas inline del dashboard (solo las no leídas)
    const cont = document.getElementById('dashboard-alertas');
    if (cont) {
      cont.innerHTML = noLeidas.map(a => `
        <div class="alerta-banner alerta-${a.tipo}">
          <span>${a.icono}</span> ${a.texto}
        </div>
      `).join('');
    }
  }

  // ── Construcción del DOM del panel ───────────────────────
  function buildPanel() {
    if (document.getElementById('notif-panel')) return;

    // Overlay
    const overlay = document.createElement('div');
    overlay.id        = 'notif-overlay';
    overlay.className = 'notif-overlay';
    overlay.addEventListener('click', cerrarPanel);
    document.body.appendChild(overlay);

    // Panel
    const panel = document.createElement('div');
    panel.id        = 'notif-panel';
    panel.className = 'notif-panel';
    panel.innerHTML = `
      <div class="notif-panel-header">
        <div class="notif-panel-titulo">
          <i class="bi bi-bell-fill"></i>
          <span>Notificaciones</span>
          <span id="notif-panel-count" class="notif-panel-count"></span>
        </div>
        <div class="notif-panel-acciones">
          <button id="notif-btn-marcar-todas" class="notif-btn-texto" style="display:none;"
                  onclick="HT_Notif.marcarTodas()">
            Marcar todas como leídas
          </button>
          <button class="notif-panel-cerrar" onclick="HT_Notif.cerrarPanel()" title="Cerrar">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      </div>
      <div id="notif-lista" class="notif-lista"></div>
      <div id="notif-empty" class="notif-empty" style="display:none;">
        <i class="bi bi-bell-slash"></i>
        <span>Todo al día — sin notificaciones</span>
      </div>
    `;
    document.body.appendChild(panel);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') cerrarPanel();
    });
  }

  // ── Botón 🔔 en el topbar ─────────────────────────────────
  function buildTrigger() {
    if (document.getElementById('notif-trigger')) return;
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'notif-trigger-wrapper ms-auto';
    wrapper.innerHTML = `
      <button id="notif-trigger" class="notif-trigger" title="Notificaciones"
              onclick="HT_Notif.abrirPanel()">
        <i class="bi bi-bell-fill"></i>
        <span id="notif-badge" class="notif-badge" style="display:none;">0</span>
      </button>
    `;
    topbar.appendChild(wrapper);
  }

  // ── Estilos CSS ───────────────────────────────────────────
  function buildStyles() {
    if (document.getElementById('notif-styles')) return;
    const style = document.createElement('style');
    style.id = 'notif-styles';
    style.textContent = `
      /* ── Trigger ── */
      .notif-trigger-wrapper { display:flex; align-items:center; }
      .notif-trigger {
        position:relative; background:none; border:none; cursor:pointer;
        width:40px; height:40px; border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        font-size:1.15rem; color:var(--primary,#395B64);
        transition:background .18s;
      }
      .notif-trigger:hover { background:rgba(57,91,100,.10); }
      [data-bs-theme="dark"] .notif-trigger { color:#e2e8f0; }
      [data-bs-theme="dark"] .notif-trigger:hover { background:rgba(255,255,255,.08); }

      /* ── Badge ── */
      .notif-badge {
        position:absolute; top:4px; right:4px;
        background:#ef4444; color:#fff;
        font-size:10px; font-weight:700;
        min-width:17px; height:17px; border-radius:999px;
        display:flex; align-items:center; justify-content:center;
        padding:0 3px; border:2px solid #fff;
        pointer-events:none; line-height:1;
        animation:notif-pop .28s ease;
      }
      [data-bs-theme="dark"] .notif-badge { border-color:#1e293b; }
      @keyframes notif-pop {
        0%  { transform:scale(.4); opacity:0; }
        65% { transform:scale(1.2); }
        100%{ transform:scale(1);  opacity:1; }
      }

      /* ── Overlay ── */
      .notif-overlay {
        display:none; position:fixed; inset:0;
        background:rgba(0,0,0,.22); z-index:1300;
        backdrop-filter:blur(1px);
      }
      .notif-overlay.open { display:block; }

      /* ── Panel ── */
      .notif-panel {
        position:fixed; top:0; right:0;
        width:360px; max-width:95vw; height:100%;
        background:#fff; z-index:1400;
        display:flex; flex-direction:column;
        transform:translateX(100%);
        transition:transform .28s cubic-bezier(.4,0,.2,1);
        box-shadow:-4px 0 32px rgba(0,0,0,.12);
        border-left:1px solid #e5e7eb;
      }
      .notif-panel.open { transform:translateX(0); }
      [data-bs-theme="dark"] .notif-panel {
        background:#1e293b; border-left-color:#334155;
      }

      /* ── Panel header ── */
      .notif-panel-header {
        display:flex; align-items:center; justify-content:space-between;
        padding:18px 16px 14px; border-bottom:1px solid #e5e7eb;
        gap:8px; flex-shrink:0;
      }
      [data-bs-theme="dark"] .notif-panel-header { border-bottom-color:#334155; }
      .notif-panel-titulo {
        display:flex; align-items:center; gap:8px;
        font-size:.95rem; font-weight:700;
        color:var(--primary,#395B64);
      }
      [data-bs-theme="dark"] .notif-panel-titulo { color:#7dd3fc; }
      .notif-panel-count {
        font-size:.72rem; font-weight:700;
        background:rgba(239,68,68,.12); color:#ef4444;
        padding:2px 8px; border-radius:999px;
      }
      .notif-panel-acciones { display:flex; align-items:center; gap:6px; }
      .notif-btn-texto {
        background:none; border:none; cursor:pointer;
        font-size:.75rem; font-weight:600;
        color:#6b7280; text-decoration:underline;
        padding:4px 6px; border-radius:4px;
        transition:color .15s;
      }
      .notif-btn-texto:hover { color:var(--primary,#395B64); }
      .notif-panel-cerrar {
        background:none; border:none; cursor:pointer;
        width:30px; height:30px; border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        font-size:.9rem; color:#9ca3af;
        transition:background .15s, color .15s;
      }
      .notif-panel-cerrar:hover { background:#f3f4f6; color:#374151; }
      [data-bs-theme="dark"] .notif-panel-cerrar:hover { background:#334155; color:#e2e8f0; }

      /* ── Lista ── */
      .notif-lista {
        flex:1; overflow-y:auto;
        padding:10px 12px;
        display:flex; flex-direction:column; gap:8px;
        scroll-behavior:smooth;
      }

      /* ── Item ── */
      .notif-item {
        display:flex; align-items:flex-start; gap:10px;
        padding:12px 10px; border-radius:10px;
        border-left:3px solid transparent;
        background:#f8fafc; transition:background .15s;
      }
      [data-bs-theme="dark"] .notif-item { background:#0f172a; }
      .notif-item:hover { background:#f1f5f9; }
      [data-bs-theme="dark"] .notif-item:hover { background:#1e293b; }
      .notif-item--danger  { border-left-color:#ef4444; }
      .notif-item--warning { border-left-color:#f59e0b; }
      .notif-item--info    { border-left-color:#3b82f6; }
      .notif-item--success { border-left-color:#22c55e; }

      .notif-item-icon {
        flex-shrink:0; width:32px; height:32px; border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        font-size:.9rem;
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
        flex:1; display:flex; flex-direction:column; gap:3px; min-width:0;
      }
      .notif-item-texto {
        font-size:.83rem; line-height:1.4;
        color:#1e293b; font-weight:500; word-break:break-word;
      }
      [data-bs-theme="dark"] .notif-item-texto { color:#e2e8f0; }
      .notif-item-etiqueta {
        font-size:.71rem; color:#94a3b8;
        text-transform:uppercase; letter-spacing:.04em; font-weight:600;
      }
      .notif-item-cerrar {
        flex-shrink:0; background:none; border:none; cursor:pointer;
        color:#cbd5e1; font-size:.75rem;
        width:24px; height:24px; border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        transition:background .15s, color .15s; margin-top:2px;
      }
      .notif-item-cerrar:hover { background:#e2e8f0; color:#475569; }
      [data-bs-theme="dark"] .notif-item-cerrar:hover { background:#334155; color:#cbd5e1; }

      /* ── Empty state ── */
      .notif-empty {
        flex:1; flex-direction:column;
        align-items:center; justify-content:center;
        gap:12px; padding:40px 20px;
        color:#94a3b8; text-align:center;
      }
      .notif-empty i { font-size:2.2rem; opacity:.45; }
      .notif-empty span { font-size:.87rem; font-weight:500; }
    `;
    document.head.appendChild(style);
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    buildStyles();
    buildTrigger();
    buildPanel();
  }

  // Exponer API pública
  return { init, procesar, marcarUna, marcarTodas, abrirPanel, cerrarPanel };

})();

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => window.HT_Notif.init());