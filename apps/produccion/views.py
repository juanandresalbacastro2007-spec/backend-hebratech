from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.shortcuts import render
from django.utils import timezone
import json
import logging
from datetime import timedelta, date as date_type

from .models import Producto, OrdenProduccion, Prenda
from apps.administrador.models import AsignacionTarea
from apps.core.decorators import login_required_rol, login_required_api
from apps.administrador.models import Usuario, Orden
from apps.operarios.models import Operario
from apps.clientes.models import Cliente

logger = logging.getLogger(__name__)

admin_required = login_required_rol(rol_esperado='administrador', session_key='usuario_id')
admin_required_api = login_required_api(rol_esperado='administrador', session_key='usuario_id')


# ── AUTOMATIZACIÓN: estado de producción → estado de la orden de cliente ──
MAPA_ESTADO_PRODUCCION_A_CLIENTE = {
    'En Progreso': 'marcar_en_produccion',   # Pendiente -> Procesando
    'Completado':  'marcar_enviado',         # Procesando -> Enviado
    'Cancelada':   'cancelar',               # Pendiente/Procesando -> Cancelado
}


def sincronizar_estado_cliente(orden_produccion):
    """Aplica al Orden de cliente vinculado la transición FSM que
    corresponde al nuevo estado de la OrdenProduccion, si existe una."""
    if not orden_produccion.idOrden_id:
        return
    metodo = MAPA_ESTADO_PRODUCCION_A_CLIENTE.get(orden_produccion.estado)
    if not metodo:
        return
    try:
        orden = Orden.objects.get(pk=orden_produccion.idOrden_id)
        getattr(orden, metodo)()
        orden.save()
    except Orden.DoesNotExist:
        pass
    except Exception:
        pass


# ── UTILIDADES DE FECHAS ─────────────────────────────
CAMPOS_FECHA = {'fechaInicio', 'fechaEntrega', 'fechaFinReal'}


def _parse_fecha(valor):
    """Normaliza un valor JSON a datetime.date (o None)."""
    if valor in (None, '', 'null'):
        return None
    if isinstance(valor, date_type):
        return valor
    return date_type.fromisoformat(str(valor))


def _parse_body_json(request):
    """Parsea el body como JSON. Devuelve (data, error_response)."""
    try:
        return json.loads(request.body or '{}'), None
    except json.JSONDecodeError:
        return None, JsonResponse(
            {'error': 'Body inválido: se esperaba JSON.'}, status=400
        )


# ── PORTAL ───────────────────────────────────────────
@admin_required
def produccion_portal(request):
    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])
    return render(request, 'produccion/produccion_portal.html', {
        'usuario': usuario,
        'seccion_activa': 'produccion',
    })


# ── UTILIDADES ───────────────────────────────────────
def orden_produccion_to_dict(o):
    progreso = 0
    if o.estado == 'Completado':
        progreso = 100
    elif o.estado == 'En Progreso':
        progreso = 50
    elif o.estado == 'Fuera de Plazo':
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
    atrasadas = todas.filter(estado='Fuera de Plazo').count()
    programadas_hoy = todas.filter(fechaInicio=hoy).count()

    avances = []
    for o in todas:
        if o.estado == 'Completado':
            avances.append(100)
        elif o.estado == 'En Progreso':
            avances.append(50)
        elif o.estado == 'Fuera de Plazo':
            avances.append(30)
        else:
            avances.append(0)
    progreso_general = round(sum(avances) / len(avances)) if avances else 100

    alertas = []
    if atrasadas:
        alertas.append({'tipo': 'danger', 'icono': '🔴', 'texto': f'{atrasadas} orden(es) de producción fuera de plazo'})
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
def productos_lista(request):
    productos = Producto.objects.filter(estado='activo')
    data = [{'idProducto': p.idProducto, 'nombre': p.nombre} for p in productos]
    return JsonResponse(data, safe=False)


# ── CLIENTES ────────────────────────────────────────
@admin_required_api
def clientes_lista(request):
    clientes = Cliente.objects.select_related('idUsuario').all()
    data = []
    for c in clientes:
        nombre = c.empresa or c.nombre or f"Cliente {c.idCliente}"
        data.append({'idCliente': c.idCliente, 'nombre': nombre})
    return JsonResponse(data, safe=False)


# ── ÓRDENES DE CLIENTE ────────────────────────────────
@admin_required_api
def ordenes_cliente_lista(request):
    ya_usadas = OrdenProduccion.objects.exclude(idOrden__isnull=True).values_list('idOrden_id', flat=True)

    ordenes = (
        Orden.objects
        .select_related('idCliente', 'idProducto')
        .exclude(idOrden__in=ya_usadas)
        .exclude(estado__in=['Cancelado', 'Entregado'])
        .order_by('-fechaCreacion')
    )

    data = []
    for o in ordenes:
        cliente_nombre = o.idCliente.empresa or o.idCliente.nombre or f"Cliente {o.idCliente.idCliente}"
        data.append({
            'idOrden':              o.idOrden,
            'cliente':              cliente_nombre,
            'idProducto':           o.idProducto_id,
            'nombreProducto':       o.idProducto.nombre if o.idProducto else (o.nombreProducto or ''),
            'cantidad':             o.cantidad,
            'fechaCreacion':        str(o.fechaCreacion),
            'fechaEntregaEstimada': str(o.fechaEntregaEstimada) if o.fechaEntregaEstimada else None,
            'prioridad':            o.prioridad,
            'instrucciones':        o.instrucciones,
        })
    return JsonResponse(data, safe=False)


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
            lista = lista.filter(estado='Fuera de Plazo')

        data = [orden_produccion_to_dict(o) for o in lista]
        return JsonResponse(data, safe=False)

    # POST: Crear nueva orden
    data, error = _parse_body_json(request)
    if error:
        return error

    id_orden_cliente = data.get('idOrden') or None

    try:
        fecha_inicio = _parse_fecha(data.get('fechaInicio'))
        fecha_entrega = _parse_fecha(data.get('fechaEntrega'))
        fecha_fin_real = _parse_fecha(data.get('fechaFinReal'))
    except (ValueError, TypeError):
        return JsonResponse(
            {'error': 'Alguna fecha no tiene formato válido (usa YYYY-MM-DD).'},
            status=400,
        )

    if not id_orden_cliente:
        hoy = timezone.now().date()
        if fecha_inicio and fecha_inicio < hoy:
            return JsonResponse({'error': 'La fecha de inicio no puede ser anterior a hoy.'}, status=400)
        if fecha_entrega and fecha_entrega < hoy:
            return JsonResponse({'error': 'La fecha de entrega no puede ser anterior a hoy.'}, status=400)

    if id_orden_cliente:
        if OrdenProduccion.objects.filter(idOrden_id=id_orden_cliente).exists():
            return JsonResponse({'error': 'Esta orden de cliente ya tiene una orden de producción asociada.'}, status=400)

    ultimo = OrdenProduccion.objects.order_by('-idOrdenProduccion').first()
    if ultimo:
        num = int(ultimo.numero.split('-')[1]) + 1
    else:
        num = 1
    numero = f"ORD-{str(num).zfill(5)}"

    o = OrdenProduccion.objects.create(
        numero          = numero,
        idOrden_id      = id_orden_cliente,
        idProducto_id   = data.get('idProducto'),
        cliente         = data.get('cliente', ''),
        cantidad        = data.get('cantidad', 0),
        fechaInicio     = fecha_inicio,
        fechaEntrega    = fecha_entrega,
        fechaFinReal    = fecha_fin_real,
        prioridad       = data.get('prioridad', 'Normal'),
        estado          = data.get('estado', 'Pendiente'),
        observaciones   = data.get('observaciones', ''),
    )
    sincronizar_estado_cliente(o)
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
        data, error = _parse_body_json(request)
        if error:
            return error

        # Validación de fechas en pasado (solo órdenes manuales)
        if not o.idOrden_id:
            hoy = timezone.now().date()
            valores_actuales = {'fechaInicio': str(o.fechaInicio), 'fechaEntrega': str(o.fechaEntrega)}
            for campo_fecha in ('fechaInicio', 'fechaEntrega'):
                nuevo_valor = data.get(campo_fecha)
                if (
                    campo_fecha in data
                    and nuevo_valor
                    and str(nuevo_valor) != valores_actuales[campo_fecha]
                    and str(nuevo_valor) < str(hoy)
                ):
                    return JsonResponse(
                        {'error': f'La {"fecha de inicio" if campo_fecha == "fechaInicio" else "fecha de entrega"} no puede ser anterior a hoy.'},
                        status=400,
                    )

        # Guardamos los valores ANTERIORES para calcular deltas después
        fecha_inicio_anterior = o.fechaInicio
        fecha_entrega_anterior = o.fechaEntrega    # ← NUEVO
        estado_anterior = o.estado

        for campo in ['idProducto', 'cliente', 'cantidad', 'fechaInicio',
                      'fechaEntrega', 'fechaFinReal', 'prioridad', 'estado', 'observaciones']:
            if campo not in data:
                continue

            valor = data[campo]

            # Convertir strings ISO a datetime.date ANTES de asignar
            if campo in CAMPOS_FECHA:
                try:
                    valor = _parse_fecha(valor)
                except (ValueError, TypeError):
                    return JsonResponse(
                        {'error': f'{campo} no es una fecha válida (usa YYYY-MM-DD).'},
                        status=400,
                    )
                if valor is None and campo in ('fechaInicio', 'fechaEntrega'):
                    return JsonResponse(
                        {'error': f'{campo} no puede quedar vacío.'},
                        status=400,
                    )

            if campo == 'idProducto':
                o.idProducto_id = valor
            else:
                setattr(o, campo, valor)

        o.save()

        # ── 1. Cambió el estado → sincronizar cliente y propagar a tareas ──
        if 'estado' in data and o.estado != estado_anterior:
            sincronizar_estado_cliente(o)
            try:
                from .services import propagar_estado_a_tareas
                propagar_estado_a_tareas(o)
            except Exception:
                logger.exception('Error propagando estado a tareas de OP %s', o.pk)

        # ── 2. Cambió fechaInicio → correr TODAS las fechas de las tareas ──
        if 'fechaInicio' in data and o.fechaInicio and fecha_inicio_anterior:
            delta_dias = (o.fechaInicio - fecha_inicio_anterior).days
            if delta_dias:
                try:
                    from .services import desplazar_tareas_por_cambio_fecha
                    desplazar_tareas_por_cambio_fecha(o.idOrdenProduccion, delta_dias)
                except Exception as e:
                    logger.exception(
                        'Error desplazando tareas de OP %s: %s',
                        o.idOrdenProduccion, e,
                    )

        # ── 3. Cambió fechaEntrega → correr SOLO fechaLimite de tareas ──
        if 'fechaEntrega' in data and o.fechaEntrega and fecha_entrega_anterior:
            delta_dias = (o.fechaEntrega - fecha_entrega_anterior).days
            if delta_dias:
                try:
                    from .services import desplazar_fechaLimite_por_cambio_entrega
                    desplazar_fechaLimite_por_cambio_entrega(o.idOrdenProduccion, delta_dias)
                except Exception as e:
                    logger.exception(
                        'Error moviendo fechaLimite de tareas de OP %s: %s',
                        o.idOrdenProduccion, e,
                    )

        return JsonResponse(orden_produccion_to_dict(o))

    o.delete()
    return JsonResponse({'mensaje': 'Orden eliminada'})


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
        elif o.estado == 'Fuera de Plazo':
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
                    # ← CAMBIÓ: ahora lee del FK nuevo, con fallback al viejo
                    'idProduccion':      t.idOrdenProduccion_id or t.idTarea.idProduccion,
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