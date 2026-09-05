# apps/produccion/services.py
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from django_fsm import can_proceed

from apps.administrador.models import Orden
from .models import Produccion

# Cuánto tiempo mínimo debe quedar una orden en "Procesando" (En Progreso en
# Produccion) antes de poder pasar a "Enviado", aunque el 100% de las tareas
# ya esté completo. Es una regla de negocio, no técnica — ajustable en
# settings.py sin tocar este archivo:
#     PRODUCCION_MINUTOS_MINIMOS_EN_PROCESO = 30
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


def _tiempo_en_progreso(produccion):
    """
    Cuánto tiempo lleva 'produccion' en estado 'En Progreso', según su
    historial (django-simple-history). None si nunca estuvo en ese estado
    (no debería pasar si estado == 'En Progreso', pero por las dudas).
    """
    primer_registro = (
        produccion.history.filter(estado='En Progreso').order_by('history_date').first()
    )
    if not primer_registro:
        return None
    return timezone.now() - primer_registro.history_date


def intentar_completar_produccion(produccion):
    """
    Completa 'produccion' SOLO si ya cumplió el tiempo mínimo en 'En Progreso'.
    La llaman tanto recalcular_produccion_desde_tareas() (por si ya pasó el
    tiempo) como el management command periódico (para las que quedaron
    esperando el mínimo).
    """
    if produccion.estado != 'En Progreso' or not can_proceed(produccion.completar):
        return False

    tiempo = _tiempo_en_progreso(produccion)
    if tiempo is None or tiempo < timedelta(minutes=MINUTOS_MINIMOS_EN_PROCESO):
        return False  # todavía no cumplió el mínimo — se reintenta después

    produccion.completar()
    produccion.fechaRealFin = timezone.now().date()
    produccion.save(update_fields=['estado', 'fechaRealFin'])
    sincronizar_estado_cliente(produccion)
    return True


# ── Recalculo de avance a partir del trabajo real de los operarios ────

def recalcular_produccion_desde_tareas(id_produccion):
    """
    Se llama cada vez que una AsignacionTarea cambia de estado.
    Recorre las AsignacionTarea cuya Tarea apunta a esta Produccion
    (Tarea.idProduccion) y calcula el % de avance.

    - 0%         -> no hace nada (sigue Pendiente)
    - 0% - 100%  -> dispara iniciar() de inmediato (el cliente ve "Procesando" ya)
    - 100%       -> intenta completar(), pero solo si ya pasó el tiempo
                    mínimo en 'En Progreso'. Si no, queda para que la
                    recoja el management command periódico.
    """
    from apps.administrador.models import AsignacionTarea  # import local: evita ciclo

    if not id_produccion:
        return None

    try:
        produccion = Produccion.objects.get(pk=id_produccion)
    except Produccion.DoesNotExist:
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
        if produccion.estado == 'Pendiente' and can_proceed(produccion.iniciar):
            produccion.iniciar()
            produccion.save(update_fields=['estado'])
            sincronizar_estado_cliente(produccion)

    else:  # avance_pct >= 100
        if produccion.estado == 'Pendiente' and can_proceed(produccion.iniciar):
            produccion.iniciar()
            produccion.save(update_fields=['estado'])
            sincronizar_estado_cliente(produccion)
            # Recién acaba de entrar a 'En Progreso' -> todavía NO cumple el
            # mínimo, aunque el avance ya sea 100%. Se completa más tarde,
            # vía el management command.
        else:
            intentar_completar_produccion(produccion)

    return produccion
