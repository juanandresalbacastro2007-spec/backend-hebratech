# apps/administrador/views.py

import io
import os
import json
import openpyxl
from datetime import datetime, date

from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

from xhtml2pdf import pisa

from django.shortcuts import render, redirect, get_object_or_404
from django.contrib import messages
from django.contrib.auth.hashers import make_password
from django.db import connection, IntegrityError, transaction, models
from django.db.models import Q
from django.utils import timezone
from django.http import HttpResponse, JsonResponse, FileResponse, Http404
from django.conf import settings
from django.views.decorators.http import require_POST
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils.html import escape
from apps.clientes.models import Cotizacion
from django_fsm import can_proceed

from .models import (
    Usuario, Operario, Tarea,
    AsignacionTarea, Orden, Cliente, Incidencia, Inventario, Material, Producto, Factura,
    MovimientoStock,
)
from apps.core.decorators import login_required_rol
from apps.produccion.models import OrdenProduccion


from apps.proveedores.models import Proveedor


# ── Decorador de protección por rol (centralizado en apps.core) ────
admin_required = login_required_rol(rol_esperado='administrador', session_key='usuario_id')


# ── Transiciones válidas de Orden, para editar el estado desde el admin ──
TRANSICIONES_ORDEN = {
    ('Pendiente', 'Procesando'):  'marcar_en_produccion',
    ('Procesando', 'Enviado'):    'marcar_enviado',
    ('Enviado', 'Entregado'):     'marcar_entregado',
    ('Enviado', 'Procesando'):    'revertir_a_produccion',
    ('Pendiente', 'Cancelado'):   'cancelar',
    ('Procesando', 'Cancelado'):  'cancelar',
}


# ── Estados de Orden que se consideran finalizados (no se ofrecen
#    al asignar/editar tareas, ni cuentan como "activas") ──────────
ESTADOS_ORDEN_FINALIZADOS = ['Cancelado', 'Entregado']


# ── Ubicaciones predefinidas del inventario ─────────────────
UBICACIONES_PREDEFINIDAS = [
    'Bodega Principal',
    'Bodega Secundaria',
    'Bodega Formal',
    'Área de Producción',
    'Área de Despacho',
]


# ── Helpers para KPIs cross-módulo ──
def _count(modelo, **filtros):
    try:
        return modelo.objects.filter(**filtros).count() if filtros else modelo.objects.count()
    except Exception:
        return 0


def _safe_import(ruta_modulo, nombre_modelo):
    try:
        modulo = __import__(ruta_modulo, fromlist=[nombre_modelo])
        return getattr(modulo, nombre_modelo)
    except Exception:
        return None


# ── Helper: nivel de stock calculado (0-3) ──────────────────
def _calcular_nivel_stock(disponible: int, minimo: int) -> int:
    """
    Devuelve 0-3 en función de la relación stock/mínimo.
      0 = Crítico  (disponible == 0)
      1 = Bajo     (disponible < mínimo)
      2 = Normal   (mínimo <= disponible < 2×mínimo)
      3 = Alto     (disponible >= 2×mínimo)
    """
    if disponible == 0:
        return 0
    if minimo <= 0:
        return 3  # sin mínimo definido → siempre "Alto"
    ratio = disponible / minimo
    if ratio >= 2:
        return 3
    elif ratio >= 1:
        return 2
    else:
        return 1


# ── Portal principal ─────────────────────────────────────────
@admin_required
def admin_portal(request):
    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])

    total_usuarios = Usuario.objects.count()
    total_clientes = Cliente.objects.count()
    total_operarios = Operario.objects.filter(estado='activo').count()
    total_ordenes = Orden.objects.count()
    ordenes_pendientes = Orden.objects.filter(estado='Pendiente').count()
    tareas_pendientes = AsignacionTarea.objects.filter(estado='Pendiente').count()
    usuarios_pendientes = Usuario.objects.filter(estado='pendiente').count()
    total_cotizaciones = Cotizacion.objects.filter(idCliente__isnull=True).count()

    ultimas_ordenes = Orden.objects.order_by('-fechaCreacion')[:5]
    ultimas_asignaciones = AsignacionTarea.objects.order_by('-fechaAsignacion')[:5]

    # ── KPIs exclusivos ──
    Produccion = _safe_import('apps.produccion.models', 'Produccion')
    Proveedor = _safe_import('apps.proveedores.models', 'Proveedor')

    ordenes_urgentes = Orden.objects.filter(prioridad='Urgente').count()
    incidencias_abiertas = (
        Incidencia.objects.filter(estado='Pendiente').count()
        + Incidencia.objects.filter(estado='En Progreso').count()
    )
    productos_catalogo = Producto.objects.count()
    produccion_activa = (
        _count(Produccion, estado='En Progreso') + _count(Produccion, estado='Pendiente')
        if Produccion else 0
    )
    total_proveedores = _count(Proveedor) if Proveedor else None

    # ── Actividad reciente unificada ──
    actividad = []

    for o in Orden.objects.select_related('idCliente').order_by('-fechaCreacion')[:5]:
        cliente_nombre = '—'
        try:
            cliente_nombre = o.idCliente.empresa or o.idCliente.nombre or '—'
        except Exception:
            pass
        actividad.append({
            'icono': '🧾',
            'titulo': f'Orden #{o.idOrden} · {cliente_nombre}',
            'detalle': f'Estado: {o.estado} · Prioridad: {o.prioridad}',
            'fecha': str(o.fechaCreacion) if o.fechaCreacion else None,
            'estado': o.estado,
            'modulo': 'admin_ordenes',
        })

    if Produccion:
        try:
            for p in Produccion.objects.select_related('idProducto').order_by('-fechaInicio')[:5]:
                actividad.append({
                    'icono': '🧵',
                    'titulo': f'Producción: {p.idProducto.nombre}',
                    'detalle': f'{p.cantidadRequerida} unidades',
                    'fecha': str(p.fechaInicio) if p.fechaInicio else None,
                    'estado': p.estado,
                    'modulo': 'produccion_portal',
                })
        except Exception:
            pass

    try:
        for i in Incidencia.objects.order_by('-idIncidencia')[:5]:
            actividad.append({
                'icono': '⚠️',
                'titulo': getattr(i, 'tipoIncidencia', None) or (getattr(i, 'descripcion', '') or 'Incidencia')[:60],
                'detalle': f'Estado: {getattr(i, "estado", "—")}',
                'fecha': str(getattr(i, 'fechaGeneracion', '') or ''),
                'estado': getattr(i, 'estado', None),
                'modulo': 'admin_incidencias',
            })
    except Exception:
        pass

    actividad = [a for a in actividad if a['fecha']]
    actividad.sort(key=lambda a: a['fecha'], reverse=True)
    actividad_reciente = actividad[:10]

    # ── Alertas operativas ──
    alertas = []
    hoy = date.today()

    ordenes_retrasadas = Orden.objects.filter(
        fechaEntregaEstimada__lt=hoy
    ).exclude(estado__in=ESTADOS_ORDEN_FINALIZADOS).count()
    if ordenes_retrasadas:
        alertas.append({
            'tipo': 'danger', 'icono': '⏰',
            'texto': f'{ordenes_retrasadas} orden(es) con entrega vencida',
            'modulo': 'admin_ordenes',
        })

    if ordenes_urgentes:
        alertas.append({
            'tipo': 'warning', 'icono': '🔥',
            'texto': f'{ordenes_urgentes} orden(es) marcadas como urgentes',
            'modulo': 'admin_ordenes',
        })

    if usuarios_pendientes:
        alertas.append({
            'tipo': 'info', 'icono': '👤',
            'texto': f'{usuarios_pendientes} usuario(s) esperando aprobación de rol',
            'modulo': 'admin_usuarios',
        })

    if incidencias_abiertas:
        alertas.append({
            'tipo': 'warning', 'icono': '⚠️',
            'texto': f'{incidencias_abiertas} incidencia(s) sin resolver',
            'modulo': 'admin_incidencias',
        })

    return render(request, 'administrador/admin_portal.html', {
        'usuario': usuario,
        'total_usuarios': total_usuarios,
        'total_clientes': total_clientes,
        'total_operarios': total_operarios,
        'total_ordenes': total_ordenes,
        'total_cotizaciones': total_cotizaciones,
        'ordenes_pendientes': ordenes_pendientes,
        'tareas_pendientes': tareas_pendientes,
        'usuarios_pendientes': usuarios_pendientes,
        'ultimas_ordenes': ultimas_ordenes,
        'ultimas_asignaciones': ultimas_asignaciones,
        'ordenes_urgentes': ordenes_urgentes,
        'incidencias_abiertas': incidencias_abiertas,
        'productos_catalogo': productos_catalogo,
        'produccion_activa': produccion_activa,
        'total_proveedores': total_proveedores,
        'actividad_reciente': actividad_reciente,
        'alertas': json.dumps(alertas),
    })


# --cotizar --#
@admin_required
def cotizaciones_lista(request):
    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])

    # Solo las cotizaciones generadas por el administrador (sin cliente)
    cotizaciones = Cotizacion.objects.filter(
        idCliente__isnull=True
    ).select_related('idProducto').order_by('-fechaCreacion')

    # Datos para el modal "Nueva cotización"
    productos = Producto.objects.exclude(estado='inactivo').order_by('nombre')

    return render(request, 'administrador/cotizaciones_lista.html', {
        'usuario': usuario,
        'seccion_activa': 'cotizaciones',
        'cotizaciones': cotizaciones,
        'productos': productos,
    })


@admin_required
@require_POST
def cotizacion_crear(request):
    """Genera una cotización del administrador (idCliente queda en NULL)."""
    producto_id = request.POST.get('producto')
    cantidad = request.POST.get('cantidad')

    if not producto_id or not cantidad:
        return JsonResponse(
            {'error': 'Selecciona un producto y una cantidad.'},
            status=400
        )

    try:
        producto = Producto.objects.get(idProducto=producto_id)
    except (Producto.DoesNotExist, ValueError):
        return JsonResponse({'error': 'El producto seleccionado no existe.'}, status=400)

    try:
        cantidad_int = int(cantidad)
        if cantidad_int <= 0:
            raise ValueError
    except (ValueError, TypeError):
        return JsonResponse(
            {'error': 'La cantidad debe ser un número mayor a 0.'},
            status=400
        )

    cotizacion = Cotizacion.objects.create(
        idCliente=None,
        idProducto=producto,
        cantidad=cantidad_int,
        precioUnitario=producto.precio,
        subtotalEstimado=producto.precio * cantidad_int,
    )

    return JsonResponse({
        'ok': True,
        'idCotizacion': cotizacion.idCotizacion,
        'pdf_url': reverse('admin_cotizacion_pdf', args=[cotizacion.idCotizacion]),
    })


def _fmt_cop(valor):
    """1900000 -> '$1.900.000' (formato de miles con punto)."""
    return '${:,.0f}'.format(valor or 0).replace(',', '.')


@admin_required
def cotizacion_pdf(request, idCotizacion):
    """Descarga la cotización en PDF."""
    cot = get_object_or_404(
        Cotizacion.objects.select_related('idCliente', 'idProducto'),
        pk=idCotizacion
    )

    fecha = cot.fechaCreacion
    if timezone.is_aware(fecha):
        fecha = timezone.localtime(fecha)

    primario = colors.HexColor('#395B64')
    suave = colors.HexColor('#E7F6F2')
    borde = colors.HexColor('#A5C9CA')

    estilos = getSampleStyleSheet()
    st_marca = ParagraphStyle('CotMarca', parent=estilos['Title'],
                              textColor=primario, alignment=0, fontSize=22, leading=26)
    st_num = ParagraphStyle('CotNum', parent=estilos['Normal'],
                            fontSize=14, alignment=2, leading=26)
    st_txt = ParagraphStyle('CotTxt', parent=estilos['Normal'], fontSize=10, leading=13)
    st_nota = ParagraphStyle('CotNota', parent=estilos['Normal'], fontSize=8,
                             textColor=colors.grey)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=letter,
        leftMargin=50, rightMargin=50, topMargin=50, bottomMargin=50,
        title=f'Cotización #{cot.idCotizacion}'
    )

    elementos = []

    # Encabezado
    encabezado = Table(
        [[Paragraph('HebraTech', st_marca),
          Paragraph(f'Cotización #{cot.idCotizacion}', st_num)]],
        colWidths=[256, 256]
    )
    encabezado.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, 0), 1, borde),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
    ]))
    elementos += [encabezado, Spacer(1, 16)]

    # Datos del cliente
    filas_info = []
    if cot.idCliente:
        filas_info.append([Paragraph('<b>Cliente:</b>', st_txt),
                           Paragraph(escape(str(cot.idCliente)), st_txt)])
        if cot.idCliente.nit:
            filas_info.append([Paragraph('<b>NIT:</b>', st_txt),
                               Paragraph(escape(cot.idCliente.nit), st_txt)])
    filas_info.append([Paragraph('<b>Fecha:</b>', st_txt),
                       Paragraph(fecha.strftime('%d/%m/%Y %H:%M'), st_txt)])
    info = Table(filas_info, colWidths=[70, 442])
    info.setStyle(TableStyle([('BOTTOMPADDING', (0, 0), (-1, -1), 3)]))
    elementos += [info, Spacer(1, 18)]

    # Detalle
    nombre_producto = cot.idProducto.nombre if cot.idProducto else '—'
    detalle = Table(
        [
            ['Producto', 'Cantidad', 'Precio unitario', 'Subtotal'],
            [Paragraph(escape(nombre_producto), st_txt),
             f'{cot.cantidad:,}'.replace(',', '.'),
             _fmt_cop(cot.precioUnitario),
             _fmt_cop(cot.subtotalEstimado)],
        ],
        colWidths=[232, 70, 105, 105]
    )
    detalle.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), primario),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BACKGROUND', (0, 1), (-1, 1), suave),
        ('GRID', (0, 0), (-1, -1), 0.5, borde),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))
    elementos += [detalle, Spacer(1, 14)]

    # Total
    total = Table(
        [['Subtotal estimado:', _fmt_cop(cot.subtotalEstimado)]],
        colWidths=[150, 105], hAlign='RIGHT'
    )
    total.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 12),
        ('TEXTCOLOR', (0, 0), (-1, -1), primario),
        ('ALIGN', (0, 0), (-1, -1), 'RIGHT'),
    ]))
    elementos += [total, Spacer(1, 30)]

    elementos.append(Paragraph(
        'Valor estimado sujeto a confirmación por parte de HebraTech.', st_nota
    ))

    doc.build(elementos)

    response = HttpResponse(buffer.getvalue(), content_type='application/pdf')
    response['Content-Disposition'] = (
        f'attachment; filename="Cotizacion_{cot.idCotizacion}.pdf"'
    )
    return response

# ── Usuarios ─────────────────────────────────────────────────
@admin_required
def usuarios_lista(request):
    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])
    usuarios = Usuario.objects.all().order_by('-idUsuario')

    estado_filtro = request.GET.get('estado', '')
    if estado_filtro:
        usuarios = usuarios.filter(estado=estado_filtro)

    return render(request, 'administrador/usuarios_lista.html', {
        'usuario': usuario,
        'usuarios': usuarios,
        'estado_filtro': estado_filtro,
    })


@admin_required
def usuario_crear(request):
    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])

    if request.method == 'POST':
        nombre = request.POST.get('nombre')
        apellido = request.POST.get('apellido')
        correo = request.POST.get('correoElectronico')
        contrasena = request.POST.get('contrasena')
        telefono = request.POST.get('telefono', '')
        rol = request.POST.get('rol', 'cliente')

        if Usuario.objects.filter(correoElectronico=correo).exists():
            messages.error(request, 'Ya existe un usuario con ese correo.')
            return redirect('admin_usuario_crear')

        with connection.cursor() as cursor:
            cursor.execute("""
                INSERT INTO usuarios
                    (nombre, apellido, correoElectronico, contrasena, telefono, rol, estado)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, [nombre, apellido, correo, make_password(contrasena),
                  telefono or None, rol, 'activo'])

            id_nuevo = cursor.lastrowid

            if rol == 'cliente':
                cursor.execute("""
                    INSERT INTO clientes (idUsuario, tipoCliente, nombre, correoElectronico, estado)
                    VALUES (%s, %s, %s, %s, %s)
                """, [id_nuevo, 'Natural', f'{nombre} {apellido}', correo, 'activo'])

            elif rol == 'operario':
                especialidad = request.POST.get('especialidad', 'General')
                cursor.execute("""
                    INSERT INTO operarios (idUsuario, especialidad, fechaIngreso, estado)
                    VALUES (%s, %s, CURDATE(), %s)
                """, [id_nuevo, especialidad, 'activo'])

        messages.success(request, f'Usuario {nombre} {apellido} creado correctamente.')
        return redirect('admin_usuarios')

    return render(request, 'administrador/usuario_form.html', {
        'usuario': usuario,
        'accion': 'Crear',
    })


@admin_required
def usuario_editar(request, idUsuario):
    usuario_admin = Usuario.objects.get(idUsuario=request.session['usuario_id'])
    usuario_editar_obj = Usuario.objects.get(idUsuario=idUsuario)

    if request.method == 'POST':
        nombre = request.POST.get('nombre')
        apellido = request.POST.get('apellido')
        correo = request.POST.get('correoElectronico')
        telefono = request.POST.get('telefono', '')
        rol = request.POST.get('rol')
        estado = request.POST.get('estado')

        usuario_editar_obj.nombre = nombre
        usuario_editar_obj.apellido = apellido
        usuario_editar_obj.correoElectronico = correo
        usuario_editar_obj.telefono = telefono or None
        usuario_editar_obj.rol = rol
        usuario_editar_obj.estado = estado
        usuario_editar_obj.save()

        with connection.cursor() as cursor:
            if rol == 'cliente':
                cursor.execute(
                    "SELECT idCliente FROM clientes WHERE idUsuario = %s", [idUsuario]
                )
                if cursor.fetchone() is None:
                    cursor.execute("""
                        INSERT INTO clientes (idUsuario, tipoCliente, nombre, correoElectronico, estado)
                        VALUES (%s, %s, %s, %s, %s)
                    """, [idUsuario, 'Natural', f'{nombre} {apellido}', correo, 'activo'])

            elif rol == 'operario':
                cursor.execute(
                    "SELECT idOperario FROM operarios WHERE idUsuario = %s", [idUsuario]
                )
                if cursor.fetchone() is None:
                    especialidad = request.POST.get('especialidad', 'General')
                    cursor.execute("""
                        INSERT INTO operarios (idUsuario, especialidad, fechaIngreso, estado)
                        VALUES (%s, %s, CURDATE(), %s)
                    """, [idUsuario, especialidad, 'activo'])

        messages.success(request, f'Usuario {nombre} actualizado correctamente.')
        return redirect('admin_usuarios')

    return render(request, 'administrador/usuario_form.html', {
        'usuario': usuario_admin,
        'usuario_editar': usuario_editar_obj,
        'accion': 'Editar',
    })


@admin_required
def usuario_eliminar(request, idUsuario):
    if request.method == 'POST':
        usuario_obj = get_object_or_404(Usuario, idUsuario=idUsuario)

        if usuario_obj.rol != 'operario':
            messages.error(request, '⚠️ No está permitido eliminar usuarios con rol diferente a Operario.')
            return redirect('admin_usuarios')

        nombre = f'{usuario_obj.nombre} {usuario_obj.apellido}'
        usuario_obj.delete()
        messages.success(request, f'✅ Usuario operario {nombre} eliminado correctamente.')

    return redirect('admin_usuarios')


# ── Órdenes ──────────────────────────────────────────────────
@admin_required
def ordenes_lista(request):
    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])
    ordenes = Orden.objects.select_related('idCliente', 'idProducto').order_by('-fechaCreacion')

    buscar_filtro = request.GET.get('buscar', '')
    if buscar_filtro:
        ordenes = ordenes.filter(
            Q(idOrden__icontains=buscar_filtro) |
            Q(idCliente__nombre__icontains=buscar_filtro) |
            Q(idCliente__empresa__icontains=buscar_filtro)
        )

    estado_filtro = request.GET.get('estado', '')
    if estado_filtro:
        ordenes = ordenes.filter(estado=estado_filtro)

    prioridad_filtro = request.GET.get('prioridad', '')
    if prioridad_filtro:
        ordenes = ordenes.filter(prioridad=prioridad_filtro)

    return render(request, 'administrador/ordenes_lista.html', {
        'usuario': usuario,
        'ordenes': ordenes,
        'estado_filtro': estado_filtro,
        'buscar_filtro': buscar_filtro,
        'prioridad_filtro': prioridad_filtro,
        'transiciones_orden': TRANSICIONES_ORDEN,
    })


@admin_required
def orden_editar(request, idOrden):
    if request.method == 'POST':
        orden = get_object_or_404(Orden, pk=idOrden)
        cantidad = request.POST.get('cantidad')
        precio_unitario = request.POST.get('precio_unitario')
        fecha_entrega = request.POST.get('fecha_entrega')
        prioridad = request.POST.get('prioridad')
        nuevo_estado = request.POST.get('estado')

        orden.cantidad = int(cantidad) if cantidad and cantidad.strip() else None
        orden.precioUnitario = float(precio_unitario) if precio_unitario and precio_unitario.strip() else None
        orden.fechaEntregaEstimada = fecha_entrega if fecha_entrega and fecha_entrega.strip() else None
        orden.prioridad = prioridad

        if nuevo_estado and nuevo_estado != orden.estado:
            metodo_nombre = TRANSICIONES_ORDEN.get((orden.estado, nuevo_estado))
            if not metodo_nombre:
                messages.error(
                    request,
                    f'No se puede pasar la orden #{idOrden} de "{orden.estado}" a "{nuevo_estado}".'
                )
                return redirect('admin_ordenes')
            metodo = getattr(orden, metodo_nombre)
            if not can_proceed(metodo):
                messages.error(request, f'Transición "{metodo_nombre}" no permitida en este momento.')
                return redirect('admin_ordenes')
            metodo()

        orden.save()
        messages.success(request, f'La orden #{idOrden} se ha modificado con éxito.')

    return redirect('admin_ordenes')


@admin_required
def orden_eliminar(request, idOrden):
    try:
        orden = get_object_or_404(Orden, pk=idOrden)
        orden.delete()
        messages.success(request, f'La orden #{idOrden} se eliminó correctamente.')
    except Exception as e:
        messages.error(request, f'Error al intentar eliminar la orden: {str(e)}')
    return redirect('admin_ordenes')


# ── Helpers de fechas ────────────────────────────────────────
def _parsear_fecha(valor):
    """Convierte 'YYYY-MM-DD' (input type=date) a date, o None si viene vacío."""
    if not valor or not valor.strip():
        return None
    return datetime.strptime(valor.strip(), '%Y-%m-%d').date()


# ── Tareas ───────────────────────────────────────────────────
@admin_required
def tarea_asignar(request):
    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])
    operarios = Operario.objects.filter(estado='activo').select_related('idUsuario')
    tareas = Tarea.objects.all()
    # Órdenes de producción activas — para conectar la tarea con
    # recalcular_produccion_desde_tareas() y que el avance se calcule solo.
    ordenes_produccion = OrdenProduccion.objects.exclude(
        estado__in=['Completado', 'Cancelada']
    ).select_related('idProducto').order_by('-fechaCreacion')

    if request.method == 'POST':
        id_tarea = request.POST.get('tarea')
        tarea_personalizada = request.POST.get('tarea_personalizada', '').strip()
        proceso_personalizado = request.POST.get('proceso_personalizado', '').strip()
        ids_operarios = request.POST.getlist('operarios')
        id_orden_produccion = request.POST.get('orden_produccion')
        descripcion = request.POST.get('descripcion')
        fecha_inicio = request.POST.get('fechaInicio')
        fecha_limite = request.POST.get('fechaLimite')
        prioridad = request.POST.get('prioridad', 'Media')
        cantidad = request.POST.get('cantidadPrendas')
        horas_estimadas = request.POST.get('horasEstimadas')

        try:
            if not ids_operarios:
                messages.error(request, 'Debes seleccionar al menos un operario.')
                return redirect('admin_tarea_asignar')

            # Se calcula ANTES de crear/actualizar la tarea, porque esta
            # se usa en ambos casos (idProduccion=orden_produccion...).
            orden_produccion = None
            if id_orden_produccion:
                try:
                    orden_produccion = OrdenProduccion.objects.get(pk=id_orden_produccion)
                except OrdenProduccion.DoesNotExist:
                    messages.error(request, 'La orden de producción seleccionada no existe.')
                    return redirect('admin_tarea_asignar')

                if orden_produccion.estado in ('Completado', 'Cancelada'):
                    messages.error(
                        request,
                        f'La orden de producción {orden_produccion.numero} ya está '
                        f'"{orden_produccion.estado}" y no admite nuevas tareas.'
                    )
                    return redirect('admin_tarea_asignar')

            if id_tarea == 'otra':
                if not tarea_personalizada:
                    messages.error(request, 'Por favor, ingresa el nombre de la tarea personalizada.')
                    return redirect('admin_tarea_asignar')
                if not proceso_personalizado:
                    messages.error(request, 'Por favor, ingresa el proceso/categoría de la tarea.')
                    return redirect('admin_tarea_asignar')

                tarea = Tarea.objects.create(
                    nombreTarea=tarea_personalizada,
                    descripcionTarea=descripcion or f'Tarea personalizada: {tarea_personalizada}',
                    proceso=proceso_personalizado,
                    complejidad='media',
                    idProduccion=orden_produccion.idOrdenProduccion if orden_produccion else None,
                )
                mensaje_tarea = f'✓ Tarea personalizada "{tarea_personalizada}" creada. '
            else:
                try:
                    tarea = Tarea.objects.get(idTarea=id_tarea)
                    mensaje_tarea = ''
                except Tarea.DoesNotExist:
                    messages.error(request, 'La tarea seleccionada no existe.')
                    return redirect('admin_tarea_asignar')

                # Nota: idProduccion vive en Tarea (el catálogo maestro), no en
                # AsignacionTarea. Si esta tarea de catálogo se reutiliza en
                # varias órdenes, solo queda conectada a la última orden de
                # producción con la que se asigne. Para tareas 100% únicas por
                # orden, usa "+ Otra (crear nueva tarea)".
                if orden_produccion and tarea.idProduccion != orden_produccion.idOrdenProduccion:
                    tarea.idProduccion = orden_produccion.idOrdenProduccion
                    tarea.save(update_fields=['idProduccion'])

            operarios_seleccionados = list(
                Operario.objects.select_related('idUsuario').filter(idOperario__in=ids_operarios)
            )
            if len(operarios_seleccionados) != len(ids_operarios):
                messages.error(request, 'Uno o más operarios seleccionados no existen.')
                return redirect('admin_tarea_asignar')

            ESTADOS_ACTIVOS = ['Pendiente', 'En Progreso']
            ocupados = []
            for operario in operarios_seleccionados:
                tiene_activa = AsignacionTarea.objects.filter(
                    idOperario=operario,
                    estado__in=ESTADOS_ACTIVOS
                ).exists()
                if tiene_activa:
                    ocupados.append(f'{operario.idUsuario.nombre} {operario.idUsuario.apellido}')

            if ocupados:
                messages.error(
                    request,
                    'No se puede asignar: los siguientes operarios ya tienen una tarea activa '
                    '(Pendiente o En Progreso) → ' + ', '.join(ocupados) +
                    '. Un operario solo puede tener una tarea activa a la vez.'
                )
                return redirect('admin_tarea_asignar')

            cantidad_int = int(cantidad) if cantidad and cantidad.strip() else None

            fecha_inicio_dt = _parsear_fecha(fecha_inicio)
            fecha_limite_dt = _parsear_fecha(fecha_limite)

            if fecha_inicio_dt and fecha_inicio_dt < date.today():
                messages.error(request, 'La fecha de inicio no puede ser anterior a hoy.')
                return redirect('admin_tarea_asignar')

            if fecha_limite_dt and fecha_limite_dt < date.today():
                messages.error(request, 'La fecha límite no puede ser anterior a hoy.')
                return redirect('admin_tarea_asignar')

            if fecha_inicio_dt and fecha_limite_dt and fecha_limite_dt < fecha_inicio_dt:
                messages.error(
                    request,
                    'La fecha límite no puede ser anterior a la fecha de inicio.'
                )
                return redirect('admin_tarea_asignar')

            horas_calculadas = float(horas_estimadas) if horas_estimadas and horas_estimadas.strip() else 0.5

            asignaciones_creadas = []
            for operario in operarios_seleccionados:
                asignacion = AsignacionTarea.objects.create(
                    idTarea=tarea,
                    idOperario=operario,
                    descripcion=descripcion,
                    fechaInicio=fecha_inicio_dt,
                    fechaLimite=fecha_limite_dt,
                    prioridad=prioridad,
                    cantidadPrendas=cantidad_int,
                    horasEstimadas=horas_calculadas,
                    estado='Pendiente'
                )
                asignaciones_creadas.append(asignacion)

            nombres = ', '.join(
                f'{op.idUsuario.nombre} {op.idUsuario.apellido}' for op in operarios_seleccionados
            )
            messages.success(
                request,
                f'{mensaje_tarea}Se crearon {len(asignaciones_creadas)} asignación(es) correctamente. '
                f'Tarea asignada a: {nombres}.'
            )
            return redirect('admin_tareas')

        except Exception as e:
            messages.error(request, f'Error al asignar tarea: {str(e)}')
            return redirect('admin_tarea_asignar')

    return render(request, 'administrador/tarea_asignar.html', {
        'usuario': usuario,
        'operarios': operarios,
        'tareas': tareas,
        'ordenes_produccion': ordenes_produccion,
    })


@admin_required
def tareas_lista(request):
    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])
    asignaciones = AsignacionTarea.objects.select_related(
        'idTarea', 'idOperario__idUsuario', 'idOrden'
    ).order_by('-fechaAsignacion')

    buscar_filtro = request.GET.get('buscar', '')
    if buscar_filtro:
        asignaciones = asignaciones.filter(
            Q(idTarea__nombreTarea__icontains=buscar_filtro) |
            Q(idOperario__idUsuario__nombre__icontains=buscar_filtro) |
            Q(idOperario__idUsuario__apellido__icontains=buscar_filtro)
        )

    estado_filtro = request.GET.get('estado', '')
    if estado_filtro:
        asignaciones = asignaciones.filter(estado=estado_filtro)

    # ── Órdenes disponibles para el selector "Orden relacionada" ──
    # Incluye las órdenes activas (no finalizadas) MÁS las órdenes
    # que ya están vinculadas a alguna de las asignaciones mostradas,
    # aunque esas órdenes ya estén en estado Cancelado/Entregado.
    # Esto evita que el modal de editar muestre el campo "vacío"
    # cuando la orden vinculada terminó finalizándose después.
    ordenes_activas = Orden.objects.exclude(estado__in=ESTADOS_ORDEN_FINALIZADOS)
    ordenes_vinculadas = Orden.objects.filter(asignaciones__in=asignaciones)
    ordenes = (ordenes_activas | ordenes_vinculadas) \
        .distinct() \
        .select_related('idCliente') \
        .order_by('-fechaCreacion')

    return render(request, 'administrador/tareas_lista.html', {
        'usuario': usuario,
        'asignaciones': asignaciones,
        'buscar_filtro': buscar_filtro,
        'estado_filtro': estado_filtro,
        'ordenes': ordenes,
    })


@admin_required
def tarea_editar(request, idAsignacion):
    asignacion = get_object_or_404(AsignacionTarea, pk=idAsignacion)

    if request.method == 'POST':
        descripcion = request.POST.get('descripcion')
        fecha_inicio = request.POST.get('fecha_inicio')
        fecha_limite = request.POST.get('fecha_limite')
        estado = request.POST.get('estado')
        prioridad = request.POST.get('prioridad')
        cantidad_prendas = request.POST.get('cantidadPrendas')
        horas_estimadas = request.POST.get('horas_estimadas')
        id_orden = request.POST.get('orden')

        try:
            if descripcion is not None:
                asignacion.descripcion = descripcion

            fecha_inicio_dt = _parsear_fecha(fecha_inicio)
            fecha_limite_dt = _parsear_fecha(fecha_limite)

            if fecha_inicio_dt:
                asignacion.fechaInicio = fecha_inicio_dt
            asignacion.fechaLimite = fecha_limite_dt

            if estado:
                asignacion.estado = estado
            if prioridad:
                asignacion.prioridad = prioridad

            asignacion.cantidadPrendas = int(cantidad_prendas) if cantidad_prendas and cantidad_prendas.strip() else None

            if horas_estimadas and horas_estimadas.strip():
                asignacion.horasEstimadas = float(horas_estimadas)

            if id_orden:
                try:
                    asignacion.idOrden = Orden.objects.get(idOrden=id_orden)
                except Orden.DoesNotExist:
                    messages.error(request, 'La orden seleccionada no existe.')
                    return redirect('admin_tareas')
            else:
                asignacion.idOrden = None

            asignacion.save()

            id_produccion = getattr(asignacion.idTarea, 'idProduccion', None)
            if id_produccion:
                from apps.produccion.services import recalcular_produccion_desde_tareas
                recalcular_produccion_desde_tareas(id_produccion)

            messages.success(request, f'Asignación #{idAsignacion} actualizada correctamente.')
        except Exception as e:
            messages.error(request, f'Error al actualizar la asignación: {str(e)}')

    return redirect('admin_tareas')


@admin_required
def tarea_eliminar(request, idAsignacion):
    if request.method == 'POST':
        try:
            asignacion = get_object_or_404(AsignacionTarea, pk=idAsignacion)
            asignacion.delete()
            messages.success(request, f'Asignación #{idAsignacion} eliminada correctamente.')
        except Exception as e:
            messages.error(request, f'Error al eliminar la asignación: {str(e)}')
    return redirect('admin_tareas')


# ── Incidencias ──────────────────────────────────────────────
@admin_required
def incidencias_lista(request):
    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])
    incidencias = Incidencia.objects.all().order_by('-fechaGeneracion')

    buscar_filtro = request.GET.get('buscar', '')
    if buscar_filtro:
        incidencias = incidencias.filter(
            Q(tipoIncidencia__icontains=buscar_filtro) |
            Q(idOperario__idUsuario__nombre__icontains=buscar_filtro) |
            Q(idOperario__idUsuario__apellido__icontains=buscar_filtro)
        )

    estado_filtro = request.GET.get('estado', '')
    if estado_filtro:
        incidencias = incidencias.filter(estado=estado_filtro)

    MESES_ES = {
        1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril', 5: 'Mayo', 6: 'Junio',
        7: 'Julio', 8: 'Agosto', 9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
    }
    hoy = date.today()
    periodo_actual = f'{MESES_ES[hoy.month]} {hoy.year}'

    return render(request, 'administrador/incidencias_lista.html', {
        'usuario': usuario,
        'incidencias': incidencias,
        'buscar_filtro': buscar_filtro,
        'estado_filtro': estado_filtro,
        'periodo_actual': periodo_actual,
    })


@admin_required
def incidencia_editar(request, idIncidencia):
    if request.method == 'POST':
        incidencia = get_object_or_404(Incidencia, pk=idIncidencia)
        incidencia.tipoIncidencia = request.POST.get('tipoIncidencia')
        incidencia.descripcion = request.POST.get('descripcion')
        periodo_evaluado = (request.POST.get('periodoEvaluado') or '').strip()
        if not periodo_evaluado:
            MESES_ES = {
                1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril', 5: 'Mayo', 6: 'Junio',
                7: 'Julio', 8: 'Agosto', 9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
            }
            hoy = date.today()
            periodo_evaluado = f'{MESES_ES[hoy.month]} {hoy.year}'
        incidencia.periodoEvaluado = periodo_evaluado
        incidencia.estado = request.POST.get('estado')
        fecha_revision = request.POST.get('fechaRevision')
        incidencia.fechaRevision = fecha_revision if fecha_revision and fecha_revision.strip() else None

        nueva_respuesta = (request.POST.get('respuesta') or '').strip() or None
        if nueva_respuesta != incidencia.respuesta:
            incidencia.respuestaLeida = False
        incidencia.respuesta = nueva_respuesta

        incidencia.save()
        messages.success(request, f'Incidencia #{idIncidencia} actualizada correctamente.')
    return redirect('admin_incidencias')


@admin_required
def incidencia_eliminar(request, idIncidencia):
    if request.method == 'POST':
        try:
            incidencia = get_object_or_404(Incidencia, pk=idIncidencia)
            incidencia.delete()
            messages.success(request, f'Incidencia #{idIncidencia} eliminada correctamente.')
        except Exception as e:
            messages.error(request, f'Error al eliminar la incidencia: {str(e)}')
    return redirect('admin_incidencias')


# ── Facturas ─────────────────────────────────────────────────
@admin_required
def facturas_lista(request):
    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])
    facturas = Factura.objects.select_related('idCliente', 'idOrden').order_by('-fechaEmision')

    buscar_filtro = request.GET.get('buscar', '')
    if buscar_filtro:
        facturas = facturas.filter(
            Q(numeroFactura__icontains=buscar_filtro) |
            Q(idCliente__nombre__icontains=buscar_filtro) |
            Q(idCliente__empresa__icontains=buscar_filtro) |
            Q(idOrden__idOrden__icontains=buscar_filtro)
        )

    estado_filtro = request.GET.get('estado', '')
    if estado_filtro:
        facturas = facturas.filter(estado=estado_filtro)

    return render(request, 'administrador/facturas_lista.html', {
        'usuario': usuario,
        'facturas': facturas,
        'buscar_filtro': buscar_filtro,
        'estado_filtro': estado_filtro,
        'seccion_activa': 'facturas',
    })


@admin_required
def factura_marcar_pagada(request, idFactura):
    if request.method == 'POST':
        try:
            factura = get_object_or_404(Factura, pk=idFactura)
            if factura.estado == 'Pagada':
                messages.warning(request, f'La factura {factura.numeroFactura} ya estaba marcada como pagada.')
            else:
                factura.estado = 'Pagada'
                factura.fechaPago = timezone.now()
                factura.save()
                messages.success(request, f'Factura {factura.numeroFactura} marcada como pagada.')
        except Exception as e:
            messages.error(request, f'Error al actualizar la factura: {str(e)}')
    return redirect('admin_facturas')


@admin_required
def factura_descargar(request, idFactura):
    factura = get_object_or_404(Factura, pk=idFactura)
    ruta = os.path.join(settings.MEDIA_ROOT, factura.rutaPDF)
    if not os.path.exists(ruta):
        raise Http404('El archivo de la factura no fue encontrado.')
    return FileResponse(
        open(ruta, 'rb'),
        as_attachment=True,
        filename=os.path.basename(ruta)
    )


# ── Módulos / Placeholders externos ──────────────────────────
@admin_required
def produccion_placeholder(request):
    return redirect('produccion_portal')


# ── Exportar Órdenes a Excel y PDF ───────────────────────────
@admin_required
def exportar_ordenes_excel(request):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Órdenes HebraTech"

    HEADER_FILL = PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid")
    ZEBRA_FILL = PatternFill(start_color="F2F5F9", end_color="F2F5F9", fill_type="solid")
    FONT_HEADER = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    FONT_REGULAR = Font(name="Calibri", size=11)
    THIN_BORDER = Border(
        left=Side(style='thin', color='D9D9D9'), right=Side(style='thin', color='D9D9D9'),
        top=Side(style='thin', color='D9D9D9'), bottom=Side(style='thin', color='D9D9D9')
    )

    headers = ["ID Orden", "Cliente / Empresa", "Fecha Creación", "Entrega Estimada",
               "Cantidad", "Precio Unitario", "Total", "Prioridad", "Estado"]
    ws.append(headers)

    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num)
        cell.fill = HEADER_FILL
        cell.font = FONT_HEADER
        cell.alignment = Alignment(horizontal="center", vertical="center")

    ordenes = Orden.objects.all().select_related('idCliente__idUsuario').order_by('-fechaCreacion')
    buscar_filtro = request.GET.get('buscar', '')
    if buscar_filtro:
        ordenes = ordenes.filter(
            Q(idOrden__icontains=buscar_filtro) |
            Q(idCliente__nombre__icontains=buscar_filtro) |
            Q(idCliente__empresa__icontains=buscar_filtro)
        )
    estado_filtro = request.GET.get('estado', '')
    if estado_filtro:
        ordenes = ordenes.filter(estado=estado_filtro)

    for idx, orden in enumerate(ordenes, start=2):
        cliente_nombre = orden.idCliente.empresa or orden.idCliente.nombre or f"Cliente #{orden.idCliente.idCliente}"
        ws.append([
            orden.idOrden, cliente_nombre,
            orden.fechaCreacion.strftime('%Y-%m-%d') if orden.fechaCreacion else "",
            orden.fechaEntregaEstimada.strftime('%Y-%m-%d') if orden.fechaEntregaEstimada else "",
            orden.cantidad or 0,
            float(orden.precioUnitario) if orden.precioUnitario else 0,
            f"=E{idx}*F{idx}",
            orden.prioridad, orden.estado
        ])
        is_zebra = (idx % 2 == 0)
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=idx, column=col_idx)
            cell.font = FONT_REGULAR
            cell.border = THIN_BORDER
            if is_zebra:
                cell.fill = ZEBRA_FILL
            if col_idx in [1, 3, 4, 8, 9]:
                cell.alignment = Alignment(horizontal="center")
            elif col_idx == 5:
                cell.alignment = Alignment(horizontal="right")
                cell.number_format = "#,##0"
            elif col_idx in [6, 7]:
                cell.alignment = Alignment(horizontal="right")
                cell.number_format = "$#,##0.00"

    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            if cell.value:
                max_len = max(max_len, len(str(cell.value)))
        ws.column_dimensions[col_letter].width = max(max_len + 4, 12)

    response = HttpResponse(content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response['Content-Disposition'] = 'attachment; filename="HebraTech_Reporte_Ordenes.xlsx"'
    wb.save(response)
    return response


@admin_required
def exportar_ordenes_pdf(request):
    ordenes = Orden.objects.all().select_related('idCliente__idUsuario').order_by('-fechaCreacion')
    buscar_filtro = request.GET.get('buscar', '')
    if buscar_filtro:
        ordenes = ordenes.filter(
            Q(idOrden__icontains=buscar_filtro) |
            Q(idCliente__nombre__icontains=buscar_filtro) |
            Q(idCliente__empresa__icontains=buscar_filtro)
        )
    estado_filtro = request.GET.get('estado', '')
    if estado_filtro:
        ordenes = ordenes.filter(estado=estado_filtro)

    html_string = render_to_string('administrador/ordenes_pdf.html', {'ordenes': ordenes})
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="HebraTech_Reporte_Ordenes.pdf"'
    pisa_status = pisa.CreatePDF(html_string, dest=response)
    if pisa_status.err:
        return HttpResponse('Hubo un error al generar el PDF', status=500)
    return response


# ── Inventario y Materiales ──────────────────────────────────
@admin_required
def inventario_lista(request):
    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])

    buscar = request.GET.get('buscar', '').strip()

    inventario_list  = Inventario.objects.all().select_related('producto', 'cliente')
    materiales_list  = Material.objects.all().select_related('proveedor')
    productos_list   = Producto.objects.all().order_by('nombre')
    clientes_list    = Cliente.objects.all().order_by('nombre')

    if buscar:
        inventario_list = inventario_list.filter(
            Q(producto__nombre__icontains=buscar) |
            Q(idInventario__icontains=buscar)     |
            Q(ubicacion__icontains=buscar)        |
            Q(cliente__empresa__icontains=buscar) |
            Q(cliente__nombre__icontains=buscar)
        )
        materiales_list = materiales_list.filter(
            Q(nombreMaterial__icontains=buscar) |
            Q(descripcion__icontains=buscar)    |
            Q(idMaterial__icontains=buscar)     |
            Q(proveedor__nombreEmpresa__icontains=buscar)
        )

    # ── KPIs de alerta para las badges de las pestañas ──
    alertas_stock = inventario_list.filter(
        cantidadDisponible__lte=models.F('minimoDefinido')
    ).count()
    alertas_materiales = materiales_list.filter(
        stockActual__lte=models.F('stockMinimo')
    ).count()

    # nivelStock se recalcula al mostrar: las filas antiguas guardan otros
    # valores (120, 60, 45...) y saldrían como "Crítico" en la tabla.
    inventario_list = list(inventario_list)
    for it in inventario_list:
        it.nivelStock = _calcular_nivel_stock(it.cantidadDisponible, it.minimoDefinido)

    # Para el modal "Agregar al inventario": el inventario se alimenta del
    # catálogo (módulo Productos). Solo se ofrecen los productos activos que
    # todavía no tienen registro de inventario (uno por producto).
    ids_con_inventario = set(Inventario.objects.values_list('producto_id', flat=True))
    productos_sin_inventario = [
        p for p in productos_list
        if p.idProducto not in ids_con_inventario and (p.estado or 'activo') != 'inactivo'
    ]

    # Pestaña "Productos" (catálogo): categorías y datos para el modal de edición
    categorias_list = sorted({
        p.categoria for p in productos_list
        if p.categoria and p.categoria != 'Sin categoría'
    })
    catalogo_data = {
        p.idProducto: {
            'nombre':      p.nombre,
            'categoria':   p.categoria,
            'precio':      str(p.precio),
            'descripcion': p.descripcion,
            'estado':      p.estado or 'activo',
        }
        for p in productos_list
    }
    catalogo_sin_precio = sum(1 for p in productos_list if p.precio <= 0)

    # Pestaña "Materias Primas": proveedores para crear (activos) y editar (todos)
    proveedores_todos = Proveedor.objects.all().order_by('nombreEmpresa')
    proveedores_list = [p for p in proveedores_todos if (p.estado or 'activo') == 'activo']

    context = {
        'usuario':            usuario,
        'seccion_activa':     'inventario',
        'inventario_list':    inventario_list,
        'total_items':        len(inventario_list),
        'materiales_list':    materiales_list,
        'total_materiales':   materiales_list.count(),
        'productos_list':     productos_list,
        'productos_sin_inventario': productos_sin_inventario,
        'ids_con_inventario': ids_con_inventario,
        'categorias_list':    categorias_list,
        'catalogo_data':      catalogo_data,
        'catalogo_sin_precio': catalogo_sin_precio,
        'proveedores_list':   proveedores_list,
        'proveedores_todos':  proveedores_todos,
        'clientes_list':      clientes_list,
        'buscar_filtro':      buscar,
        'ubicaciones_predefinidas': UBICACIONES_PREDEFINIDAS,
        'alertas_stock':      alertas_stock,
        'alertas_materiales': alertas_materiales,
        'today':              timezone.now().date(),
    }
    return render(request, 'administrador/inventario_lista.html', context)


# ── CRUD: MATERIALES ─────────────────────────────────────────

# ══════════════════════════════════════════════════════════════
#  MATERIALES (pestaña "Materias Primas" del Inventario)
#  Se registran, editan y eliminan desde esa pestaña.
# ══════════════════════════════════════════════════════════════

def _volver_a_inventario(tab=None):
    """Redirige a la página de Inventario abriendo la pestaña indicada
    ('materiales' o 'catalogo'); sin tab abre la última que se usó."""
    url = reverse('admin_inventario')
    return redirect(f'{url}?tab={tab}' if tab else url)


def _leer_material(request, exigir_stock_valido):
    """
    Lee y valida el formulario de material (crear / editar).
    Devuelve (datos, error). Si hay error, datos es None.
    """
    nombre = (request.POST.get('nombreMaterial') or '').strip()
    if not nombre:
        return None, "Debes ingresar el nombre del material."

    unidad = (request.POST.get('unidadBase') or '').strip()
    if not unidad:
        return None, "Debes seleccionar la unidad base."

    stock_actual = _parse_decimal_es(request.POST.get('stockActual') or 0)
    stock_minimo = _parse_decimal_es(request.POST.get('stockMinimo') or 0)
    if stock_actual is None or stock_minimo is None:
        return None, "El stock actual y el mínimo deben ser números válidos."
    if stock_actual < 0 or stock_minimo < 0:
        return None, "Los valores de stock no pueden ser negativos."
    if exigir_stock_valido and stock_actual < stock_minimo:
        return None, "El stock actual no puede ser menor al mínimo definido."

    costo = _parse_decimal_es(request.POST.get('costoUnitario'))
    if costo is None:
        return None, "El costo unitario no es un número válido."
    if costo < 0:
        return None, "El costo unitario no puede ser negativo."

    return {
        'nombreMaterial': nombre,
        'descripcion': (request.POST.get('descripcion') or '').strip() or None,
        'stockActual': stock_actual,
        'stockMinimo': stock_minimo,
        'unidadBase': unidad,
        'costoUnitario': costo,
    }, None


@admin_required
def crear_material(request):
    if request.method != 'POST':
        return _volver_a_inventario('materiales')

    datos, error = _leer_material(request, exigir_stock_valido=True)
    if error:
        messages.error(request, error)
        return _volver_a_inventario('materiales')

    proveedor_id = request.POST.get('proveedor')
    if not proveedor_id:
        messages.error(request, "Debes seleccionar el proveedor del material.")
        return _volver_a_inventario('materiales')
    proveedor_obj = get_object_or_404(Proveedor, pk=proveedor_id)

    Material.objects.create(proveedor=proveedor_obj, **datos)
    messages.success(
        request,
        f"Material '{datos['nombreMaterial']}' registrado (proveedor: {proveedor_obj.nombreEmpresa})."
    )
    return _volver_a_inventario('materiales')


@admin_required
def editar_material(request, pk):
    material = get_object_or_404(Material, pk=pk)
    if request.method != 'POST':
        return _volver_a_inventario('materiales')

    # Al editar no se exige stock >= mínimo: un material puede estar bajo mínimo
    datos, error = _leer_material(request, exigir_stock_valido=False)
    if error:
        messages.error(request, error)
        return _volver_a_inventario('materiales')

    proveedor_id = request.POST.get('proveedor')
    material.proveedor = get_object_or_404(Proveedor, pk=proveedor_id) if proveedor_id else None
    for campo, valor in datos.items():
        setattr(material, campo, valor)
    material.save()

    messages.success(request, f"Material '{material.nombreMaterial}' actualizado correctamente.")
    return _volver_a_inventario('materiales')


@admin_required
def eliminar_material(request, pk):
    material = get_object_or_404(Material, pk=pk)
    if request.method == 'POST':
        nombre = material.nombreMaterial
        try:
            # DELETE directo: la BD protege los materiales con entradas o usados
            # en tareas (FK), y evitamos que el ORM borre en cascada otras tablas.
            with transaction.atomic(), connection.cursor() as cursor:
                cursor.execute("DELETE FROM materiales WHERE idMaterial = %s", [material.pk])
            messages.success(request, f"Material '{nombre}' eliminado correctamente.")
        except IntegrityError:
            messages.error(
                request,
                f"No se puede eliminar '{nombre}': tiene entradas de proveedor o está usado en tareas de producción."
            )
    return _volver_a_inventario('materiales')


# ── Helper: resolver ubicación (predefinida u "Otro") ────────
def _resolver_ubicacion(request):
    ubicacion = request.POST.get('ubicacion')
    if ubicacion == 'otro':
        ubicacion = (request.POST.get('ubicacion_personalizada') or '').strip() or None
    return ubicacion or None


from decimal import Decimal, InvalidOperation

def _parse_decimal_es(valor):
    if valor is None:
        return None
    valor = str(valor).strip()
    if not valor:
        return None
    if ',' in valor and '.' in valor:
        valor = valor.replace('.', '').replace(',', '.')
    elif ',' in valor:
        valor = valor.replace(',', '.')
    elif valor.count('.') > 1:
        valor = valor.replace('.', '')
    try:
        return Decimal(valor)
    except InvalidOperation:
        return None


# ══════════════════════════════════════════════════════════════
#  PRODUCTOS (pestaña "Productos" del Inventario)
#  Aquí se registran los productos (nombre, categoría, precio...).
#  La pestaña "Productos Terminados" se alimenta de este catálogo.
# ══════════════════════════════════════════════════════════════

def _leer_producto(request, excluir_pk=None):
    """
    Lee y valida el formulario de producto (crear / editar).
    Devuelve (datos, error). Si hay error, datos es None.
    """
    nombre = (request.POST.get('nombre') or '').strip()
    if not nombre:
        return None, "Debes ingresar el nombre del producto."

    duplicados = Producto.objects.filter(nombre__iexact=nombre)
    if excluir_pk:
        duplicados = duplicados.exclude(pk=excluir_pk)
    if duplicados.exists():
        return None, f"Ya existe un producto llamado '{nombre}' en el catálogo."

    precio = _parse_decimal_es(request.POST.get('precio'))
    if precio is None or precio <= 0:
        return None, "Ingresa un precio mayor a 0."

    estado = request.POST.get('estado') or 'activo'
    if estado not in ('activo', 'inactivo'):
        estado = 'activo'

    return {
        'nombre': nombre,
        'categoria': (request.POST.get('categoria') or '').strip() or 'Sin categoría',
        'descripcion': (request.POST.get('descripcion') or '').strip(),
        'precio': precio,
        'estado': estado,
    }, None


@admin_required
@require_POST
def producto_crear(request):
    datos, error = _leer_producto(request)
    if error:
        messages.error(request, error)
        return _volver_a_inventario('catalogo')

    producto = Producto.objects.create(**datos)
    messages.success(
        request,
        f"Producto '{producto.nombre}' registrado en el catálogo. Ya puedes agregarlo al inventario."
    )
    return _volver_a_inventario('catalogo')


@admin_required
@require_POST
def producto_editar(request, pk):
    producto = get_object_or_404(Producto, pk=pk)

    datos, error = _leer_producto(request, excluir_pk=producto.pk)
    if error:
        messages.error(request, error)
        return _volver_a_inventario('catalogo')

    for campo, valor in datos.items():
        setattr(producto, campo, valor)
    producto.save()

    messages.success(request, f"Producto '{producto.nombre}' actualizado correctamente.")
    return _volver_a_inventario('catalogo')


@admin_required
@require_POST
def producto_eliminar(request, pk):
    producto = get_object_or_404(Producto, pk=pk)
    nombre = producto.nombre

    if Inventario.objects.filter(producto=producto).exists():
        messages.error(
            request,
            f"'{nombre}' tiene un registro de inventario. Elimínalo primero en Inventario, o desactiva el producto."
        )
        return _volver_a_inventario('catalogo')

    if Orden.objects.filter(idProducto=producto).exists():
        messages.error(
            request,
            f"'{nombre}' tiene órdenes asociadas y no se puede eliminar. Puedes desactivarlo."
        )
        return _volver_a_inventario('catalogo')

    try:
        # DELETE directo: el ORM borraría en cascada tablas relacionadas
        # (p. ej. inventario); aquí lo protegen las FK de la base de datos.
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("DELETE FROM productos WHERE idProducto = %s", [producto.pk])
        messages.success(request, f"Producto '{nombre}' eliminado del catálogo.")
    except IntegrityError:
        messages.error(
            request,
            f"'{nombre}' está en uso (producción u otros registros) y no se puede eliminar. Puedes desactivarlo."
        )
    return _volver_a_inventario('catalogo')


# ── CRUD: INVENTARIO (PRODUCTOS) ─────────────────────────────

@admin_required
def crear_inventario(request):
    """
    Agrega un producto del catálogo (módulo Productos) al inventario, con su
    cliente, stock inicial y ubicación. NO crea productos: eso se hace en
    Productos. Deja el stock inicial como primer movimiento (ENTRADA).
    """
    if request.method != 'POST':
        return redirect('admin_inventario')

    # ── Producto del catálogo ────────────────────────────────
    producto_id = request.POST.get('producto')
    if not producto_id:
        messages.error(request, "Selecciona un producto del catálogo.")
        return redirect('admin_inventario')

    producto = Producto.objects.filter(pk=producto_id).first() if str(producto_id).isdigit() else None
    if producto is None:
        messages.error(request, "El producto seleccionado no existe en el catálogo.")
        return redirect('admin_inventario')

    if Inventario.objects.filter(producto=producto).exists():
        messages.error(
            request,
            f"El producto '{producto.nombre}' ya tiene un registro de inventario. Edítalo en lugar de crear uno nuevo."
        )
        return redirect('admin_inventario')

    # ── Cliente (obligatorio) ────────────────────────────────
    cliente_id = request.POST.get('cliente')
    if not cliente_id:
        messages.error(request, "Debes seleccionar un cliente o empresa de manera obligatoria.")
        return redirect('admin_inventario')
    cliente_obj = get_object_or_404(Cliente, pk=cliente_id)

    # ── Stock inicial ────────────────────────────────────────
    try:
        cant_disponible = int(request.POST.get('cantidadDisponible') or 0)
        min_definido = int(request.POST.get('minimoDefinido') or 0)
    except ValueError:
        messages.error(request, "La cantidad disponible y el mínimo definido deben ser números enteros.")
        return redirect('admin_inventario')

    if cant_disponible < 0 or min_definido < 0:
        messages.error(request, "Los valores de stock no pueden ser negativos.")
        return redirect('admin_inventario')

    if cant_disponible < min_definido:
        messages.error(request, "El stock actual no puede ser menor al mínimo definido.")
        return redirect('admin_inventario')

    unidades = request.POST.get('unidades') or 'Unidades'
    ubicacion = _resolver_ubicacion(request)
    fecha_ingreso = request.POST.get('fechaIngreso') or timezone.now().date()

    # ── Guardado atómico ─────────────────────────────────────
    try:
        with transaction.atomic():
            nuevo_item = Inventario.objects.create(
                producto=producto,
                cliente=cliente_obj,
                cantidadDisponible=cant_disponible,
                minimoDefinido=min_definido,
                nivelStock=_calcular_nivel_stock(cant_disponible, min_definido),
                unidades=unidades,
                ubicacion=ubicacion,
                # Registro nuevo: todo lo disponible es lo que ingresó,
                # así ingresado − egresado siempre cuadra con el disponible.
                cantidadIngresada=cant_disponible,
                cantidadEgresada=0,
                fechaIngreso=fecha_ingreso,
                fechaSalida=None,
            )

            if cant_disponible > 0:
                MovimientoStock.objects.create(
                    idInventario=nuevo_item,
                    tipoMovimiento='ENTRADA',
                    cantidad=cant_disponible,
                    motivo='Stock inicial al agregar el producto al inventario',
                    usuarioId_id=request.session.get('usuario_id'),
                )
    except IntegrityError:
        messages.error(
            request,
            f"No se pudo agregar: el producto '{producto.nombre}' ya tiene un registro de inventario."
        )
        return redirect('admin_inventario')

    messages.success(
        request,
        f"Producto '{producto.nombre}' agregado al inventario para '{cliente_obj}'."
    )
    return redirect('admin_inventario')


@admin_required
def editar_inventario(request, pk):
    item = get_object_or_404(Inventario, pk=pk)
    if request.method == 'POST':
        producto_id = request.POST.get('producto')
        nuevo_producto = get_object_or_404(Producto, pk=producto_id)

        if nuevo_producto.pk != item.producto.pk and \
                Inventario.objects.filter(producto=nuevo_producto).exclude(pk=item.pk).exists():
            messages.error(
                request,
                f"El producto '{nuevo_producto.nombre}' ya tiene un registro de inventario."
            )
            return redirect('admin_inventario')

        # Procesar actualización de cliente / empresa
        cliente_id = request.POST.get('cliente')
        if cliente_id:
            item.cliente = get_object_or_404(Cliente, pk=cliente_id)
        else:
            item.cliente = None  # Permite desasociar cliente dejando el valor nulo

        try:
            cant_disponible = int(request.POST.get('cantidadDisponible') or 0)
            min_definido = int(request.POST.get('minimoDefinido') or 0)
        except ValueError:
            messages.error(request, "La cantidad disponible y el mínimo definido deben ser números enteros.")
            return redirect('admin_inventario')

        if cant_disponible < 0 or min_definido < 0:
            messages.error(request, "Los valores de stock no pueden ser negativos.")
            return redirect('admin_inventario')

        if cant_disponible < min_definido:
            messages.error(request, "El stock actual no puede ser menor al mínimo definido.")
            return redirect('admin_inventario')

        try:
            cant_ingresada = int(request.POST.get('cantidadIngresada') or 0)
            cant_egresada = int(request.POST.get('cantidadEgresada') or 0)
        except ValueError:
            messages.error(request, "Las cantidades ingresada/egresada deben ser números enteros.")
            return redirect('admin_inventario')

        if cant_ingresada < 0 or cant_egresada < 0:
            messages.error(request, "Las cantidades ingresada/egresada no pueden ser negativas.")
            return redirect('admin_inventario')

        disponible_anterior = item.cantidadDisponible

        item.producto = nuevo_producto
        item.cantidadDisponible = cant_disponible
        item.minimoDefinido = min_definido

        # PATCH: nivelStock se calcula automáticamente
        item.nivelStock = _calcular_nivel_stock(cant_disponible, min_definido)

        item.unidades = request.POST.get('unidades')
        item.ubicacion = _resolver_ubicacion(request)
        item.cantidadIngresada = cant_ingresada
        item.cantidadEgresada = cant_egresada

        fecha_salida = request.POST.get('fechaSalida')
        item.fechaSalida = fecha_salida if fecha_salida else None

        try:
            with transaction.atomic():
                item.save()

                # Trazabilidad: si el disponible cambió, queda como AJUSTE
                delta = cant_disponible - disponible_anterior
                if delta != 0:
                    MovimientoStock.objects.create(
                        idInventario=item,
                        tipoMovimiento='AJUSTE',
                        cantidad=delta,
                        motivo='Edición manual del registro de inventario',
                        usuarioId_id=request.session.get('usuario_id'),
                    )
            messages.success(request, f"Registro de inventario #{item.idInventario} actualizado.")
        except IntegrityError:
            messages.error(
                request,
                f"El producto '{nuevo_producto.nombre}' ya tiene un registro de inventario."
            )

    return redirect('admin_inventario')


@admin_required
def eliminar_inventario(request, pk):
    item = get_object_or_404(Inventario, pk=pk)
    if request.method == 'POST':
        id_inv = item.idInventario
        item.delete()
        messages.success(request, f"Registro de inventario #{id_inv} eliminado.")
    return redirect('admin_inventario')


@admin_required
def registrar_egreso(request, pk):
    item = get_object_or_404(Inventario, pk=pk)
    if request.method == 'POST':
        try:
            cantidad = int(request.POST.get('cantidadEgreso') or 0)
        except ValueError:
            messages.error(request, "La cantidad a egresar debe ser un número entero.")
            return redirect('admin_inventario')

        if cantidad <= 0:
            messages.error(request, "La cantidad a egresar debe ser mayor a 0.")
            return redirect('admin_inventario')

        if cantidad > item.cantidadDisponible:
            messages.error(
                request,
                f"No puedes egresar {cantidad} unidades de '{item.producto.nombre}': "
                f"solo hay {item.cantidadDisponible} disponibles."
            )
            return redirect('admin_inventario')

        item.cantidadDisponible -= cantidad
        item.cantidadEgresada += cantidad
        item.fechaSalida = timezone.now().date()
        item.save()

        # PATCH: registrar movimiento de salida
        MovimientoStock.objects.create(
            idInventario=item,
            tipoMovimiento='SALIDA',
            cantidad=-cantidad,
            motivo=request.POST.get('motivo', 'Egreso registrado desde panel'),
            usuarioId_id=request.session.get('usuario_id'),
        )

        # PATCH: recalcular nivelStock tras el egreso
        item.nivelStock = _calcular_nivel_stock(item.cantidadDisponible, item.minimoDefinido)
        item.save()

        messages.success(
            request,
            f"Se registraron {cantidad} unidades egresadas de '{item.producto.nombre}'. "
            f"Disponible actual: {item.cantidadDisponible}."
        )

    return redirect('admin_inventario')


@admin_required
def registrar_egresos_masivo(request):
    if request.method == 'POST':
        egresos_realizados = 0

        with transaction.atomic():
            for key, value in request.POST.items():
                if key.startswith('egreso_'):
                    try:
                        inventario_id = int(key.split('_')[1])
                        cantidad_egreso = int(value) if value else 0

                        if cantidad_egreso > 0:
                            item = Inventario.objects.get(pk=inventario_id)

                            if cantidad_egreso <= item.cantidadDisponible:
                                item.cantidadDisponible -= cantidad_egreso
                                item.cantidadEgresada = (item.cantidadEgresada or 0) + cantidad_egreso
                                item.fechaSalida = timezone.now().date()
                                item.nivelStock = _calcular_nivel_stock(
                                    item.cantidadDisponible, item.minimoDefinido
                                )
                                item.save()

                                MovimientoStock.objects.create(
                                    idInventario=item,
                                    tipoMovimiento='SALIDA',
                                    cantidad=-cantidad_egreso,
                                    motivo='Egreso masivo desde panel admin',
                                    usuarioId_id=request.session.get('usuario_id'),
                                )
                                egresos_realizados += 1
                            else:
                                messages.error(
                                    request,
                                    f"No hay suficiente stock disponible para {item.producto.nombre}. Disponible: {item.cantidadDisponible}."
                                )
                                return redirect('admin_inventario')

                    except (ValueError, Inventario.DoesNotExist):
                        continue

        if egresos_realizados > 0:
            messages.success(request, f"Se registraron exitosamente {egresos_realizados} egresos de inventario.")
        else:
            messages.warning(request, "No se ingresó ninguna cantidad a egresar mayor a 0.")

    return redirect('admin_inventario')


# ── EXPORTACIÓN DE INVENTARIO ────────────────────────────────
@admin_required
def exportar_inventario_pdf(request):
    response = HttpResponse(content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="inventario_hebratech.pdf"'

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    elements = []

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'TitleStyle',
        parent=styles['Heading1'],
        fontSize=18,
        textColor=colors.HexColor("#1A252C"),
        alignment=1,
        spaceAfter=15
    )

    elements.append(Paragraph("<b>Reporte General de Inventario - HebraTech</b>", title_style))
    elements.append(Spacer(1, 10))

    data = [["ID", "Producto", "Disponible", "Mínimo", "Ubicación"]]
    items = Inventario.objects.all().select_related('producto')

    for item in items:
        data.append([
            str(item.idInventario),
            item.producto.nombre if item.producto else 'N/A',
            str(item.cantidadDisponible),
            str(item.minimoDefinido),
            item.ubicacion or 'N/A'
        ])

    t = Table(data, colWidths=[40, 180, 80, 80, 110])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#2C3E50")),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('GRID', (0,0), (-1,-1), 0.5, colors.grey),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor("#F8F9FA")])
    ]))

    elements.append(t)
    doc.build(elements)

    pdf = buffer.getvalue()
    buffer.close()
    response.write(pdf)
    return response


@admin_required
def exportar_inventario_excel(request):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Inventario"

    headers = ["ID Inventario", "Producto", "Cantidad Disponible", "Mínimo Definido", "Unidades", "Ubicación"]
    ws.append(headers)

    header_font = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
    header_fill = PatternFill(start_color='2C3E50', end_color='2C3E50', fill_type='solid')

    for col_num in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_num)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center', vertical='center')

    for item in Inventario.objects.all().select_related('producto'):
        ws.append([
            item.idInventario,
            item.producto.nombre if item.producto else 'N/A',
            item.cantidadDisponible,
            item.minimoDefinido,
            item.unidades,
            item.ubicacion or 'N/A'
        ])

    response = HttpResponse(content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response['Content-Disposition'] = 'attachment; filename="inventario_hebratech.xlsx"'
    wb.save(response)
    return response


# ═══════════════════════════════════════════════════════════════════════
# NUEVA VISTA: ajustar_stock  (botones +/- de la tabla Productos)
# ═══════════════════════════════════════════════════════════════════════

@admin_required
@require_POST
def ajustar_stock(request, pk):
    """
    Endpoint AJAX para los botones rápidos +/- de stock de productos.
    POST params:
        accion  : 'sumar' | 'restar'
        cantidad: int (default 1)
        motivo  : str  (default vacío → texto automático)

    Devuelve JSON con el nuevo estado del item.
    """
    item = get_object_or_404(Inventario, pk=pk)

    try:
        cantidad = abs(int(request.POST.get('cantidad', 1)))
    except ValueError:
        return JsonResponse({'ok': False, 'error': 'Cantidad inválida.'}, status=400)

    if cantidad == 0:
        return JsonResponse({'ok': False, 'error': 'La cantidad debe ser mayor a 0.'}, status=400)

    accion = request.POST.get('accion', '').strip()
    motivo = request.POST.get('motivo', '').strip()

    if accion == 'sumar':
        item.cantidadDisponible += cantidad
        item.cantidadIngresada  += cantidad
        item.fechaIngreso        = timezone.now().date()
        tipo_mov                 = 'ENTRADA'
        cantidad_mov             = cantidad
        motivo                   = motivo or f'Entrada rápida (+{cantidad})'

    elif accion == 'restar':
        if cantidad > item.cantidadDisponible:
            return JsonResponse({
                'ok': False,
                'error': (
                    f"Solo hay {item.cantidadDisponible} unidades disponibles "
                    f"de '{item.producto.nombre}'."
                )
            }, status=400)
        item.cantidadDisponible -= cantidad
        item.cantidadEgresada   += cantidad
        item.fechaSalida         = timezone.now().date()
        tipo_mov                 = 'SALIDA'
        cantidad_mov             = -cantidad
        motivo                   = motivo or f'Salida rápida (−{cantidad})'

    else:
        return JsonResponse({'ok': False, 'error': 'Acción no reconocida.'}, status=400)

    item.nivelStock = _calcular_nivel_stock(item.cantidadDisponible, item.minimoDefinido)
    item.save()

    MovimientoStock.objects.create(
        idInventario=item,
        tipoMovimiento=tipo_mov,
        cantidad=cantidad_mov,
        motivo=motivo,
        usuarioId_id=request.session.get('usuario_id'),
    )

    return JsonResponse({
        'ok': True,
        'disponible':  item.cantidadDisponible,
        'nivelStock':  item.nivelStock,
        'ingresado':   item.cantidadIngresada,
        'egresado':    item.cantidadEgresada,
        'bajo_minimo': item.cantidadDisponible <= item.minimoDefinido,
    })


# ═══════════════════════════════════════════════════════════════════════
# NUEVA VISTA: ajustar_stock_material  (botones +/- pestaña Materiales)
# ═══════════════════════════════════════════════════════════════════════

@admin_required
@require_POST
def ajustar_stock_material(request, pk):
    """
    Endpoint AJAX para los botones +/- de stock de materiales.
    Registra la entrada en `entrada_materiales` (sumar) o resta
    directamente stockActual (restar — consumo puntual sin tarea).

    POST params:
        accion  : 'sumar' | 'restar'
        cantidad: Decimal  (default 1)
        motivo  : str
    """
    from decimal import Decimal, InvalidOperation

    material = get_object_or_404(Material, pk=pk)

    raw = request.POST.get('cantidad', '1').replace(',', '.')
    try:
        cantidad = abs(Decimal(raw))
    except InvalidOperation:
        return JsonResponse({'ok': False, 'error': 'Cantidad inválida.'}, status=400)

    if cantidad == 0:
        return JsonResponse({'ok': False, 'error': 'La cantidad debe ser mayor a 0.'}, status=400)

    accion = request.POST.get('accion', '').strip()
    motivo = request.POST.get('motivo', '').strip()

    if accion == 'sumar':
        # Todo o nada: si falla el registro en entrada_materiales, el stock no cambia.
        with transaction.atomic():
            material.stockActual += cantidad
            material.save()

            # entrada_materiales exige proveedor (FK NOT NULL): solo se registra
            # la entrada si el material tiene proveedor asignado.
            if material.proveedor_id:
                with connection.cursor() as cursor:
                    cursor.execute("""
                        INSERT INTO entrada_materiales
                            (idProveedor, idMaterial, fechaEntrada,
                             cantidad, precioUnitario, unidad, observaciones, estado)
                        VALUES (%s, %s, CURDATE(), %s, %s, %s, %s, 'Recibida')
                    """, [
                        material.proveedor_id,
                        material.idMaterial,
                        float(cantidad),
                        float(material.costoUnitario),
                        material.unidadBase,
                        motivo or f'Entrada rápida desde panel admin (+{cantidad})',
                    ])

    elif accion == 'restar':
        if cantidad > material.stockActual:
            return JsonResponse({
                'ok': False,
                'error': (
                    f"Solo hay {material.stockActual} {material.unidadBase} disponibles "
                    f"de '{material.nombreMaterial}'."
                )
            }, status=400)
        material.stockActual -= cantidad
        material.save()
        # Nota: consumos por tarea se registran en tarea_materiales desde
        # el módulo de producción. Este egreso rápido es solo ajuste manual.

    else:
        return JsonResponse({'ok': False, 'error': 'Acción no reconocida.'}, status=400)

    return JsonResponse({
        'ok': True,
        'stockActual': float(material.stockActual),
        'bajo_minimo': material.stockActual <= material.stockMinimo,
    })


# ═══════════════════════════════════════════════════════════════════════
# NUEVA VISTA: historial_movimientos  (pestaña lateral en modal futuro)
# ═══════════════════════════════════════════════════════════════════════

@admin_required
def historial_movimientos(request, pk):
    """
    Devuelve los últimos N movimientos de un ítem de inventario (JSON).
    Usado por el botón "Ver historial" de cada fila.
    """
    item = get_object_or_404(Inventario, pk=pk)
    movs = (
        MovimientoStock.objects
        .filter(idInventario=item)
        .select_related('usuarioId')
        .order_by('-fecha')[:20]
    )

    data = [
        {
            'tipo':     m.tipoMovimiento,
            'cantidad': m.cantidad,
            'motivo':   m.motivo,
            'fecha':    m.fecha.strftime('%d/%m/%Y %H:%M'),
            'usuario':  (
                f'{m.usuarioId.nombre} {m.usuarioId.apellido}'
                if m.usuarioId else 'Sistema'
            ),
        }
        for m in movs
    ]

    return JsonResponse({'ok': True, 'movimientos': data})


# ── Perfil de Usuario ────────────────────────────────────────
@admin_required
@require_POST
def editar_perfil(request):
    if request.method == 'POST':
        try:
            usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])

            nombre = request.POST.get('nombre', '').strip()
            apellido = request.POST.get('apellido', '').strip()
            correo = request.POST.get('email', '').strip()
            telefono = request.POST.get('telefono', '').strip()
            pass1 = request.POST.get('password1', '').strip()
            foto = request.FILES.get('foto')

            if not correo or not nombre:
                return JsonResponse({'success': False, 'message': 'Nombre y Correo electrónico son obligatorios.'}, status=400)

            usuario.nombre = nombre
            usuario.apellido = apellido
            usuario.correoElectronico = correo
            usuario.telefono = telefono or None

            if foto:
                usuario.fotoPerfil = foto

            if pass1:
                usuario.contrasena = make_password(pass1)

            usuario.save()

            request.session['usuario_nombre'] = usuario.nombre

            return JsonResponse({'success': True, 'message': 'Perfil actualizado correctamente.'})

        except Exception as e:
            return JsonResponse({'success': False, 'message': f"Error al actualizar: {str(e)}"}, status=500)

    return JsonResponse({'success': False, 'message': 'Método no permitido.'}, status=405)