# apps/administrador/models.py
#
# ── FUENTE ÚNICA DE VERDAD ────────────────────────────────────────
# Este archivo consolida los modelos que antes estaban duplicados en
# apps.clientes.models y apps.operarios.models (Usuario, Cliente,
# Operario, Producto, Orden, AsignacionTarea, Tarea, Incidencia).
# clientes/models.py y operarios/models.py ahora IMPORTAN de acá en
# vez de redefinir sus propias clases sobre las mismas tablas MySQL.
# ───────────────────────────────────────────────────────────────────

from django.db import models
from django_fsm import FSMField, transition
from simple_history.models import HistoricalRecords


TIEMPOS_ESTANDAR_MINUTOS = {
    'Camisas': 5,
    'Pantalones': 10,
    'Vestidos': 12,
    'Chaquetas': 12,
    'Bermudas': 15,
}

TIPO_PRENDA_CHOICES = [(k, k) for k in TIEMPOS_ESTANDAR_MINUTOS.keys()]


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
    # Antes solo estaba en apps.operarios.models — la columna sí existe en 'usuarios'.
    fotoPerfil = models.ImageField(
        upload_to='perfiles/', null=True, blank=True, db_column='fotoPerfil'
    )

    class Meta:
        db_table = 'usuarios'
        managed = False

    def __str__(self):
        return f'{self.nombre} {self.apellido}'


class Cliente(models.Model):
    TIPO_CHOICES = [
        ('Natural', 'Natural'),
        ('Empresa', 'Empresa'),
    ]
    ESTADO_CHOICES = [
        ('activo', 'Activo'),
        ('inactivo', 'Inactivo'),
        ('bloqueado', 'Bloqueado'),
    ]

    idCliente = models.AutoField(primary_key=True)
    idUsuario = models.ForeignKey(
        Usuario,
        on_delete=models.CASCADE,
        db_column='idUsuario'
    )
    # Antes solo estaban en apps.clientes.models — las columnas sí existen en 'clientes'.
    tipoCliente = models.CharField(max_length=10, choices=TIPO_CHOICES, default='Natural')
    empresa = models.CharField(max_length=150, null=True, blank=True)
    nombre = models.CharField(max_length=150, null=True, blank=True)
    correoElectronico = models.CharField(max_length=200, null=True, blank=True)
    telefono = models.CharField(max_length=30, null=True, blank=True)
    ciudad = models.CharField(max_length=100, null=True, blank=True)
    direccion = models.CharField(max_length=255, null=True, blank=True)
    nit = models.CharField(max_length=30, null=True, blank=True)
    estado = models.CharField(max_length=20, choices=ESTADO_CHOICES, default='activo')

    class Meta:
        db_table = 'clientes'
        managed = False

    def __str__(self):
        return self.empresa or self.nombre or f'Cliente #{self.idCliente}'


class Operario(models.Model):
    idOperario = models.AutoField(primary_key=True)
    idUsuario = models.ForeignKey(
        Usuario,
        on_delete=models.CASCADE,
        db_column='idUsuario'
    )
    especialidad = models.CharField(max_length=100)
    fechaIngreso = models.DateField()
    estado = models.CharField(max_length=20, default='activo')

    class Meta:
        db_table = 'operarios'
        managed = False

    def __str__(self):
        return f'{self.idUsuario.nombre} — {self.especialidad}'


class Tarea(models.Model):
    COMPLEJIDAD_CHOICES = [
        ('baja', 'Baja'),
        ('media', 'Media'),
        ('alta', 'Alta'),
    ]

    idTarea = models.AutoField(primary_key=True)
    # La columna existe en la tabla real 'tareas' pero ningún modelo la
    # tenía mapeada. Queda disponible como segundo posible camino de
    # conexión Tarea → Produccion (a definir cuál usamos como fuente).
    idProduccion = models.IntegerField(null=True, blank=True, db_column='idProduccion')
    nombreTarea = models.CharField(max_length=150)
    descripcionTarea = models.TextField()
    fechaCreacion = models.DateField(auto_now_add=True)
    proceso = models.CharField(max_length=100)
    complejidad = models.CharField(max_length=10, choices=COMPLEJIDAD_CHOICES, default='media')

    class Meta:
        db_table = 'tareas'
        managed = False

    def __str__(self):
        return self.nombreTarea


class AsignacionTarea(models.Model):
    ESTADO_CHOICES = [
        ('Pendiente', 'Pendiente'),
        ('En Progreso', 'En Progreso'),
        ('Completada', 'Completada'),
        ('Cancelada', 'Cancelada'),
        ('Retrasada', 'Retrasada'),
    ]
    PRIORIDAD_CHOICES = [
        ('Baja', 'Baja'),
        ('Media', 'Media'),
        ('Alta', 'Alta'),
        ('Urgente', 'Urgente'),
    ]

    idAsignacion = models.AutoField(primary_key=True)
    idTarea = models.ForeignKey(
        Tarea,
        on_delete=models.CASCADE,
        db_column='idTarea'
    )
    idOperario = models.ForeignKey(
        Operario,
        on_delete=models.CASCADE,
        db_column='idOperario'
    )
    idOrden = models.ForeignKey(
        'Orden',
        on_delete=models.CASCADE,
        db_column='idOrden',
        null=True,
        blank=True,
        related_name='asignaciones'
    )
    descripcion = models.TextField()
    fechaAsignacion = models.DateField(auto_now_add=True)
    fechaInicio = models.DateField()
    fechaLimite = models.DateField(null=True, blank=True)
    fechaFinalizacion = models.DateField(null=True, blank=True)
    estado = models.CharField(max_length=20, choices=ESTADO_CHOICES, default='Pendiente')
    prioridad = models.CharField(max_length=10, choices=PRIORIDAD_CHOICES, default='Media')
    horasEstimadas = models.DecimalField(max_digits=5, decimal_places=2)
    tipoPrenda = models.CharField(max_length=50, choices=TIPO_PRENDA_CHOICES, null=True, blank=True)
    cantidadPrendas = models.IntegerField(null=True, blank=True)
    horasReales = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = 'asignacion_tareas'
        managed = False

    def __str__(self):
        return f'Asignación #{self.idAsignacion}'


class Producto(models.Model):
    idProducto = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=150, db_column='nombre')
    descripcion = models.TextField()
    precio = models.DecimalField(max_digits=10, decimal_places=2)
    categoria = models.CharField(max_length=100)  # texto libre en BD real, sin choices
    estado = models.CharField(max_length=20, null=True, blank=True, default='activo')

    class Meta:
        db_table = 'productos'
        managed = False

    def __str__(self):
        return self.nombre


class Orden(models.Model):
    ESTADO_CHOICES = [
        ('Pendiente',  'Pendiente'),
        ('Procesando', 'Procesando'),
        ('Enviado',    'Enviado'),
        ('Entregado',  'Entregado'),
        ('Cancelado',  'Cancelado'),
        ('Retrasado',  'Retrasado'),
    ]
    PRIORIDAD_CHOICES = [
        ('Normal',  'Normal'),
        ('Urgente', 'Urgente'),
    ]

    idOrden = models.AutoField(primary_key=True)
    idCliente = models.ForeignKey(
        Cliente,
        on_delete=models.CASCADE,
        db_column='idCliente'
    )
    idProducto = models.ForeignKey(
        Producto,
        on_delete=models.SET_NULL,
        db_column='idProducto',
        null=True, blank=True
    )
    nombreProducto = models.CharField(max_length=150, null=True, blank=True, db_column='nombreProducto')
    fechaCreacion = models.DateField(auto_now_add=True)
    fechaEntregaEstimada = models.DateField(null=True, blank=True)
    instrucciones = models.CharField(max_length=1000)
    cantidad = models.IntegerField(null=True, blank=True)
    precioUnitario = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    prioridad = models.CharField(max_length=10, choices=PRIORIDAD_CHOICES, default='Normal')
    estado = FSMField(default='Pendiente', choices=ESTADO_CHOICES)

    history = HistoricalRecords()

    class Meta:
        db_table = 'ordenes'
        managed = False

    def __str__(self):
        return f'Orden #{self.idOrden} — {self.estado}'

    # ── Transiciones normales, disparadas por producción ──────────
    @transition(field=estado, source='Pendiente', target='Procesando')
    def marcar_en_produccion(self):
        pass

    @transition(field=estado, source='Procesando', target='Enviado')
    def marcar_enviado(self):
        pass

    @transition(field=estado, source='Enviado', target='Entregado')
    def marcar_entregado(self):
        pass

    @transition(field=estado, source='Enviado', target='Procesando')
    def revertir_a_produccion(self):
        pass

    @transition(field=estado, source=['Pendiente', 'Procesando'], target='Cancelado')
    def cancelar(self):
        pass

    # NOTA: 'Retrasado' no es una transición manual — lo aplica el
    # management command de detección de atrasos vía queryset.update(),
    # que no pasa por el FSMField. Al avanzar de estado normalmente,
    # la orden sale de 'Retrasado' sin necesidad de una transición extra.


class Incidencia(models.Model):
    ESTADO_CHOICES = [
        ('Generado', 'Generado'),
        ('Revisado', 'Revisado'),
        ('Pendiente', 'Pendiente'),
    ]

    idIncidencia = models.AutoField(primary_key=True)
    idOperario = models.ForeignKey(
        Operario,
        on_delete=models.CASCADE,
        db_column='idUsuario'   # la columna real en MySQL es idUsuario, no idOperario
    )
    tipoIncidencia = models.CharField(max_length=50)
    descripcion = models.TextField()
    estado = models.CharField(max_length=30, choices=ESTADO_CHOICES, default='Generado')
    fechaGeneracion = models.DateField(auto_now_add=True)
    fechaRevision = models.DateField(null=True, blank=True)
    periodoEvaluado = models.CharField(max_length=50, null=True, blank=True)
    respuesta = models.TextField(null=True, blank=True)
    respuestaLeida = models.BooleanField(default=True)

    class Meta:
        db_table = 'incidencias'
        managed = False

    def __str__(self):
        return f'Incidencia #{self.idIncidencia} — {self.tipoIncidencia}'


class Factura(models.Model):
    ESTADO_CHOICES = [
        ('Emitida', 'Emitida'),
        ('Pendiente de pago', 'Pendiente de pago'),
        ('Pagada', 'Pagada'),
    ]

    idFactura = models.AutoField(primary_key=True)
    idOrden = models.ForeignKey(
        Orden,
        on_delete=models.CASCADE,
        db_column='idOrden'
    )
    idCliente = models.ForeignKey(
        Cliente,
        on_delete=models.CASCADE,
        db_column='idCliente'
    )
    numeroFactura = models.CharField(max_length=30, unique=True)
    fechaEmision = models.DateTimeField(auto_now_add=True)
    fechaPago = models.DateTimeField(null=True, blank=True)
    rutaPDF = models.CharField(max_length=255)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    estado = models.CharField(max_length=20, choices=ESTADO_CHOICES, default='Emitida')

    class Meta:
        db_table = 'facturas'
        managed = False

    def __str__(self):
        return f'Factura {self.numeroFactura}'


class Inventario(models.Model):
    idInventario = models.AutoField(primary_key=True)
    producto = models.ForeignKey(
        Producto,
        on_delete=models.CASCADE,
        db_column='idProducto',
        related_name='inventarios'
    )
    cantidadDisponible = models.IntegerField(default=0)
    minimoDefinido = models.IntegerField(default=0)
    nivelStock = models.IntegerField(default=0)
    unidades = models.CharField(max_length=50, default='Unidades')
    ubicacion = models.CharField(max_length=150)
    fechaActualizacion = models.DateField(auto_now=True)
    cantidadIngresada = models.IntegerField(default=0)
    cantidadEgresada = models.IntegerField(default=0)
    fechaIngreso = models.DateField()
    fechaSalida = models.DateField(null=True, blank=True)

    class Meta:
        db_table = 'inventario'
        managed = False

    def __str__(self):
        return f'Inventario #{self.idInventario} — Producto #{self.producto_id}'


class Material(models.Model):
    idMaterial = models.AutoField(primary_key=True, db_column='idMaterial')
    nombreMaterial = models.CharField(max_length=100, db_column='nombreMaterial')
    descripcion = models.TextField(blank=True, null=True, db_column='descripcion')
    stockActual = models.DecimalField(max_digits=10, decimal_places=2, db_column='stockActual')
    stockMinimo = models.DecimalField(max_digits=10, decimal_places=2, db_column='stockMinimo')
    unidadBase = models.CharField(max_length=50, db_column='unidadBase')
    costoUnitario = models.DecimalField(max_digits=10, decimal_places=2, db_column='costoUnitario')
    fechaActualizacion = models.DateField(auto_now=True, db_column='fechaActualizacion')

    class Meta:
        db_table = 'materiales'
        verbose_name = 'Material'
        verbose_name_plural = 'Materiales'

    def __str__(self):
        return self.nombreMaterial
