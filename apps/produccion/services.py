# apps/produccion/services.py
import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from django_fsm import can_proceed

from apps.administrador.models import Orden, AsignacionTarea
from .models import OrdenProduccion

logger = logging.getLogger(__name__)

MINUTOS_MINIMOS_EN_PROCESO = getattr(settings, 'PRODUCCION_MINUTOS_MINIMOS_EN_PROCESO', 30)

TRANSICION_CLIENTE_MAP = {
    'En Progreso': 'marcar_en_produccion',   # Orden: Pendiente -> Procesando
    'Completado':  'marcar_enviado',         # Orden: Procesando -> Enviado
}


# ═══════════════════════════════════════════════════════════════════
# SINCRONIZACIÓN Orden de Producción → Orden de Cliente
# ═══════════════════════════════════════════════════════════════════

def sincronizar_estado_cliente(produccion):
    """
    Aplica al Orden de cliente la transición FSM equivalente al nuevo
    estado de la OrdenProduccion.
    """
    if not produccion.idOrden_id:
        return None

    metodo_nombre = TRANSICION_CLIENTE_MAP.get(produccion.estado)
    if not metodo_nombre:
        return None

    try:
        orden = Orden.objects.get(pk=produccion.idOrden_id)
    except Orden.DoesNotExist:
        return None

    metodo = getattr(orden, metodo_nombre, None)
    if not metodo:
        return orden

    if not can_proceed(metodo):
        logger.info(
            'Sincronización omitida: %s no procede sobre Orden #%s (estado: %s)',
            metodo_nombre, orden.pk, orden.estado,
        )
        return orden

    metodo()
    orden.save(update_fields=['estado'])
    registrar_evento(produccion, orden)
    return orden


def registrar_evento(produccion, orden):
    if orden.estado == 'Enviado':
        pass  # enganchar aquí Notificacion(cliente=...) / Gmail SMTP existente


def intentar_completar_produccion(produccion):
    """
    Marca la OrdenProduccion como Completado si está En Progreso,
    sincroniza con la Orden del cliente y propaga el estado a sus tareas.
    """
    if produccion.estado != 'En Progreso':
        return False

    produccion.estado = 'Completado'
    produccion.fechaFinReal = timezone.now().date()
    produccion.save(update_fields=['estado', 'fechaFinReal'])
    sincronizar_estado_cliente(produccion)
    propagar_estado_a_tareas(produccion)
    return True


# ═══════════════════════════════════════════════════════════════════
# AUTOMATIZACIÓN: Tareas → Producción (avance)
# ═══════════════════════════════════════════════════════════════════

def recalcular_produccion_desde_tareas(id_produccion):
    """
    Recalcula el % de avance de una OrdenProduccion a partir del estado
    de sus AsignacionTarea vinculadas (idOrdenProduccion_id).

      - 0%         -> no cambia (sigue Pendiente)
      - 0% - 100%  -> pasa a 'En Progreso'
      - 100%       -> pasa a 'Completado' + fechaFinReal
    """
    if not id_produccion:
        return None

    try:
        produccion = OrdenProduccion.objects.get(pk=id_produccion)
    except OrdenProduccion.DoesNotExist:
        return None

    asignaciones = AsignacionTarea.objects.filter(idOrdenProduccion_id=id_produccion)
    activas = asignaciones.exclude(estado='Cancelada')
    total = activas.count()
    if total == 0:
        return produccion

    completadas = activas.filter(estado='Completada').count()
    avance_pct = round((completadas / total) * 100)

    if avance_pct == 0:
        pass

    elif avance_pct < 100:
        if produccion.estado == 'Pendiente':
            produccion.estado = 'En Progreso'
            produccion.save(update_fields=['estado'])
            sincronizar_estado_cliente(produccion)

    else:  # avance_pct >= 100
        if produccion.estado == 'Pendiente':
            produccion.estado = 'En Progreso'
            produccion.save(update_fields=['estado'])
            sincronizar_estado_cliente(produccion)
        intentar_completar_produccion(produccion)

    return produccion


# ═══════════════════════════════════════════════════════════════════
# AUTOMATIZACIÓN: Producción → Tareas (estado y fechas)
# ═══════════════════════════════════════════════════════════════════

def propagar_estado_a_tareas(produccion):
    """
    Cuando la OrdenProduccion cambia de estado, mueve las tareas vinculadas:

      - Completado -> Pendiente / En Progreso pasan a Completada
      - Cancelada  -> Pendiente / En Progreso pasan a Cancelada
      - Otros      -> no se tocan (el operario las gestiona)
    """
    if produccion.estado == 'Completado':
        AsignacionTarea.objects.filter(
            idOrdenProduccion_id=produccion.pk,
            estado__in=['Pendiente', 'En Progreso'],
        ).update(
            estado='Completada',
            fechaFinalizacion=timezone.now().date(),
        )
    elif produccion.estado == 'Cancelada':
        AsignacionTarea.objects.filter(
            idOrdenProduccion_id=produccion.pk,
            estado__in=['Pendiente', 'En Progreso'],
        ).update(estado='Cancelada')


def sincronizar_fechas_tareas_con_produccion(produccion):
    """
    Fuerza que las tareas no finalizadas tengan EXACTAMENTE el rango
    de fechas de la orden:
        fechaInicio = orden.fechaInicio
        fechaLimite = orden.fechaEntrega
    """
    AsignacionTarea.objects.filter(
        idOrdenProduccion_id=produccion.pk,
        estado__in=['Pendiente', 'En Progreso'],
    ).update(
        fechaInicio=produccion.fechaInicio,
        fechaLimite=produccion.fechaEntrega,
    )


def desplazar_tareas_por_cambio_fecha(id_produccion, delta_dias):
    """
    Corre fechaInicio y fechaLimite de las tareas no terminadas el mismo
    número de días que se movió la fechaInicio de la orden de producción.

    Se llama cuando cambia `fechaInicio` de la OP. Como el lote empieza
    más tarde (o más temprano), todas las tareas se reprograman.
    """
    if not id_produccion or not delta_dias:
        return 0

    asignaciones = AsignacionTarea.objects.filter(
        idOrdenProduccion_id=id_produccion,
        estado__in=['Pendiente', 'En Progreso'],
    )

    movidas = 0
    for asignacion in asignaciones:
        cambios = []
        if asignacion.fechaInicio:
            asignacion.fechaInicio += timedelta(days=delta_dias)
            cambios.append('fechaInicio')
        if asignacion.fechaLimite:
            asignacion.fechaLimite += timedelta(days=delta_dias)
            cambios.append('fechaLimite')
        if cambios:
            asignacion.save(update_fields=cambios)
            movidas += 1
    return movidas


def desplazar_fechaLimite_por_cambio_entrega(id_produccion, delta_dias):
    """
    Corre SOLO fechaLimite de las tareas no terminadas cuando se movió
    fechaEntrega de la orden de producción. No toca fechaInicio.

    Se llama cuando cambia `fechaEntrega` de la OP: el operario sigue
    empezando el mismo día, solo tiene más (o menos) plazo para terminar.
    """
    if not id_produccion or not delta_dias:
        return 0

    asignaciones = AsignacionTarea.objects.filter(
        idOrdenProduccion_id=id_produccion,
        estado__in=['Pendiente', 'En Progreso'],
        fechaLimite__isnull=False,
    )

    movidas = 0
    for asignacion in asignaciones:
        asignacion.fechaLimite += timedelta(days=delta_dias)
        asignacion.save(update_fields=['fechaLimite'])
        movidas += 1
    return movidas