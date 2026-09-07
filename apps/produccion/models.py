from django.db import models
from django_fsm import FSMField, transition
from simple_history.models import HistoricalRecords


class Producto(models.Model):
    CATEGORIA_CHOICES = [
        ('Camisa',    'Camisa'),
        ('Pantalón',  'Pantalón'),
        ('Uniforme',  'Uniforme'),
        ('Chaqueta',  'Chaqueta'),
        ('Accesorio', 'Accesorio'),
    ]

    idProducto  = models.AutoField(primary_key=True)
    nombre      = models.CharField(max_length=150)
    descripcion = models.TextField()
    precio      = models.DecimalField(max_digits=10, decimal_places=2)
    categoria   = models.CharField(max_length=100, choices=CATEGORIA_CHOICES)
    estado      = models.CharField(max_length=20, default='activo')

    class Meta:
        db_table = 'productos'
        managed  = False

    def __str__(self):
        return self.nombre


class Prenda(models.Model):
    idPrenda    = models.AutoField(primary_key=True)
    nombre      = models.CharField(max_length=150)
    codigo      = models.CharField(max_length=30, unique=True)
    categoria   = models.CharField(max_length=20)
    tallas      = models.CharField(max_length=100)
    tiempoMinutos = models.IntegerField()
    stockObjetivo = models.IntegerField()
    descripcion = models.TextField(blank=True, null=True)
    estado      = models.CharField(max_length=20)

    class Meta:
        db_table = 'prendas'
        managed  = False

    def __str__(self):
        return self.nombre


class OrdenProduccion(models.Model):
    PRIORIDAD_CHOICES = [
        ('Normal', 'Normal'),
        ('Urgente', 'Urgente'),
    ]
    ESTADO_CHOICES = [
        ('Pendiente', 'Pendiente'),
        ('En Progreso', 'En Progreso'),
        ('Completado', 'Completado'),
        ('Atrasada', 'Atrasada'),
        ('Cancelada', 'Cancelada'),
    ]

    idOrdenProduccion = models.AutoField(primary_key=True)
    numero = models.CharField(max_length=20, unique=True)
    idOrden = models.ForeignKey('administrador.Orden', on_delete=models.SET_NULL, null=True, blank=True, db_column='idOrden')
    idProducto = models.ForeignKey(Producto, on_delete=models.CASCADE, db_column='idProducto')
    cliente = models.CharField(max_length=150)
    cantidad = models.IntegerField(default=0)
    fechaInicio = models.DateField()
    fechaEntrega = models.DateField()
    fechaFinReal = models.DateField(null=True, blank=True)
    prioridad = models.CharField(max_length=10, choices=PRIORIDAD_CHOICES, default='Normal')
    estado = models.CharField(max_length=20, choices=ESTADO_CHOICES, default='Pendiente')
    observaciones = models.TextField(blank=True, null=True)
    fechaCreacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'ordenes_produccion'
        managed = False

    def __str__(self):
        return f"{self.numero} - {self.cliente}"