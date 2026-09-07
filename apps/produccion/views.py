from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.shortcuts import render
from django.utils import timezone
import json
import unicodedata
from datetime import timedelta

from .models import Producto, OrdenProduccion, Prenda
from apps.administrador.models import Orden, AsignacionTarea, Tarea
from apps.core.decorators import login_required_rol, login_required_api
from apps.administrador.models import Usuario
from apps.operarios.models import Operario
from apps.clientes.models import Cliente

admin_required = login_required_rol(rol_esperado='administrador', session_key='usuario_id')
admin_required_api = login_required_api(rol_esperado='administrador', session_key='usuario_id')


# ── PORTAL (Template HTML) ───────────────────────────
@admin_required
def produccion_portal(request):
    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])
    return render(request, 'produccion/produccion_portal.html', {
        'usuario': usuario,
        'seccion_activa': 'produccion',
    })


# ── UTILIDADES ───────────────────────────────────────
def producto_to_dict(p):
    return {
        'idProducto':  p.idProducto,
        'nombre':      p.nombre,
        'descripcion': p.descripcion,
        'precio':      float(p.precio),
        'categoria':   p.categoria,
    }


def orden_produccion_to_dict(o):
    # Calcular progreso basado en estado
    progreso = 0
    if o.estado == 'Completado':
        progreso = 100
    elif o.estado == 'En Progreso':
        progreso = 50
    elif o.estado == 'Atrasada':
        progreso = 30
    return {
        'idOrdenProduccion': o.idOrdenProduccion,
        'numero':            o.numero,
        'idOrden':           o.idOrden_id,
        'idProducto':        o.idProducto_id,
        'nombreProducto':    o.idProducto.nombre if o.idProducto else '',
        'cliente':           o.cliente,
        'cantidad':          o.cantidad,
        'fechaInicio':       str(o.fechaInicio),
        'fechaEntrega':      str(o.fechaEntrega),
        'fechaFinReal':      str(o.fechaFinReal) if o.fechaFinReal else None,
        'prioridad':         o.prioridad,
        'estado':            o.estado,
        'observaciones':     o.observaciones,
        'fechaCreacion':     str(o.fechaCreacion),
        'progreso':          progreso,
    }


# ── DASHBOARD ─────────────────────────────────────────
@admin_required_api
def dashboard(request):
    hoy = timezone.now().date()
    fin_semana = hoy + timedelta(days=(6 - hoy.weekday()))

    todas = OrdenProduccion.objects.all()
    total = todas.count()
    pendientes = todas.filter(estado='Pendiente').count()
    en_progreso = todas.filter(estado='En Progreso').count()
    completadas = todas.filter(estado='Completado').count()
    atrasadas = todas.filter(estado='Atrasada').count()
    programadas_hoy = todas.filter(fechaInicio=hoy).count()

    avances = []
    for o in todas:
        if o.estado == 'Completado':
            avances.append(100)
        elif o.estado == 'En Progreso':
            avances.append(50)
        elif o.estado == 'Atrasada':
            avances.append(30)
        else:
            avances.append(0)
    progreso_general = round(sum(avances) / len(avances)) if avances else 100

    alertas = []
    if atrasadas:
        alertas.append({'tipo': 'danger', 'icono': '🔴', 'texto': f'{atrasadas} orden(es) de producción atrasada(s)'})
    proximas_vencer = todas.filter(
        estado__in=['Pendiente', 'En Progreso'],
        fechaEntrega__gte=hoy,
        fechaEntrega__lte=hoy + timedelta(days=2),
    ).count()
    if proximas_vencer:
        alertas.append({'tipo': 'warning', 'icono': '🟡', 'texto': f'{proximas_vencer} orden(es) próxima(s) a vencer (48h)'})

    return JsonResponse({
        'totalOrdenes': total,
        'pendientes': pendientes,
        'enProgreso': en_progreso,
        'completadas': completadas,
        'atrasadas': atrasadas,
        'programadasHoy': programadas_hoy,
        'programadasSemana': todas.filter(fechaInicio__gte=hoy, fechaInicio__lte=fin_semana).count(),
        'progresoGeneral': progreso_general,
        'alertas': alertas,
    })


# ── PRODUCTOS ────────────────────────────────────────
@admin_required_api
@csrf_exempt
@require_http_methods(['GET', 'POST'])
def productos(request):
    if request.method == 'GET':
        lista = list(Producto.objects.all())
        return JsonResponse([producto_to_dict(p) for p in lista], safe=False)

    data = json.loads(request.body)
    nombre = (data.get('nombre') or '').strip()
    if not nombre:
        return JsonResponse({'error': 'El nombre del producto es obligatorio.'}, status=400)

    nombre_normalizado = unicodedata.normalize('NFKD', nombre).lower()
    duplicado = any(
        unicodedata.normalize('NFKD', p_nombre).lower() == nombre_normalizado
        for p_nombre in Producto.objects.values_list('nombre', flat=True)
    )
    if duplicado:
        return JsonResponse(
            {'error': f'Ya existe un producto llamado "{nombre}". Usa otro nombre.'},
            status=400
        )

    p = Producto.objects.create(
        nombre      = nombre,
        descripcion = data.get('descripcion', ''),
        precio      = data.get('precio', 0),
        categoria   = data['categoria'],
    )
    return JsonResponse(producto_to_dict(p), status=201)


@admin_required_api
@csrf_exempt
@require_http_methods(['GET', 'PUT', 'DELETE'])
def producto_detalle(request, id):
    try:
        p = Producto.objects.get(pk=id)
    except Producto.DoesNotExist:
        return JsonResponse({'error': 'Producto no encontrado'}, status=404)

    if request.method == 'GET':
        return JsonResponse(producto_to_dict(p))

    if request.method == 'PUT':
        data = json.loads(request.body)
        if 'nombre' in data:
            nuevo_nombre = (data['nombre'] or '').strip()
            if not nuevo_nombre:
                return JsonResponse({'error': 'El nombre del producto es obligatorio.'}, status=400)
            nombre_normalizado = unicodedata.normalize('NFKD', nuevo_nombre).lower()
            duplicado = any(
                unicodedata.normalize('NFKD', otro_nombre).lower() == nombre_normalizado
                for otro_nombre in Producto.objects.exclude(pk=p.pk).values_list('nombre', flat=True)
            )
            if duplicado:
                return JsonResponse(
                    {'error': f'Ya existe un producto llamado "{nuevo_nombre}". Usa otro nombre.'},
                    status=400
                )
            data['nombre'] = nuevo_nombre

        for campo in ['nombre', 'descripcion', 'precio', 'categoria']:
            if campo in data:
                setattr(p, campo, data[campo])
        p.save()
        return JsonResponse(producto_to_dict(p))

    p.delete()
    return JsonResponse({'mensaje': 'Producto eliminado'})


# ── PRODUCTOS (para el select en órdenes) ────────────
@admin_required_api
def productos_lista(request):
    productos = Producto.objects.filter(estado='activo')
    data = [{'idProducto': p.idProducto, 'nombre': p.nombre} for p in productos]
    return JsonResponse(data, safe=False)


# ── CLIENTES (para desplegable) ──────────────────────
@admin_required_api
def clientes_lista(request):
    clientes = Cliente.objects.select_related('idUsuario').all()
    data = []
    for c in clientes:
        nombre = c.empresa or c.nombre or f"Cliente {c.idCliente}"
        data.append({
            'idCliente': c.idCliente,
            'nombre': nombre,
        })
    return JsonResponse(data, safe=False)


# ── DATOS DE ORDEN DE CLIENTE (para autocompletar) ───
@admin_required_api
def orden_cliente_datos(request, id):
    try:
        orden = Orden.objects.select_related('idCliente').get(pk=id)
    except Orden.DoesNotExist:
        return JsonResponse({'error': 'Orden no encontrada'}, status=404)

    cliente_nombre = orden.idCliente.empresa or orden.idCliente.nombre or 'Sin cliente'

    data = {
        'idOrden': orden.idOrden,
        'cliente': cliente_nombre,
        'idProducto': orden.idProducto_id if orden.idProducto else None,
        'nombreProducto': orden.nombreProducto or '',
        'cantidad': orden.cantidad or 0,
        'fechaEntrega': str(orden.fechaEntregaEstimada) if orden.fechaEntregaEstimada else '',
        'fechaPedido': str(orden.fechaCreacion),
        'estado': orden.estado,
    }
    return JsonResponse(data)


# ── ÓRDENES DE PRODUCCIÓN ────────────────────────────
@admin_required_api
@csrf_exempt
@require_http_methods(['GET', 'POST'])
def ordenes_produccion(request):
    if request.method == 'GET':
        filtro = request.GET.get('filtro', '')
        lista = OrdenProduccion.objects.select_related('idProducto').all()

        hoy = timezone.now().date()
        if filtro == 'hoy':
            lista = lista.filter(fechaInicio=hoy)
        elif filtro == 'semana':
            fin_semana = hoy + timedelta(days=(6 - hoy.weekday()))
            lista = lista.filter(fechaInicio__gte=hoy, fechaInicio__lte=fin_semana)
        elif filtro == 'en_produccion':
            lista = lista.filter(estado='En Progreso')
        elif filtro == 'terminadas':
            lista = lista.filter(estado='Completado')
        elif filtro == 'atrasadas':
            lista = lista.filter(estado='Atrasada')

        data = [orden_produccion_to_dict(o) for o in lista]
        return JsonResponse(data, safe=False)

    # POST: Crear nueva orden
    data = json.loads(request.body)
    # Generar número automático
    ultimo = OrdenProduccion.objects.order_by('-idOrdenProduccion').first()
    if ultimo:
        num = int(ultimo.numero.split('-')[1]) + 1
    else:
        num = 1
    numero = f"ORD-{str(num).zfill(5)}"

    o = OrdenProduccion.objects.create(
        numero          = numero,
        idOrden_id      = data.get('idOrden') or None,
        idProducto_id   = data.get('idProducto'),
        cliente         = data.get('cliente', ''),
        cantidad        = data.get('cantidad', 0),
        fechaInicio     = data.get('fechaInicio'),
        fechaEntrega    = data.get('fechaEntrega'),
        fechaFinReal    = data.get('fechaFinReal') or None,
        prioridad       = data.get('prioridad', 'Normal'),
        estado          = data.get('estado', 'Pendiente'),
        observaciones   = data.get('observaciones', ''),
    )
    return JsonResponse(orden_produccion_to_dict(o), status=201)


@admin_required_api
@csrf_exempt
@require_http_methods(['GET', 'PUT', 'DELETE'])
def orden_produccion_detalle(request, id):
    try:
        o = OrdenProduccion.objects.select_related('idProducto').get(pk=id)
    except OrdenProduccion.DoesNotExist:
        return JsonResponse({'error': 'Orden de producción no encontrada'}, status=404)

    if request.method == 'GET':
        return JsonResponse(orden_produccion_to_dict(o))

    if request.method == 'PUT':
        data = json.loads(request.body)
        for campo in ['idOrden', 'idProducto', 'cliente', 'cantidad', 'fechaInicio',
                      'fechaEntrega', 'fechaFinReal', 'prioridad', 'estado', 'observaciones']:
            if campo in data:
                if campo == 'idOrden':
                    o.idOrden_id = data[campo] or None
                elif campo == 'idProducto':
                    o.idProducto_id = data[campo]
                else:
                    setattr(o, campo, data[campo])
        o.save()
        return JsonResponse(orden_produccion_to_dict(o))

    o.delete()
    return JsonResponse({'mensaje': 'Orden eliminada'})


# ── ÓRDENES DE CLIENTE (solo lectura + edición de estado) ──
@admin_required_api
def ordenes_cliente(request):
    if request.method == 'GET':
        ordenes = Orden.objects.select_related('idCliente').all().order_by('-fechaCreacion')
        data = []
        for o in ordenes:
            data.append({
                'idOrden': o.idOrden,
                'cliente': o.idCliente.empresa or o.idCliente.nombre or 'Sin cliente',
                'fechaPedido': str(o.fechaCreacion),
                'fechaEntrega': str(o.fechaEntregaEstimada) if o.fechaEntregaEstimada else None,
                'estado': o.estado,
                'producto': o.nombreProducto or '',
                'cantidad': o.cantidad or 0,
            })
        return JsonResponse(data, safe=False)
    return JsonResponse({'error': 'Método no permitido'}, status=405)


@admin_required_api
@csrf_exempt
@require_http_methods(['PUT'])
def orden_cliente_detalle(request, id):
    try:
        o = Orden.objects.get(pk=id)
    except Orden.DoesNotExist:
        return JsonResponse({'error': 'Orden de cliente no encontrada'}, status=404)

    data = json.loads(request.body)
    if 'estado' in data:
        o.estado = data['estado']
    if 'fechaEntrega' in data:
        o.fechaEntregaEstimada = data['fechaEntrega']
    o.save()
    return JsonResponse({
        'idOrden': o.idOrden,
        'estado': o.estado,
        'fechaEntrega': str(o.fechaEntregaEstimada) if o.fechaEntregaEstimada else None,
    })


# ── EVENTOS CALENDARIO ──────────────────────────────
@admin_required_api
def eventos_calendario(request):
    ordenes = OrdenProduccion.objects.select_related('idProducto').all()
    eventos = []
    for o in ordenes:
        color = '#395B64'
        if o.estado == 'En Progreso':
            color = '#3b82f6'
        elif o.estado == 'Pendiente':
            color = '#A5C9CA'
        elif o.estado == 'Completado':
            color = '#198754'
        elif o.estado == 'Atrasada':
            color = '#dc3545'

        eventos.append({
            'id': o.idOrdenProduccion,
            'title': f"{o.idProducto.nombre} ({o.numero})",
            'start': str(o.fechaInicio),
            'end': str(o.fechaEntrega) if o.fechaEntrega else None,
            'color': color,
            'estado': o.estado,
            'producto': o.idProducto.nombre,
            'cantidad': o.cantidad,
        })
    return JsonResponse(eventos, safe=False)


# ── AVANCE DE OPERARIOS ──────────────────────────────
@admin_required_api
def avance_operarios(request):
    operarios = (
        Operario.objects
        .select_related('idUsuario')
        .filter(estado='activo')
        .order_by('idUsuario__nombre', 'idUsuario__apellido')
    )

    asignaciones = (
        AsignacionTarea.objects
        .select_related('idTarea', 'idOperario')
        .order_by('fechaInicio')
    )

    tareas_por_operario = {}
    for a in asignaciones:
        tareas_por_operario.setdefault(a.idOperario_id, []).append(a)

    resultado = []
    for op in operarios:
        tareas = tareas_por_operario.get(op.idOperario, [])
        pendientes  = sum(1 for t in tareas if t.estado == 'Pendiente')
        en_progreso = sum(1 for t in tareas if t.estado == 'En Progreso')
        completadas = sum(1 for t in tareas if t.estado == 'Completada')
        canceladas  = sum(1 for t in tareas if t.estado == 'Cancelada')
        total_activas = len(tareas) - canceladas
        avance_pct = round((completadas / total_activas) * 100) if total_activas > 0 else 0

        resultado.append({
            'idOperario':   op.idOperario,
            'nombre':       f'{op.idUsuario.nombre} {op.idUsuario.apellido}'.strip(),
            'especialidad': op.especialidad,
            'estado':       op.estado,
            'contadores': {
                'pendiente':   pendientes,
                'enProgreso':  en_progreso,
                'completada':  completadas,
                'cancelada':   canceladas,
            },
            'avancePct': avance_pct,
            'tareas': [
                {
                    'idAsignacion':      t.idAsignacion,
                    'nombreTarea':       t.idTarea.nombreTarea,
                    'proceso':           t.idTarea.proceso,
                    'idProduccion':      t.idTarea.idProduccion,
                    'tipoPrenda':        t.tipoPrenda,
                    'cantidadPrendas':   t.cantidadPrendas,
                    'estado':            t.estado,
                    'prioridad':         t.prioridad,
                    'fechaInicio':       str(t.fechaInicio),
                    'fechaFinalizacion': str(t.fechaFinalizacion) if t.fechaFinalizacion else None,
                    'horasEstimadas':    float(t.horasEstimadas) if t.horasEstimadas is not None else None,
                    'horasReales':       float(t.horasReales) if t.horasReales is not None else None,
                }
                for t in sorted(tareas, key=lambda t: t.fechaInicio)
            ],
        })

    return JsonResponse({'operarios': resultado})


# ── KPIs (legacy) ────────────────────────────────────
@admin_required_api
def kpis(request):
    total_productos = Producto.objects.count()
    en_progreso     = OrdenProduccion.objects.filter(estado='En Progreso').count()
    pendientes      = OrdenProduccion.objects.filter(estado='Pendiente').count()
    completados     = OrdenProduccion.objects.filter(estado='Completado').count()
    return JsonResponse({
        'totalProductos':    total_productos,
        'ordenesEnProceso':  en_progreso,
        'ordenesPendientes': pendientes,
        'ordenesCompletadas': completados,
    })