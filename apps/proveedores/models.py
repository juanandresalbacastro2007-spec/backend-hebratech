# apps/proveedores/models.py

from django.db import models
from apps.administrador.models import Usuario


class Proveedor(models.Model):
    # Definición de opciones estandarizadas en minúsculas
    ESTADO_CHOICES = [
        ('activo', 'Activo'),
        ('inactivo', 'Inactivo'),
    ]

    idProveedor = models.AutoField(primary_key=True)
    nombreEmpresa = models.CharField(max_length=150, db_column='nombreEmpresa')
    nombreContacto = models.CharField(
        max_length=100, db_column='nombreContacto', null=True, blank=True
    )
    telefono = models.CharField(
        max_length=20, db_column='telefono', null=True, blank=True
    )
    correo = models.EmailField(
        max_length=200, db_column='correo', null=True, blank=True
    )
    direccion = models.CharField(
        max_length=255, db_column='direccion', null=True, blank=True
    )
    nit = models.CharField(
        max_length=30, db_column='nit', null=True, blank=True
    )
    estado = models.CharField(
        max_length=20, choices=ESTADO_CHOICES, default='activo'
    )
    fechaRegistro = models.DateField(
        db_column='fechaRegistro', default='2026-01-01'
    )

    class Meta:
        managed = False
        db_table = 'proveedores'
        constraints = [
            models.UniqueConstraint(fields=['nit'], name='unique_nit_proveedor'),
        ]

    def __str__(self):
        return self.nombreEmpresa