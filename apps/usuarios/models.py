import secrets
from datetime import timedelta
from django.utils import timezone
from django.db import models


class Usuario(models.Model):
    ROL_CHOICES = [
        ('administrador', 'Administrador'),
        ('operario', 'Operario'),
        ('cliente', 'Cliente'),
        ('sin_asignar', 'Sin asignar'),
    ]
    ESTADO_CHOICES = [
        ('activo', 'Activo'),
        ('inactivo', 'Inactivo'),
        ('pendiente', 'Pendiente de aprobación'),
        ('reportado', 'Reportado'),
    ]

    idUsuario = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100)
    apellido = models.CharField(max_length=100)
    correoElectronico = models.CharField(max_length=200, unique=True)
    contrasena = models.CharField(max_length=255)
    telefono = models.CharField(max_length=20, null=True, blank=True)
    direccion = models.CharField(max_length=255, null=True, blank=True)
    rol = models.CharField(max_length=20, choices=ROL_CHOICES, default='sin_asignar')
    estado = models.CharField(max_length=20, choices=ESTADO_CHOICES, default='pendiente')
    emailVerificado = models.BooleanField(default=False)
    emailVerificadoEn = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'usuarios'
        managed = False

    def __str__(self):
        return f'{self.nombre} {self.apellido}'


class PasswordResetToken(models.Model):
    idToken = models.AutoField(primary_key=True)
    idUsuario = models.IntegerField()
    token = models.CharField(max_length=64, unique=True)
    fechaCreacion = models.DateTimeField(auto_now_add=True)
    expira = models.DateTimeField()
    usado = models.BooleanField(default=False)

    class Meta:
        db_table = 'password_reset_tokens'
        managed = False

    @staticmethod
    def generar_para_usuario(id_usuario, minutos_validez=15):
        # Invalida cualquier token anterior sin usar de ese usuario
        PasswordResetToken.objects.filter(
            idUsuario=id_usuario, usado=False
        ).update(usado=True)

        nuevo_token = secrets.token_urlsafe(32)
        return PasswordResetToken.objects.create(
            idUsuario=id_usuario,
            token=nuevo_token,
            expira=timezone.now() + timedelta(minutes=minutos_validez)
        )

    def es_valido(self):
        return not self.usado and timezone.now() <= self.expira