from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.shortcuts import render
from django.utils import timezone
from django_fsm import can_proceed
import json
import unicodedata
from datetime import timedelta

from .models import Producto, Produccion
from .services import sincronizar_estado_cliente
from apps.administrador.models import Orden, AsignacionTarea, Tarea
from apps.core.decorators import login_required_rol, login_required_api
from apps.administrador.models import Usuario
from apps.operarios.models import Operario

admin_required = login_required_rol(rol_esperado='administrador', session_key='usuario_id')
admin_required_api = login_required_api(rol_esperado='administrador', session_key='usuario_id')

TRANSICIONES_PRODUCCION = {
    ('Pendiente', 'En Progreso'):   'iniciar',
    ('En Progreso', 'Completado'):  'completar',
    ('Pendiente', 'Detenido'):      'detener',
    ('En Progreso', 'Detenido'):    'detener',
    ('Detenido', 'En Progreso'):    'reanudar',
}

# Colores fijos por nombre de proceso/etapa. No hay tabla de configuración
# todavía — si aparece un proceso nuevo que no está acá, cae en 'gris'.
COLOR_ETAPA = {
    'Diseño':     '#8b5cf6',
    'Corte':      '#f97316',
    'Confección': '#3b82f6',
    'Estampado':  '#ec4899',
    'Calidad':    '#eab308',
    'Empaque':    '#22c55e',
    'Terminado':  '#14b8a6',
}
COLOR_ETAPA_DEFAULT = '#6b7280'


def _normalizar(texto):
    texto = (texto or '').strip().lower()
    texto = unicodedata.normalize('NFKD', texto)
    texto = ''.join(c for c in texto if not unicodedata.combining(c))
    return texto


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


def _etapas_de_produccion(id_produccion):
    """
    Agrupa las AsignacionTarea de esta Produccion por Tarea.proceso
    (= nuestra "etapa" real, ya que no existe tabla de etapas todavía).
    Devuelve la lista ordenada por la fecha de inicio más temprana de
    cada proceso, con su color, estado agregado y % de avance.
    """
    asignaciones = (
        AsignacionTarea.objects
        .select_related('idTarea', 'idOperario__idUsuario')
        .filter(idTarea__idProduccion=id_produccion)
        .exclude(estado='Cancelada')
        .order_by('fechaInicio')
    )

    grupos = {}
    orden_procesos = []
    for a in asignaciones:
        proceso = a.idTarea.proceso or 'Sin proceso'
        if proceso not in grupos:
            grupos[proceso] = []
            orden_procesos.append(proceso)
        grupos[proceso].append(a)

    etapas = []
    for proceso in orden_procesos:
        tareas_etapa = grupos[proceso]
        total = len(tareas_etapa)
        completadas = sum(1 for t in tareas_etapa if t.estado == 'Completada')
        en_progreso = sum(1 for t in tareas_etapa if t.estado == 'En Progreso')
        avance_pct = round((completadas / total) * 100) if total else 0

        if avance_pct == 100:
            estado_etapa = 'COMPLETADA'
        elif en_progreso > 0 or avance_pct > 0:
            estado_etapa = 'EN PROCESO'
        else:
            estado_etapa = 'NO INICIADA'

        # Atrasada: alguna tarea de la etapa venció su fechaLimite sin completarse
        hoy = timezone.now().date()
        if any(t.fechaLimite and t.fechaLimite < hoy and t.estado != 'Completada' for t in tareas_etapa):
            estado_etapa = 'ATRASADA'

        operarios_etapa = sorted(set(
            f'{t.idOperario.idUsuario.nombre} {t.idOperario.idUsuario.apellido}'
            for t in tareas_etapa
        ))

        fechas_inicio = [t.fechaInicio for t in tareas_etapa if t.fechaInicio]
        fechas_fin = [t.fechaFinalizacion for t in tareas_etapa if t.fechaFinalizacion]

        etapas.append({
            'nombre': proceso,
            'color': COLOR_ETAPA.get(proceso, COLOR_ETAPA_DEFAULT),
            'estado': estado_etapa,
            'avancePct': avance_pct,
            'totalTareas': total,
            'completadas': completadas,
            'operarios': operarios_etapa,
            'fechaInicio': str(min(fechas_inicio)) if fechas_inicio else None,
            'fechaFin': str(max(fechas_fin)) if fechas_fin else None,
        })

    return etapas


def _avance_pct_produccion(id_produccion):
    asignaciones = (
        AsignacionTarea.objects
        .filter(idTarea__idProduccion=id_produccion)
        .exclude(estado='Cancelada')
    )
    total = asignaciones.count()
    if total == 0:
        return 0
    completadas = asignaciones.filter(estado='Completada').count()
    return round((completadas / total) * 100)


def produccion_to_dict(o, con_etapas=False):
    cliente_nombre = None
    if o.idOrden:
        try:
            orden_comercial = Orden.objects.select_related('idCliente').get(pk=o.idOrden)
            cliente_nombre = orden_comercial.idCliente.empresa or orden_comercial.idCliente.nombre or None
        except Orden.DoesNotExist:
            cliente_nombre = None

    hoy = timezone.now().date()
    atrasada = (
        o.estado not in ('Completado', 'Detenido')
        and o.fechaEstimadaFin
        and o.fechaEstimadaFin < hoy
    )

    transiciones_disponibles = [
        destino for (origen, destino) in TRANSICIONES_PRODUCCION
        if origen == o.estado
    ]

    data = {
        'idProduccion':      o.idProduccion,
        'idOrden':           o.idOrden,
        'cliente':           cliente_nombre,
        'idProducto':        o.idProducto_id,
        'producto':          o.idProducto.nombre,
        'descripcion':       o.descripcion,
        'cantidadRequerida': o.cantidadRequerida,
        'fechaInicio':       str(o.fechaInicio),
        'fechaEstimadaFin':  str(o.fechaEstimadaFin),
        'fechaRealFin':      str(o.fechaRealFin) if o.fechaRealFin else None,
        'estado':            o.estado,
        'atrasada':          bool(atrasada),
        'avancePct':         _avance_pct_produccion(o.idProduccion),
        'transicionesDisponibles': transiciones_disponibles,
    }

    if con_etapas:
        data['etapas'] = _etapas_de_produccion(o.idProduccion)
        data['historial'] = [
            {
                'fecha': h.history_date.strftime('%d/%m %H:%M'),
                'estado': h.estado,
            }
            for h in o.history.order_by('history_date')
        ]

    return data


# ── DASHBOARD ─────────────────────────────────────────
@admin_required_api
def dashboard(request):
    """
    GET /produccion/dashboard/
    KPIs del centro de control: totales, hoy, esta semana, atrasadas.
    """
    hoy = timezone.now().date()
    fin_semana = hoy + timedelta(days=(6 - hoy.weekday()))

    todas = Produccion.objects.all()
    total = todas.count()
    pendientes = todas.filter(estado='Pendiente').count()
    en_progreso = todas.filter(estado='En Progreso').count()
    completadas = todas.filter(estado='Completado').count()

    atrasadas = sum(
        1 for p in todas.exclude(estado__in=['Completado', 'Detenido'])
        if p.fechaEstimadaFin and p.fechaEstimadaFin < hoy
    )
    programadas_hoy = todas.filter(fechaInicio=hoy).count()
    programadas_semana = todas.filter(fechaInicio__gte=hoy, fechaInicio__lte=fin_semana).count()

    avances = [_avance_pct_produccion(p.idProduccion) for p in todas.exclude(estado='Completado')]
    progreso_general = round(sum(avances) / len(avances)) if avances else 100

    alertas = []
    if atrasadas:
        alertas.append({'tipo': 'danger', 'icono': '🔴', 'texto': f'{atrasadas} orden(es) de producción atrasada(s)'})
    proximas_vencer = todas.filter(
        estado__in=['Pendiente', 'En Progreso'],
        fechaEstimadaFin__gte=hoy,
        fechaEstimadaFin__lte=hoy + timedelta(days=2),
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
        'programadasSemana': programadas_semana,
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

    nombre_normalizado = _normalizar(nombre)
    duplicado = any(
        _normalizar(p_nombre) == nombre_normalizado
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
            nuevo_normalizado = _normalizar(nuevo_nombre)
            duplicado = any(
                _normalizar(otro_nombre) == nuevo_normalizado
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


# ── ÓRDENES DE PRODUCCIÓN ────────────────────────────────────────
@admin_required_api
@csrf_exempt
@require_http_methods(['GET', 'POST'])
def ordenes(request):
    if request.method == 'GET':
        filtro = request.GET.get('filtro', '')
        lista = Produccion.objects.select_related('idProducto').all()

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
            lista = [
                p for p in lista.exclude(estado__in=['Completado', 'Detenido'])
                if p.fechaEstimadaFin and p.fechaEstimadaFin < hoy
            ]

        data = [produccion_to_dict(o) for o in lista]
        return JsonResponse(data, safe=False)

    data = json.loads(request.body)
    o = Produccion.objects.create(
        idOrden           = data.get('idOrden'),
        idProducto_id     = data.get('idProducto'),
        descripcion       = data.get('descripcion', ''),
        cantidadRequerida = data.get('cantidadRequerida', 0),
        fechaInicio       = data.get('fechaInicio'),
        fechaEstimadaFin  = data.get('fechaEstimadaFin'),
        estado            = data.get('estado', 'Pendiente'),
    )
    return JsonResponse(produccion_to_dict(o), status=201)


@admin_required_api
@csrf_exempt
@require_http_methods(['GET', 'PUT', 'DELETE'])
def orden_detalle(request, id):
    try:
        o = Produccion.objects.select_related('idProducto').get(pk=id)
    except Produccion.DoesNotExist:
        return JsonResponse({'error': 'Producción no encontrada'}, status=404)

    if request.method == 'GET':
        # El detalle SÍ trae etapas + historial (para el modal grande)
        return JsonResponse(produccion_to_dict(o, con_etapas=True))

    if request.method == 'PUT':
        data = json.loads(request.body)

        if 'estado' in data and data['estado'] != o.estado:
            clave = (o.estado, data['estado'])
            metodo_nombre = TRANSICIONES_PRODUCCION.get(clave)
            if not metodo_nombre:
                return JsonResponse(
                    {'error': f'No se puede pasar de "{o.estado}" a "{data["estado"]}".'},
                    status=400
                )

            if data['estado'] in ['Pendiente', 'En Progreso']:
                otro_activo = Produccion.objects.filter(
                    idProducto=o.idProducto,
                    estado__in=['Pendiente', 'En Progreso']
                ).exclude(pk=o.pk).exists()
                if otro_activo:
                    return JsonResponse(
                        {'error': f'"{o.idProducto.nombre}" ya tiene otro proceso activo.'},
                        status=400
                    )

            metodo = getattr(o, metodo_nombre)
            if not can_proceed(metodo):
                return JsonResponse(
                    {'error': f'Transición "{metodo_nombre}" no permitida en este momento.'},
                    status=400
                )
            metodo()

        if 'idOrden' in data:
            o.idOrden = data['idOrden']

        for campo in ['descripcion', 'cantidadRequerida',
                      'fechaInicio', 'fechaEstimadaFin', 'fechaRealFin']:
            if campo in data:
                setattr(o, campo, data[campo])

        o.save()
        sincronizar_estado_cliente(o)
        return JsonResponse(produccion_to_dict(o, con_etapas=True))

    o.delete()
    return JsonResponse({'mensaje': 'Registro eliminado'})


# ── AVANCE DE OPERARIOS (proceso de confección) ───────
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


# ── KPIs (compatibilidad con admin_portal.html que ya los usa) ──────
@admin_required_api
def kpis(request):
    total_productos = Producto.objects.count()
    en_progreso     = Produccion.objects.filter(estado='En Progreso').count()
    pendientes      = Produccion.objects.filter(estado='Pendiente').count()
    completados     = Produccion.objects.filter(estado='Completado').count()
    return JsonResponse({
        'totalProductos':    total_productos,
        'ordenesEnProceso':  en_progreso,
        'ordenesPendientes': pendientes,
        'ordenesCompletadas': completados,
    })
