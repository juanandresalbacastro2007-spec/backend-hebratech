# apps/produccion/management/commands/completar_produccion_madura.py
#
# Corre periódicamente (mismo cron/Task Scheduler que ya usás para el
# comando de detección de atrasos). Revisa todas las Produccion en
# 'En Progreso' con 100% de avance y, si ya cumplieron el tiempo mínimo
# configurado (PRODUCCION_MINUTOS_MINIMOS_EN_PROCESO), las completa —
# lo que dispara en cadena la sincronización con el Orden del cliente.
#
# Uso:
#   python manage.py completar_produccion_madura
#
# Sugerido en el mismo cron que el comando de atrasos, cada 5-10 minutos.

from django.core.management.base import BaseCommand

from apps.administrador.models import AsignacionTarea
from apps.produccion.models import Produccion
from apps.produccion.services import intentar_completar_produccion


class Command(BaseCommand):
    help = 'Completa automáticamente las órdenes de producción con 100%% de avance que ya cumplieron el tiempo mínimo en proceso.'

    def handle(self, *args, **options):
        candidatas = Produccion.objects.filter(estado='En Progreso')
        completadas = 0

        for produccion in candidatas:
            asignaciones = AsignacionTarea.objects.filter(
                idTarea__idProduccion=produccion.idProduccion
            ).exclude(estado='Cancelada')
            total = asignaciones.count()
            if total == 0:
                continue

            hechas = asignaciones.filter(estado='Completada').count()
            if hechas < total:
                continue  # todavía no está al 100%, no es candidata

            if intentar_completar_produccion(produccion):
                completadas += 1
                self.stdout.write(self.style.SUCCESS(
                    f'Produccion #{produccion.idProduccion} completada automáticamente.'
                ))

        if completadas == 0:
            self.stdout.write('No había órdenes de producción listas para completar.')
        else:
            self.stdout.write(self.style.SUCCESS(f'Total completadas: {completadas}'))
