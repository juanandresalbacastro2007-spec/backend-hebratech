# apps/clientes/models.py
#
# Usuario, Cliente, Producto, Orden y Factura ya NO se redefinen acá:
# viven en apps.administrador.models (fuente única de verdad sobre las
# tablas 'usuarios', 'clientes', 'productos', 'ordenes' y 'facturas').
# Este archivo se queda solo con lo que es exclusivo del portal de cliente.

from django.db import models

from apps.administrador.models import Usuario, Cliente, Producto, Orden, Factura

__all__ = [
    'Usuario', 'Cliente', 'Producto', 'Orden', 'Factura',
    'Notificacion', 'Cotizacion',
]


# ── Notificaciones del cliente ────────────────────────────────
class Notificacion(models.Model):
    """
    Registro de notificaciones que el cliente ve en su portal.
    Se crea automáticamente vía señal/servicio cada vez que
    el administrador o el flujo de producción cambia el estado
    de una orden.
    """
    TIPO_CHOICES = [
        ('orden',    'Cambio de estado de orden'),
        ('factura',  'Factura emitida'),
        ('sistema',  'Mensaje del sistema'),
    ]

    idNotificacion = models.AutoField(primary_key=True)
    idCliente = models.ForeignKey(
        Cliente,
        on_delete=models.CASCADE,
        db_column='idCliente',
        related_name='notificaciones'
    )
    tipo = models.CharField(max_length=50, choices=TIPO_CHOICES, default='orden')
    titulo = models.CharField(max_length=200)
    mensaje = models.TextField()
    leida = models.BooleanField(default=False)
    fechaCreacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'notificaciones'
        managed = False
        ordering = ['-fechaCreacion']

    def __str__(self):
        return f'[{self.tipo}] {self.titulo} → Cliente #{self.idCliente_id}'


# ── Cotizaciones ───────────────────────────────────────────────
class Cotizacion(models.Model):
    """
    Solicitud de cotización que el cliente genera desde el portal.
    A diferencia de Orden, NO reserva producción: es solo una
    estimación de costo, no está sujeta a "una orden activa a la vez".
    """
    ESTADO_CHOICES = [
        ('Pendiente', 'Pendiente'),
        ('Revisada', 'Revisada'),
        ('Aprobada', 'Aprobada'),
        ('Rechazada', 'Rechazada'),
    ]

    idCotizacion = models.AutoField(primary_key=True)
    idCliente = models.ForeignKey(
        Cliente,
        on_delete=models.CASCADE,
        db_column='idCliente',
        related_name='cotizaciones'
    )
    idProducto = models.ForeignKey(
        Producto,
        on_delete=models.SET_NULL,
        db_column='idProducto',
        null=True, blank=True
    )
    cantidad = models.IntegerField()
    precioUnitario = models.DecimalField(max_digits=10, decimal_places=2)
    subtotalEstimado = models.DecimalField(max_digits=12, decimal_places=2)
    notas = models.TextField(null=True, blank=True)
    estado = models.CharField(max_length=20, choices=ESTADO_CHOICES, default='Pendiente')
    fechaCreacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cotizaciones'
        managed = False
        ordering = ['-fechaCreacion']

    def __str__(self):
        return f'Cotización #{self.idCotizacion} — Cliente #{self.idCliente_id}'
