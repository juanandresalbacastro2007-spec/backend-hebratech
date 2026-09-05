# apps/operarios/models.py
#
# Usuario, Operario, Tarea, AsignacionTarea e Incidencia ya NO se
# redefinen acá: viven en apps.administrador.models (fuente única de
# verdad). Este archivo queda como punto de re-exportación para no
# tener que tocar todos los imports existentes de golpe.
#
# apps/operarios/views.py puede seguir haciendo:
#   from .models import AsignacionTarea, Incidencia, Operario
# y va a recibir exactamente las mismas clases que produccion/administrador.

from apps.administrador.models import (  # noqa: F401
    Usuario,
    Operario,
    Tarea,
    AsignacionTarea,
    Incidencia,
)

__all__ = ['Usuario', 'Operario', 'Tarea', 'AsignacionTarea', 'Incidencia']