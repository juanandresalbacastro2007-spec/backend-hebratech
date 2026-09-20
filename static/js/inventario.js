/* ============================================================
   HebraTech — Módulo Inventario y Materiales (admin)
   Archivo: static/js/inventario.js
   Se carga desde administrador/inventario_lista.html

   Los valores que vienen de Django (URLs, token CSRF, flags) se
   leen del <div id="inventarioConfig"> que está en la plantilla.
   ============================================================ */
(function () {
  'use strict';

  const cfgEl = document.getElementById('inventarioConfig');
  if (!cfgEl) return;

  const CSRF_TOKEN           = cfgEl.dataset.csrf;
  const URL_AJUSTAR_STOCK    = cfgEl.dataset.urlAjustarStock;
  const URL_HISTORIAL        = cfgEl.dataset.urlHistorial;
  const URL_AJUSTAR_MATERIAL = cfgEl.dataset.urlAjustarMaterial;
  const TAB_KEY              = 'hebratech_inv_tab';

  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ── Utilidades ─────────────────────────────────────────── */

  // Las URLs terminan en /0/ (pk=0): se reemplaza ese /0/ final por el pk real
  function urlConPk(template, pk) {
    return template.replace(/\/0\/$/, '/' + pk + '/');
  }

  function soloDigitos(valor) {
    return String(valor || '').replace(/\D/g, '');
  }

  function formatearMiles(valor) {
    const d = soloDigitos(valor);
    return d ? new Intl.NumberFormat('es-CO').format(d) : '';
  }

  function mostrarToast(mensaje, tipo) {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `alert alert-${tipo} alert-dismissible shadow d-flex align-items-center mb-0`;
    toast.style.cssText = 'min-width:260px;max-width:360px;animation:fadeInUp .25s ease;';
    const icono = tipo === 'success'
      ? '<i class="bi bi-check-circle-fill me-2 text-success"></i>'
      : '<i class="bi bi-exclamation-triangle-fill me-2 text-danger"></i>';
    toast.innerHTML = `${icono}<div></div>
      <button type="button" class="btn-close ms-auto" onclick="this.closest('.alert').remove()"></button>`;
    toast.querySelector('div').textContent = mensaje;   // texto plano, nunca HTML
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  /* ── AJAX: ajuste de stock de productos ─────────────────── */
  function ejecutarAjusteStock(pk, accion, cantidad, motivo, callback) {
    const body = new URLSearchParams({
      csrfmiddlewaretoken: CSRF_TOKEN,
      accion, cantidad, motivo,
    });

    fetch(urlConPk(URL_AJUSTAR_STOCK, pk), { method: 'POST', body })
      .then(r => r.json())
      .then(data => {
        if (!data.ok) {
          mostrarToast(data.error || 'Error al ajustar stock.', 'danger');
          return;
        }

        // Badge de disponible (mismo criterio de color que la tabla)
        const span = document.getElementById(`disponible-${pk}`);
        if (span) {
          const critico = data.nivelStock <= 1;
          const claseStock = critico ? 'badge-danger'
                           : (data.nivelStock === 2 ? 'badge-warning' : 'badge-success');
          const icono = critico ? '<i class="bi bi-exclamation-triangle-fill me-1"></i>' : '';
          span.innerHTML = `${icono}${data.disponible}`;
          span.className = `badge-ht ${claseStock}`;
        }

        // Badge de nivel
        const nivel = $(`.nivel-badge-${pk}`);
        if (nivel) {
          const mapa = {
            3: ['Alto',    'badge-success'],
            2: ['Normal',  'badge-info'],
            1: ['Bajo',    'badge-warning'],
            0: ['Crítico', 'badge-danger'],
          };
          const [txt, cls] = mapa[data.nivelStock] || ['Sin definir', 'badge-info'];
          nivel.textContent = txt;
          nivel.className = `badge-ht nivel-badge-${pk} ${cls}`;
        }

        mostrarToast(`Stock actualizado: ${data.disponible} unidades disponibles.`, 'success');
        if (callback) callback();
      })
      .catch(() => mostrarToast('Error de conexión al ajustar stock.', 'danger'));
  }

  /* ── AJAX: ajuste de stock de materiales ────────────────── */
  function ejecutarAjusteMaterial(pk, accion, cantidad, motivo) {
    const body = new URLSearchParams({
      csrfmiddlewaretoken: CSRF_TOKEN,
      accion, cantidad, motivo,
    });

    fetch(urlConPk(URL_AJUSTAR_MATERIAL, pk), { method: 'POST', body })
      .then(r => r.json())
      .then(data => {
        if (!data.ok) {
          mostrarToast(data.error || 'Error al ajustar material.', 'danger');
          return;
        }
        const span = document.getElementById(`stock-mat-${pk}`);
        if (span) {
          const icono = data.bajo_minimo ? '<i class="bi bi-exclamation-diamond-fill me-1"></i>' : '';
          span.innerHTML = `${icono}${data.stockActual}`;
          span.className = `badge-ht ${data.bajo_minimo ? 'badge-danger' : 'badge-success'}`;
        }
        mostrarToast(`Material actualizado: stock actual ${data.stockActual}.`, 'success');
      })
      .catch(() => mostrarToast('Error de conexión al ajustar material.', 'danger'));
  }

  /* ── Pestañas: recordar la activa y cambiar controles ───── */
  function initTabs() {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');

    const tabToActivate = tabParam
      ? (tabParam === 'materiales' ? 'tab-materiales' : 'tab-productos')
      : (localStorage.getItem(TAB_KEY) || 'tab-productos');

    const tabEl = document.getElementById(tabToActivate);
    if (tabEl) bootstrap.Tab.getOrCreateInstance(tabEl).show();

    const ctrlProd = document.getElementById('controles-productos');
    const ctrlMat  = document.getElementById('controles-materiales');

    function aplicarControles(id) {
      ctrlProd?.classList.toggle('d-none', id !== 'tab-productos');
      ctrlMat?.classList.toggle('d-none', id !== 'tab-materiales');
    }

    $$('#inventarioTabs button[data-bs-toggle="tab"]').forEach(btn => {
      btn.addEventListener('shown.bs.tab', function (e) {
        localStorage.setItem(TAB_KEY, e.target.id);
        aplicarControles(e.target.id);
      });
    });

    const activa = $('#inventarioTabs .nav-link.active');
    if (activa) aplicarControles(activa.id);
  }

  /* ── Modal de egresos masivos: buscador ─────────────────── */
  function initBuscadorEgresos() {
    const input = document.getElementById('buscarModalEgreso');
    if (!input) return;
    input.addEventListener('input', function () {
      const t = this.value.toLowerCase().trim();
      $$('#tablaModalEgresos .fila-egreso').forEach(fila => {
        const ok = fila.dataset.nombre.includes(t) || fila.dataset.id.includes(t);
        fila.style.display = ok ? '' : 'none';
      });
    });
  }

  /* ── Selects de ubicación con opción "Otro" ─────────────── */
  function initUbicaciones() {
    $$('.ubicacion-select').forEach(function (select) {
      select.addEventListener('change', function () {
        const wrap = document.getElementById(this.dataset.target);
        if (!wrap) return;
        wrap.classList.toggle('d-none', this.value !== 'otro');
        if (this.value !== 'otro') {
          const inp = wrap.querySelector('input');
          if (inp) inp.value = '';
        }
      });
    });
  }

  /* ── Productos: botones +/- y ajuste personalizado ──────── */
  function initAjustesProducto() {
    // +/- de 1 unidad
    $$('.btn-ajuste-stock').forEach(btn => {
      btn.addEventListener('click', function () {
        ejecutarAjusteStock(this.dataset.pk, this.dataset.accion, 1, '');
      });
    });

    // Modal de ajuste personalizado
    let pkActivo = null;

    $$('.btn-ajuste-custom').forEach(btn => {
      btn.addEventListener('click', function () {
        pkActivo = this.dataset.pk;
        document.getElementById('ajuste-nombre-producto').textContent = this.dataset.nombre;
        document.getElementById('ajuste-disponible-actual').textContent = this.dataset.disponible;
        document.getElementById('ajuste-cantidad').value = 1;
        document.getElementById('ajuste-motivo').value = '';
        document.getElementById('radioSumar').checked = true;
      });
    });

    document.getElementById('btnConfirmarAjuste')?.addEventListener('click', function () {
      if (!pkActivo) return;
      const accion   = $('input[name="ajuste-accion"]:checked')?.value;
      const cantidad = parseInt(document.getElementById('ajuste-cantidad').value, 10) || 0;
      const motivo   = document.getElementById('ajuste-motivo').value.trim();

      if (cantidad <= 0) {
        mostrarToast('La cantidad debe ser mayor a 0.', 'danger');
        return;
      }

      ejecutarAjusteStock(pkActivo, accion, cantidad, motivo, function () {
        bootstrap.Modal.getInstance(document.getElementById('modalAjusteStock'))?.hide();
      });
    });
  }

  /* ── Historial de movimientos ───────────────────────────── */
  function celda(texto, clases) {
    const td = document.createElement('td');
    if (clases) td.className = clases;
    td.textContent = texto;
    return td;
  }

  function initHistorial() {
    $$('.btn-historial').forEach(btn => {
      btn.addEventListener('click', function () {
        const pk = this.dataset.pk;
        const loading = document.getElementById('historial-loading');
        const vacio   = document.getElementById('historial-vacio');
        const wrap    = document.getElementById('historial-tabla-wrap');
        const tbody   = document.getElementById('historial-tbody');

        document.getElementById('historial-nombre-producto').textContent = this.dataset.nombre;
        loading.classList.remove('d-none');
        vacio.classList.add('d-none');
        wrap.classList.add('d-none');
        tbody.innerHTML = '';

        fetch(urlConPk(URL_HISTORIAL, pk), { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
          .then(r => r.json())
          .then(data => {
            loading.classList.add('d-none');
            if (!data.ok || !data.movimientos.length) {
              vacio.classList.remove('d-none');
              return;
            }

            data.movimientos.forEach(m => {
              const tr = document.createElement('tr');

              const tdFecha = document.createElement('td');
              const small = document.createElement('small');
              small.textContent = m.fecha;
              tdFecha.appendChild(small);

              const tdTipo = document.createElement('td');
              tdTipo.className = 'text-center';
              const badge = document.createElement('span');
              const tipos = {
                ENTRADA: ['bg-success', 'Entrada'],
                SALIDA:  ['bg-danger',  'Salida'],
              };
              const [cls, txt] = tipos[m.tipo] || ['bg-secondary', 'Ajuste'];
              badge.className = `badge ${cls}`;
              badge.textContent = txt;
              tdTipo.appendChild(badge);

              const tdCant = document.createElement('td');
              tdCant.className = 'text-center fw-bold';
              const spanCant = document.createElement('span');
              spanCant.className = m.cantidad > 0 ? 'text-success' : 'text-danger';
              spanCant.textContent = m.cantidad > 0 ? `+${m.cantidad}` : String(m.cantidad);
              tdCant.appendChild(spanCant);

              const tdMotivo = document.createElement('td');
              const smallMotivo = document.createElement('small');
              smallMotivo.textContent = m.motivo || '—';
              tdMotivo.appendChild(smallMotivo);

              const tdUsuario = document.createElement('td');
              const smallUsuario = document.createElement('small');
              smallUsuario.className = 'text-muted';
              smallUsuario.textContent = m.usuario;
              tdUsuario.appendChild(smallUsuario);

              tr.append(tdFecha, tdTipo, tdCant, tdMotivo, tdUsuario);
              tbody.appendChild(tr);
            });

            wrap.classList.remove('d-none');
          })
          .catch(() => {
            loading.classList.add('d-none');
            vacio.classList.remove('d-none');
          });
      });
    });
  }

  /* ── Materiales: botones +/- ────────────────────────────── */
  function initAjustesMaterial() {
    $$('.btn-ajuste-mat').forEach(btn => {
      btn.addEventListener('click', function () {
        ejecutarAjusteMaterial(this.dataset.pk, this.dataset.accion, 1, '');
      });
    });
  }

  /* ── Campos de dinero con separador de miles ────────────────
     <input data-miles-target="idDelHidden"> guarda solo los dígitos
     en el hidden y muestra el número formateado (es-CO).          */
  function initMiles() {
    $$('[data-miles-target]').forEach(input => {
      input.addEventListener('input', function () {
        const hidden = document.getElementById(this.dataset.milesTarget);
        if (hidden) hidden.value = soloDigitos(this.value);
        this.value = formatearMiles(this.value);
      });
    });
  }

  /* ── Modal "Registrar producto" ─────────────────────────────
     - Si el nombre coincide con un producto del catálogo, se reutiliza:
       sus datos se muestran bloqueados.
     - Si ese producto ya tiene inventario, se avisa y se bloquea el envío.
     - Si es nuevo, exige precio > 0.                                     */
  function initFormProducto() {
    const form = document.getElementById('formCrearInventario');
    if (!form) return;

    const inpNombre  = document.getElementById('nombreProductoInv');
    const inpCat     = document.getElementById('categoriaProductoInv');
    const inpPrecio  = document.getElementById('precioProductoDisplay');
    const hidPrecio  = document.getElementById('precioProductoHidden');
    const inpDesc    = document.getElementById('descripcionProductoInv');
    const inpMin     = document.getElementById('minimoDefinidoInv');
    const inpDisp    = document.getElementById('cantidadDisponibleInv');
    const lista      = document.getElementById('listaProductosExistentes');
    const avisoExiste = document.getElementById('avisoProductoExistente');
    const avisoConInv = document.getElementById('avisoProductoConInventario');
    const alertaForm  = document.getElementById('alertErrorInventario');
    const alertaTexto = document.getElementById('alertErrorInventarioTexto');
    const btnGuardar  = document.getElementById('btnRegistrarProducto');

    const camposProducto = [inpCat, inpPrecio, inpDesc];
    let rellenadoDesdeCatalogo = false;

    function buscarEnCatalogo(nombre) {
      const n = nombre.trim().toLowerCase();
      if (!n || !lista) return null;
      return Array.from(lista.options).find(o => o.value.trim().toLowerCase() === n) || null;
    }

    function bloquearCampos(bloquear) {
      camposProducto.forEach(c => { c.readOnly = bloquear; });
    }

    function limpiarCamposProducto() {
      inpCat.value = '';
      inpDesc.value = '';
      inpPrecio.value = '';
      hidPrecio.value = '';
      inpPrecio.classList.remove('is-invalid');
    }

    function alNombreCambiar() {
      const opt = buscarEnCatalogo(inpNombre.value);
      avisoConInv.classList.add('d-none');
      btnGuardar.disabled = false;

      if (opt) {
        inpCat.value    = opt.dataset.categoria || '';
        inpDesc.value   = opt.dataset.descripcion || '';
        const precioCat = Math.round(parseFloat(opt.dataset.precio) || 0);   // "35000.00" -> 35000
        hidPrecio.value = precioCat ? String(precioCat) : '';
        inpPrecio.value = precioCat ? formatearMiles(precioCat) : '';
        inpPrecio.classList.remove('is-invalid');
        bloquearCampos(true);
        rellenadoDesdeCatalogo = true;
        avisoExiste.classList.remove('d-none');

        if (opt.dataset.inv === '1') {
          avisoConInv.classList.remove('d-none');
          btnGuardar.disabled = true;
        }
      } else {
        avisoExiste.classList.add('d-none');
        bloquearCampos(false);
        if (rellenadoDesdeCatalogo) {
          limpiarCamposProducto();
          rellenadoDesdeCatalogo = false;
        }
      }
    }

    inpNombre.addEventListener('input', alNombreCambiar);
    inpNombre.addEventListener('change', alNombreCambiar);

    function validarStock() {
      const min  = parseInt(inpMin?.value, 10) || 0;
      const disp = parseInt(inpDisp?.value, 10) || 0;
      const fb   = document.getElementById('feedbackDisponibleInv');
      if (disp < 0) {
        inpDisp.classList.add('is-invalid');
        if (fb) fb.textContent = 'No puede ser negativo.';
        return false;
      }
      if (disp < min) {
        inpDisp.classList.add('is-invalid');
        if (fb) fb.textContent = `No puede ser menor al mínimo (${min}).`;
        return false;
      }
      inpDisp.classList.remove('is-invalid');
      return true;
    }

    function validarPrecio() {
      if (inpPrecio.readOnly) return true;          // producto existente: no aplica
      const precio = parseInt(hidPrecio.value, 10) || 0;
      inpPrecio.classList.toggle('is-invalid', precio <= 0);
      return precio > 0;
    }

    function mostrarError(texto) {
      alertaTexto.textContent = texto;
      alertaForm.classList.remove('d-none');
    }

    if (inpMin && inpDisp) {
      inpMin.addEventListener('input', validarStock);
      inpDisp.addEventListener('input', validarStock);
    }
    inpPrecio.addEventListener('input', validarPrecio);

    form.addEventListener('submit', function (e) {
      alertaForm.classList.add('d-none');

      if (!validarStock()) {
        e.preventDefault(); e.stopPropagation();
        mostrarError('El stock actual no puede ser menor al mínimo.');
        return;
      }
      if (!validarPrecio()) {
        e.preventDefault(); e.stopPropagation();
        mostrarError('Ingresa un precio mayor a 0 para el producto nuevo.');
        return;
      }
      if (!this.checkValidity()) {
        e.preventDefault(); e.stopPropagation();
        mostrarError('Completa todos los campos requeridos.');
      }
      this.classList.add('was-validated');
    });

    // Al cerrar el modal el formulario vuelve a su estado inicial
    document.getElementById('modalCrearInventario')?.addEventListener('hidden.bs.modal', function () {
      form.reset();
      form.classList.remove('was-validated');
      limpiarCamposProducto();
      bloquearCampos(false);
      rellenadoDesdeCatalogo = false;
      avisoExiste.classList.add('d-none');
      avisoConInv.classList.add('d-none');
      alertaForm.classList.add('d-none');
      inpDisp.classList.remove('is-invalid');
      btnGuardar.disabled = false;
      document.getElementById('ubicacionOtroWrapNuevo')?.classList.add('d-none');
    });
  }

  /* ── Modal "Nuevo material": validaciones ───────────────── */
  function initFormMaterial() {
    const form  = document.getElementById('formCrearMaterial');
    const minEl = document.getElementById('stockMinimoMat');
    const actEl = document.getElementById('stockActualMat');
    const alerta = document.getElementById('alertErrorMaterial');
    if (!form) return;

    function validarStock() {
      const min = parseFloat(minEl?.value) || 0;
      const act = parseFloat(actEl?.value) || 0;
      const fb  = document.getElementById('feedbackStockActualMat');
      if (act < 0) {
        actEl.classList.add('is-invalid');
        if (fb) fb.textContent = 'No puede ser negativo.';
        return false;
      }
      if (act < min) {
        actEl.classList.add('is-invalid');
        if (fb) fb.textContent = `No puede ser menor al mínimo (${min}).`;
        return false;
      }
      actEl.classList.remove('is-invalid');
      return true;
    }

    if (minEl && actEl) {
      minEl.addEventListener('input', validarStock);
      actEl.addEventListener('input', validarStock);
    }

    form.addEventListener('submit', function (e) {
      alerta?.classList.add('d-none');
      if (!validarStock()) {
        e.preventDefault(); e.stopPropagation();
        document.getElementById('alertErrorMaterialTexto').textContent = 'El stock actual no puede ser menor al mínimo.';
        alerta?.classList.remove('d-none');
        return;
      }
      if (!this.checkValidity()) {
        e.preventDefault(); e.stopPropagation();
        document.getElementById('alertErrorMaterialTexto').textContent = 'Completa todos los campos requeridos.';
        alerta?.classList.remove('d-none');
      }
      this.classList.add('was-validated');
    });
  }

  /* ── Reabrir modales si el servidor devolvió un error ───── */
  function reabrirModales() {
    if (cfgEl.dataset.reabrirInventario === '1') {
      bootstrap.Modal.getOrCreateInstance(document.getElementById('modalCrearInventario')).show();
    }
    if (cfgEl.dataset.reabrirMaterial === '1') {
      bootstrap.Modal.getOrCreateInstance(document.getElementById('modalCrearMaterial')).show();
    }
  }

  /* ── Arranque ───────────────────────────────────────────── */
  function init() {
    initTabs();
    initBuscadorEgresos();
    initUbicaciones();
    initAjustesProducto();
    initHistorial();
    initAjustesMaterial();
    initMiles();
    initFormProducto();
    initFormMaterial();
    reabrirModales();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();