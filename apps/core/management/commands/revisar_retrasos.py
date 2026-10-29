"""
Comando: revisar_retrasos

Recorre ordenes, ordenes_produccion y asignacion_tareas buscando registros
cuya fecha límite ya pasó y todavía no están completados/entregados/cancelados.
Los marca como retrasados y dispara una notificación por correo.

Estados que usa cada tabla (según el esquema de la base de datos):
    ordenes             -> 'Retrasado'
    ordenes_produccion  -> 'Fuera de Plazo'
    asignacion_tareas   -> 'Retrasada'

Uso manual:
    python manage.py revisar_retrasos

Uso programado:
    # PythonAnywhere: pestaña "Tasks" -> tarea diaria con el comando
    #   /home/TUUSUARIO/.virtualenvs/MIENV/bin/python /home/TUUSUARIO/RUTA/manage.py revisar_retrasos

    # cron (Linux) - cada hora:
    0 * * * * cd /ruta/al/proyecto && /ruta/al/venv/bin/python manage.py revisar_retrasos

    # Windows Task Scheduler:
    #   Programa: C:\\ruta\\venv\\Scripts\\python.exe
    #   Argumentos: manage.py revisar_retrasos
    #   Directorio de inicio: C:\\ruta\\al\\proyecto
"""

from django.core.management.base import BaseCommand
from django.core.mail import send_mail
from django.db import connection
from django.conf import settings
from django.utils import timezone


class Command(BaseCommand):
    help = "Detecta ordenes, ordenes_produccion y asignacion_tareas retrasadas y notifica."

    def handle(self, *args, **options):
        # localdate() respeta TIME_ZONE (America/Bogota); date.today() usaría
        # la hora del servidor, que en PythonAnywhere es UTC.
        hoy = timezone.localdate()
        total_retrasos = 0

        total_retrasos += self._revisar_ordenes(hoy)
        total_retrasos += self._revisar_produccion(hoy)
        total_retrasos += self._revisar_asignaciones(hoy)

        self.stdout.write(
            self.style.SUCCESS(f"Revisión completa. {total_retrasos} registro(s) marcados como retrasados.")
        )

    # ------------------------------------------------------------------
    # ORDENES (cliente)
    # ------------------------------------------------------------------
    def _revisar_ordenes(self, hoy):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT o.idOrden, o.idCliente, c.correoElectronico, c.nombre
                FROM ordenes o
                JOIN clientes c ON c.idCliente = o.idCliente
                WHERE o.fechaEntregaEstimada < %s
                  AND o.estado NOT IN ('Entregado', 'Cancelado', 'Retrasado')
                """,
                [hoy],
            )
            filas = cursor.fetchall()

            for idOrden, idCliente, correo, nombre in filas:
                cursor.execute(
                    "UPDATE ordenes SET estado = 'Retrasado' WHERE idOrden = %s",
                    [idOrden],
                )
                self._notificar(
                    destinatario=correo,
                    asunto=f"HebraTech - Tu orden #{idOrden} está retrasada",
                    cuerpo=(
                        f"Hola {nombre or ''},\n\n"
                        f"Tu orden #{idOrden} superó la fecha estimada de entrega. "
                        f"Nuestro equipo ya fue notificado y está trabajando en resolverlo.\n\n"
                        f"Gracias por tu paciencia.\nHebraTech"
                    ),
                )

        if filas:
            self.stdout.write(f"  - {len(filas)} orden(es) marcadas como retrasadas.")
        return len(filas)

    # ------------------------------------------------------------------
    # PRODUCCION (tabla ordenes_produccion)
    # ------------------------------------------------------------------
    def _revisar_produccion(self, hoy):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT idOrdenProduccion, idOrden
                FROM ordenes_produccion
                WHERE fechaEntrega < %s
                  AND estado NOT IN ('Completado', 'Cancelada', 'Fuera de Plazo')
                """,
                [hoy],
            )
            filas = cursor.fetchall()

            for idOrdenProduccion, idOrden in filas:
                cursor.execute(
                    "UPDATE ordenes_produccion SET estado = 'Fuera de Plazo' WHERE idOrdenProduccion = %s",
                    [idOrdenProduccion],
                )
                # Si la producción se retrasa, la orden asociada también.
                if idOrden:
                    cursor.execute(
                        """
                        UPDATE ordenes SET estado = 'Retrasado'
                        WHERE idOrden = %s AND estado NOT IN ('Entregado', 'Cancelado', 'Retrasado')
                        """,
                        [idOrden],
                    )

        if filas:
            self.stdout.write(f"  - {len(filas)} proceso(s) de producción marcados como fuera de plazo.")
        return len(filas)

    # ------------------------------------------------------------------
    # ASIGNACION_TAREAS (operario)
    # ------------------------------------------------------------------
    def _revisar_asignaciones(self, hoy):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT at.idAsignacion, at.idTarea, o.idUsuario, u.correoElectronico, u.nombre, u.apellido
                FROM asignacion_tareas at
                JOIN operarios o ON o.idOperario = at.idOperario
                JOIN usuarios u ON u.idUsuario = o.idUsuario
                WHERE at.fechaLimite IS NOT NULL
                  AND at.fechaLimite < %s
                  AND at.estado NOT IN ('Completada', 'Cancelada', 'Retrasada')
                """,
                [hoy],
            )
            filas = cursor.fetchall()

            for idAsignacion, idTarea, idUsuario, correo, nombre, apellido in filas:
                cursor.execute(
                    "UPDATE asignacion_tareas SET estado = 'Retrasada' WHERE idAsignacion = %s",
                    [idAsignacion],
                )
                self._notificar(
                    destinatario=correo,
                    asunto=f"HebraTech - Tarea #{idTarea} retrasada",
                    cuerpo=(
                        f"Hola {nombre or ''} {apellido or ''},\n\n"
                        f"La tarea asignada #{idTarea} superó su fecha límite y fue marcada como retrasada. "
                        f"Por favor actualizá su estado o contactá a tu supervisor.\n\nHebraTech"
                    ),
                )

        if filas:
            self.stdout.write(f"  - {len(filas)} asignación(es) de tarea marcadas como retrasadas.")
        return len(filas)

    # ------------------------------------------------------------------
    def _notificar(self, destinatario, asunto, cuerpo):
        if not destinatario:
            return
        try:
            send_mail(
                subject=asunto,
                message=cuerpo,
                # DEFAULT_FROM_EMAIL siempre tiene valor; EMAIL_HOST_USER puede estar vacío.
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[destinatario],
                # Con fail_silently=True el except de abajo nunca se ejecutaba
                # y los fallos de correo pasaban sin avisar.
                fail_silently=False,
            )
        except Exception as e:
            self.stderr.write(self.style.WARNING(f"No se pudo notificar a {destinatario}: {e}"))