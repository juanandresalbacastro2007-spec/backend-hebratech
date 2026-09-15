# apps/produccion/services.py
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from django_fsm import can_proceed

from apps.administrador.models import Orden
from .models import OrdenProduccion

# Cuánto tiempo mínimo debe quedar una orden en "Procesando" (En Progreso en
# Produccion) antes de poder pasar a "Enviado", aunque el 100% de las tareas
# ya esté completo. Es una regla de negocio, no técnica — ajustable en
# settings.py sin tocar este archivo:
#     PRODUCCION_MINUTOS_MINIMOS_EN_PROCESO = 30
#
# NOTA: esta regla dependía de un modelo `Produccion` con FSMField +
# django-simple-history (`produccion.history`) que ya no existe — el modelo
# real es `OrdenProduccion`, con `estado` como CharField normal y sin
# historial. Por eso, por ahora, el avance a 'Completado' es inmediato en
# cuanto el 100% de las tareas activas están completas (sin esperar este
# mínimo). Si quieres reactivar el mínimo de tiempo, hay que agregar una
# columna que registre cuándo pasó a 'En Progreso' (o simple-history real
# sobre OrdenProduccion) — avísame y lo dejamos funcionando de nuevo.
MINUTOS_MINIMOS_EN_PROCESO = getattr(settings, 'PRODUCCION_MINUTOS_MINIMOS_EN_PROCESO', 30)

TRANSICION_CLIENTE_MAP = {
    'En Progreso': 'marcar_en_produccion',   # Orden: Pendiente -> Procesando
    'Completado':  'marcar_enviado',         # Orden: Procesando -> Enviado
}


def sincronizar_estado_cliente(produccion):
    """Traduce el estado interno de Produccion al estado del Orden del cliente."""
    if not produccion.idOrden:
        return None

    metodo_nombre = TRANSICION_CLIENTE_MAP.get(produccion.estado)
    if not metodo_nombre:
        return None

    try:
        orden = Orden.objects.get(pk=produccion.idOrden)
    except Orden.DoesNotExist:
        return None

    metodo = getattr(orden, metodo_nombre, None)
    if metodo and can_proceed(metodo):
        metodo()
        orden.save(update_fields=['estado'])
        registrar_evento(produccion, orden)

    return orden


def registrar_evento(produccion, orden):
    if orden.estado == 'Enviado':
        pass  # enganchar aquí Notificacion(cliente=...) / Gmail SMTP existente


def intentar_completar_produccion(produccion):
    """
    Completa 'produccion' (OrdenProduccion) si está 'En Progreso'.
    La regla del tiempo mínimo quedó desactivada (ver nota arriba) hasta que
    haya una forma real de medir cuánto lleva en ese estado.
    """
    if produccion.estado != 'En Progreso':
        return False

    produccion.estado = 'Completado'
    produccion.fechaFinReal = timezone.now().date()
    produccion.save(update_fields=['estado', 'fechaFinReal'])
    sincronizar_estado_cliente(produccion)
    return True


# ── Recalculo de avance a partir del trabajo real de los operarios ────

def recalcular_produccion_desde_tareas(id_produccion):
    """
    Se llama cada vez que una AsignacionTarea cambia de estado.
    Recorre las AsignacionTarea cuya Tarea apunta a esta OrdenProduccion
    (Tarea.idProduccion) y calcula el % de avance.

    - 0%         -> no hace nada (sigue Pendiente)
    - 0% - 100%  -> pasa a 'En Progreso' de inmediato (el cliente ve
                    "Procesando" ya)
    - 100%       -> pasa a 'Completado' de inmediato y registra fechaFinReal
    """
    from apps.administrador.models import AsignacionTarea  # import local: evita ciclo

    if not id_produccion:
        return None

    try:
        produccion = OrdenProduccion.objects.get(pk=id_produccion)
    except OrdenProduccion.DoesNotExist:
        return None

    asignaciones = AsignacionTarea.objects.filter(idTarea__idProduccion=id_produccion)
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


# ── Reprogramación en cascada: mover la orden mueve las tareas ────────

def desplazar_tareas_por_cambio_fecha(id_produccion, delta_dias):
    """
    Cuando se adelanta o atrasa la fechaInicio de una OrdenProduccion,
    corre por el mismo número de días las tareas de operarios que todavía
    no terminaron (Pendiente / En Progreso), para que el cronograma de
    producción y el de los operarios queden sincronizados.

    No toca tareas 'Completada' ni 'Cancelada' — esas ya pasaron y no se
    reprograman.

    delta_dias puede ser negativo (adelantar) o positivo (atrasar).
    Devuelve cuántas asignaciones se movieron.
    """
    from apps.administrador.models import AsignacionTarea  # import local: evita ciclo

    if not id_produccion or not delta_dias:
        return 0

    asignaciones = AsignacionTarea.objects.filter(
        idTarea__idProduccion=id_produccion,
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