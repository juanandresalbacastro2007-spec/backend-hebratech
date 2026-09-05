#Views para el portal del cliente, incluyendo registro de órdenes, generación de facturas y cotizaciones, edición de perfil y manejo de notificaciones.

import os

from datetime import datetime

from django.conf import settings
from django.contrib import messages
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import render, redirect, get_object_or_404
from django.template.loader import render_to_string

from xhtml2pdf import pisa

from .models import (
    Orden,
    Cliente,
    Producto,
    Usuario,
    Factura,
    Cotizacion,
    Notificacion,
)

from apps.core.decorators import login_required_rol


# ============================================================
# PROTECCIÓN POR ROL
# ============================================================

cliente_required = login_required_rol(
    rol_esperado='cliente',
    session_key='usuario_id'
)


# ============================================================
# GENERAR FACTURA PDF
# ============================================================

def _generar_factura_pdf(orden):
    """
    Genera el PDF de la orden, lo guarda en media/facturas/
    y crea el registro de factura en la base de datos.
    """

    subtotal = (
        (orden.precioUnitario or 0)
        * (orden.cantidad or 0)
    )

    numero_factura = (
        f'F-{datetime.now().strftime("%Y%m%d")}-{orden.idOrden:04d}'
    )

    html = render_to_string(
        'clientes/factura_pdf.html',
        {
            'orden': orden,
            'subtotal': subtotal,
            'factura': {
                'numeroFactura': numero_factura,
                'fechaEmision': datetime.now(),
            },
        }
    )

    carpeta = os.path.join(
        settings.MEDIA_ROOT,
        'facturas'
    )

    os.makedirs(
        carpeta,
        exist_ok=True
    )

    nombre_archivo = f'{numero_factura}.pdf'

    ruta_absoluta = os.path.join(
        carpeta,
        nombre_archivo
    )

    with open(ruta_absoluta, 'wb') as f:
        pisa.CreatePDF(
            html,
            dest=f
        )

    factura = Factura.objects.create(
        idOrden=orden,
        idCliente=orden.idCliente,
        numeroFactura=numero_factura,
        rutaPDF=f'facturas/{nombre_archivo}',
        total=subtotal,
        estado='Pendiente de pago'
    )

    return factura


# ============================================================
# PORTAL DEL CLIENTE
# ============================================================

@cliente_required
def cliente_portal(request):

    usuario_id = request.session['usuario_id']

    try:
        cliente = Cliente.objects.get(
            idUsuario=usuario_id
        )
    except Cliente.DoesNotExist:

        messages.error(
            request,
            'Tu usuario no tiene un perfil de cliente asociado.'
        )

        return redirect('login')

    try:
        usuario = Usuario.objects.get(
            idUsuario=usuario_id
        )
    except Usuario.DoesNotExist:

        messages.error(
            request,
            'No se encontró el usuario.'
        )

        return redirect('login')

    # --------------------------------------------------------
    # TODAS LAS ÓRDENES DEL CLIENTE
    # --------------------------------------------------------

    ordenes = Orden.objects.filter(
        idCliente=cliente
    ).order_by('-fechaCreacion')

    # --------------------------------------------------------
    # PRODUCTOS DISPONIBLES
    # Se convierte precio a int para que el template lo pase
    # al JS como número entero limpio (ej: 95000) sin puntos,
    # comas ni decimales, independiente de USE_L10N del proyecto.
    # --------------------------------------------------------

    productos_qs = Producto.objects.all()
    for p in productos_qs:
        p.precio_js = int(p.precio)
    productos = productos_qs

    # --------------------------------------------------------
    # CONTADORES
    # --------------------------------------------------------

    ordenes_activas = ordenes.filter(
        estado__in=[
            'Procesando',
            'Enviado'
        ]
    ).count()

    ordenes_completadas = ordenes.filter(
        estado='Entregado'
    ).count()

    ordenes_pendientes = ordenes.filter(
        estado='Pendiente'
    ).count()

    # --------------------------------------------------------
    # ORDEN ACTIVA
    # --------------------------------------------------------

    orden_activa = ordenes.filter(
        estado__in=[
            'Pendiente',
            'Procesando',
            'Enviado'
        ]
    ).first()

    # --------------------------------------------------------
    # PRÓXIMA ENTREGA
    # --------------------------------------------------------

    proxima_entrega = (
        ordenes
        .exclude(
            estado__in=[
                'Entregado',
                'Cancelado'
            ]
        )
        .exclude(
            fechaEntregaEstimada__isnull=True
        )
        .order_by(
            'fechaEntregaEstimada'
        )
        .first()
    )

    # --------------------------------------------------------
    # ÓRDENES RECIENTES
    # --------------------------------------------------------

    ordenes_recientes = ordenes[:3]

    # --------------------------------------------------------
    # FACTURAS
    # --------------------------------------------------------

    facturas = Factura.objects.filter(
        idCliente=cliente
    ).order_by(
        '-fechaEmision'
    )

    # --------------------------------------------------------
    # COTIZACIONES
    # --------------------------------------------------------

    cotizaciones = Cotizacion.objects.filter(
        idCliente=cliente
    ).order_by(
        '-fechaCreacion'
    )

    # --------------------------------------------------------
    # CONTEXTO
    # --------------------------------------------------------

    contexto = {
        'cliente': cliente,
        'usuario': usuario,
        'ordenes': ordenes,
        'productos': productos,

        'ordenes_activas': ordenes_activas,
        'ordenes_completadas': ordenes_completadas,
        'ordenes_pendientes': ordenes_pendientes,

        'proxima_entrega': proxima_entrega,
        'ordenes_recientes': ordenes_recientes,
        'orden_activa': orden_activa,

        'facturas': facturas,
        'cotizaciones': cotizaciones,
    }

    return render(
        request,
        'clientes/cliente_portal.html',
        contexto
    )


# ============================================================
# EDITAR PERFIL DEL CLIENTE
# ============================================================

@cliente_required
def editar_perfil_cliente(request):

    usuario_id = request.session['usuario_id']

    try:
        cliente = Cliente.objects.get(
            idUsuario=usuario_id
        )
    except Cliente.DoesNotExist:

        messages.error(
            request,
            'Tu usuario no tiene un perfil de cliente asociado.'
        )

        return redirect('login')

    if request.method == 'POST':

        try:

            nombre = request.POST.get(
                'nombre',
                ''
            ).strip()

            empresa = request.POST.get(
                'empresa',
                ''
            ).strip()

            telefono = request.POST.get(
                'telefono',
                ''
            ).strip()

            ciudad = request.POST.get(
                'ciudad',
                ''
            ).strip()

            direccion = request.POST.get(
                'direccion',
                ''
            ).strip()

            if not nombre:

                messages.error(
                    request,
                    'El nombre es requerido.'
                )

                return redirect(
                    'editar_perfil_cliente'
                )

            cliente.nombre = nombre
            cliente.empresa = empresa or None
            cliente.telefono = telefono or None
            cliente.ciudad = ciudad or None
            cliente.direccion = direccion or None

            cliente.save()

            messages.success(
                request,
                'Tu perfil ha sido actualizado correctamente.'
            )

            return redirect(
                'cliente_portal'
            )

        except Exception as e:

            messages.error(
                request,
                f'Error al actualizar perfil: {str(e)}'
            )

            return redirect(
                'editar_perfil_cliente'
            )

    return render(
        request,
        'clientes/editar_perfil_cliente.html',
        {
            'cliente': cliente
        }
    )


# ============================================================
# REGISTRAR NUEVA ORDEN
# ============================================================

@cliente_required
def registrar_orden(request):

    # --------------------------------------------------------
    # SOLO ACEPTAMOS POST
    # --------------------------------------------------------

    if request.method != 'POST':

        return redirect(
            'cliente_portal'
        )

    usuario_id = request.session['usuario_id']

    # --------------------------------------------------------
    # BUSCAR CLIENTE
    # --------------------------------------------------------

    try:

        cliente = Cliente.objects.get(
            idUsuario=usuario_id
        )

    except Cliente.DoesNotExist:

        messages.error(
            request,
            'Tu usuario no tiene un perfil de cliente asociado.'
        )

        return redirect('login')

    # --------------------------------------------------------
    # COMPROBAR ORDEN ACTIVA
    # --------------------------------------------------------

    orden_activa = Orden.objects.filter(
        idCliente=cliente,
        estado__in=[
            'Pendiente',
            'Procesando',
            'Enviado'
        ]
    ).first()

    if orden_activa:

        messages.error(
            request,
            f'Ya tienes una orden activa '
            f'(#{orden_activa.idOrden}). '
            f'Espera a que se complete antes '
            f'de registrar otra.'
        )

        return redirect(
            'cliente_portal'
        )

    # --------------------------------------------------------
    # RECIBIR DATOS DEL FORMULARIO
    # --------------------------------------------------------

    producto_id = request.POST.get(
        'producto'
    )

    cantidad = request.POST.get(
        'cantidad'
    )

    prioridad = request.POST.get(
        'prioridad',
        'Normal'
    )

    instrucciones = request.POST.get(
        'instrucciones',
        ''
    ).strip()

    fecha_rango = request.POST.get(
        'fecha_rango',
        ''
    ).strip()

    # --------------------------------------------------------
    # VALIDAR PRODUCTO
    # --------------------------------------------------------

    if not producto_id:

        messages.error(
            request,
            'Debes seleccionar un producto.'
        )

        return redirect(
            'cliente_portal'
        )

    try:

        producto = Producto.objects.get(
            idProducto=producto_id
        )

    except Producto.DoesNotExist:

        messages.error(
            request,
            'El producto seleccionado no existe.'
        )

        return redirect(
            'cliente_portal'
        )

    # --------------------------------------------------------
    # VALIDAR CANTIDAD
    # --------------------------------------------------------

    try:

        cantidad = int(cantidad)

        if cantidad <= 0:
            raise ValueError

    except (ValueError, TypeError):

        messages.error(
            request,
            'La cantidad debe ser un número mayor a 0.'
        )

        return redirect(
            'cliente_portal'
        )

    # --------------------------------------------------------
    # VALIDAR PRIORIDAD
    # --------------------------------------------------------

    prioridades_validas = [
        'Normal',
        'Urgente'
    ]

    if prioridad not in prioridades_validas:

        prioridad = 'Normal'

    # --------------------------------------------------------
    # VALIDAR FECHA (Opcional)
    # --------------------------------------------------------

    if not fecha_rango:
        fecha_rango = "Sin definir"

    # --------------------------------------------------------
    # CREAR ORDEN
    # --------------------------------------------------------

    try:

        orden = Orden.objects.create(

            idCliente=cliente,

            idProducto=producto,

            cantidad=cantidad,

            precioUnitario=producto.precio,

            # Producción/administración define
            # posteriormente esta fecha.
            fechaEntregaEstimada=None,

            instrucciones=(
                instrucciones
                if instrucciones
                else 'Sin instrucciones'
            ),

            prioridad=prioridad,

            estado='Pendiente'
        )

    except Exception as e:

        messages.error(
            request,
            f'Error al crear la orden: {str(e)}'
        )

        return redirect(
            'cliente_portal'
        )

    # --------------------------------------------------------
    # GENERAR FACTURA
    # --------------------------------------------------------

    try:

        _generar_factura_pdf(
            orden
        )

    except Exception as e:

        messages.warning(
            request,
            f'La orden #{orden.idOrden} '
            f'se registró correctamente, '
            f'pero ocurrió un problema al generar '
            f'la factura: {str(e)}'
        )

    # --------------------------------------------------------
    # MENSAJE DE ÉXITO
    # --------------------------------------------------------

    messages.success(
        request,
        f'¡Orden #{orden.idOrden} '
        f'registrada exitosamente!'
    )

    return redirect(
        'cliente_portal'
    )


# ============================================================
# GENERAR COTIZACIÓN
# ============================================================

@cliente_required
def generar_cotizacion(request):

    if request.method != 'POST':

        return JsonResponse(
            {
                'error': 'Método no permitido'
            },
            status=405
        )

    usuario_id = request.session['usuario_id']

    try:

        cliente = Cliente.objects.get(
            idUsuario=usuario_id
        )

    except Cliente.DoesNotExist:

        return JsonResponse(
            {
                'error': 'Cliente no encontrado'
            },
            status=404
        )

    producto_id = request.POST.get(
        'producto'
    )

    cantidad = request.POST.get(
        'cantidad'
    )

    notas = request.POST.get(
        'notas',
        ''
    ).strip()

    if not producto_id or not cantidad:

        return JsonResponse(
            {
                'error':
                    'Selecciona un producto '
                    'y una cantidad.'
            },
            status=400
        )

    try:

        producto = Producto.objects.get(
            idProducto=producto_id
        )

    except Producto.DoesNotExist:

        return JsonResponse(
            {
                'error':
                    'El producto seleccionado '
                    'no existe.'
            },
            status=400
        )

    try:

        cantidad_int = int(
            cantidad
        )

        if cantidad_int <= 0:
            raise ValueError

    except (ValueError, TypeError):

        return JsonResponse(
            {
                'error':
                    'La cantidad debe ser '
                    'un número mayor a 0.'
            },
            status=400
        )

    subtotal = (
        producto.precio
        * cantidad_int
    )

    cotizacion = Cotizacion.objects.create(

        idCliente=cliente,

        idProducto=producto,

        cantidad=cantidad_int,

        precioUnitario=producto.precio,

        subtotalEstimado=subtotal,

        notas=notas or None,

        estado='Pendiente'
    )

    return JsonResponse(
        {
            'ok': True,

            'idCotizacion':
                cotizacion.idCotizacion,

            'mensaje':
                'La solicitud se registró. '
                'Evaluaremos costos según tus '
                'especificaciones.'
        }
    )


# ============================================================
# ORDEN EXITOSA
# ============================================================

@cliente_required
def orden_exitosa(request, idOrden):

    usuario_id = request.session['usuario_id']

    orden = get_object_or_404(
        Orden,
        idOrden=idOrden,
        idCliente__idUsuario=usuario_id
    )

    factura = Factura.objects.filter(
        idOrden=orden
    ).first()

    return render(
        request,
        'clientes/orden_exitosa.html',
        {
            'orden': orden,
            'factura': factura,
        }
    )


# ============================================================
# EDITAR ORDEN
# ============================================================

@cliente_required
def editar_orden(request, idOrden):

    usuario_id = request.session['usuario_id']

    orden = get_object_or_404(
        Orden,
        idOrden=idOrden,
        idCliente__idUsuario=usuario_id
    )

    if orden.estado != 'Pendiente':

        messages.error(
            request,
            'Solo puedes editar órdenes '
            'en estado Pendiente.'
        )

        return redirect(
            'cliente_portal'
        )

    productos = Producto.objects.all()

    if request.method == 'POST':

        producto_id = request.POST.get(
            'producto'
        )

        cantidad = request.POST.get(
            'cantidad'
        )

        prioridad = request.POST.get(
            'prioridad',
            'Normal'
        )

        instrucciones = request.POST.get(
            'instrucciones',
            ''
        ).strip()

        try:

            producto = Producto.objects.get(
                idProducto=producto_id
            )

            cantidad = int(
                cantidad
            )

            if cantidad <= 0:
                raise ValueError

            orden.idProducto = producto
            orden.cantidad = cantidad
            orden.precioUnitario = producto.precio
            orden.prioridad = prioridad
            orden.instrucciones = (
                instrucciones
                or 'Sin instrucciones'
            )

            orden.save()

            messages.success(
                request,
                f'Orden #{orden.idOrden} '
                f'actualizada correctamente.'
            )

            return redirect(
                'cliente_portal'
            )

        except Exception as e:

            messages.error(
                request,
                f'Error al actualizar la orden: {str(e)}'
            )

    return render(
        request,
        'clientes/editar_orden.html',
        {
            'orden': orden,
            'productos': productos,
        }
    )


# ============================================================
# ELIMINAR ORDEN
# ============================================================

@cliente_required
def eliminar_orden(request, idOrden):

    usuario_id = request.session['usuario_id']

    orden = get_object_or_404(
        Orden,
        idOrden=idOrden,
        idCliente__idUsuario=usuario_id
    )

    if orden.estado != 'Pendiente':

        messages.error(
            request,
            'Solo puedes eliminar órdenes '
            'en estado Pendiente.'
        )

        return redirect(
            'cliente_portal'
        )

    if request.method == 'POST':

        orden.delete()

        messages.success(
            request,
            f'Orden #{idOrden} '
            f'eliminada correctamente.'
        )

        return redirect(
            'cliente_portal'
        )

    return redirect(
        'cliente_portal'
    )


# ============================================================
# DESCARGAR FACTURA
# ============================================================

@cliente_required
def descargar_factura(request, idFactura):

    usuario_id = request.session['usuario_id']

    factura = get_object_or_404(
        Factura,
        idFactura=idFactura,
        idCliente__idUsuario=usuario_id
    )

    ruta = os.path.join(
        settings.MEDIA_ROOT,
        factura.rutaPDF
    )

    if not os.path.exists(ruta):

        raise Http404(
            'El archivo de la factura '
            'no fue encontrado.'
        )

    return FileResponse(
        open(ruta, 'rb'),
        as_attachment=True,
        filename=os.path.basename(ruta)
    )


# ============================================================
# ACTUALIZAR ÓRDENES POR AJAX
# ============================================================

@cliente_required
def actualizar_ordenes(request):

    usuario_id = request.session['usuario_id']

    try:

        cliente = Cliente.objects.get(
            idUsuario=usuario_id
        )

    except Cliente.DoesNotExist:

        return JsonResponse(
            {
                'error':
                    'Cliente no encontrado'
            },
            status=404
        )

    ordenes = Orden.objects.filter(
        idCliente=cliente
    ).order_by(
        '-fechaCreacion'
    )

    html = render_to_string(
        'clientes/_tabla_ordenes.html',
        {
            'ordenes': ordenes
        },
        request=request
    )

    return JsonResponse(
        {
            'html': html
        }
    )


# ============================================================
# NOTIFICACIONES JSON
# ============================================================

@cliente_required
def notificaciones_json(request):

    usuario_id = request.session['usuario_id']

    try:

        cliente = Cliente.objects.get(
            idUsuario=usuario_id
        )

    except Cliente.DoesNotExist:

        return JsonResponse(
            {
                'error':
                    'Cliente no encontrado'
            },
            status=404
        )

    todas = (
        Notificacion.objects
        .filter(idCliente=cliente)
        .order_by('-fechaCreacion')
    )

    no_leidas = todas.filter(
        leida=False
    ).count()

    notificaciones = todas[:20]

    data = {
        'no_leidas': no_leidas,

        'notificaciones': [

            {
                'id':
                    n.idNotificacion,

                'tipo':
                    n.tipo,

                'titulo':
                    n.titulo,

                'mensaje':
                    n.mensaje,

                'leida':
                    n.leida,

                'fecha':
                    n.fechaCreacion.strftime(
                        '%d/%m/%Y %H:%M'
                    ),
            }

            for n in notificaciones
        ],
    }

    return JsonResponse(
        data
    )


# ============================================================
# MARCAR NOTIFICACIÓN COMO LEÍDA
# ============================================================

@cliente_required
def marcar_notificacion_leida(
    request,
    idNotificacion
):

    if request.method != 'POST':

        return JsonResponse(
            {
                'error':
                    'Método no permitido'
            },
            status=405
        )

    usuario_id = request.session['usuario_id']

    try:

        cliente = Cliente.objects.get(
            idUsuario=usuario_id
        )

    except Cliente.DoesNotExist:

        return JsonResponse(
            {
                'error':
                    'Cliente no encontrado'
            },
            status=404
        )

    # --------------------------------------------------------
    # MARCAR TODAS
    # --------------------------------------------------------

    if idNotificacion == 0:

        Notificacion.objects.filter(
            idCliente=cliente,
            leida=False
        ).update(
            leida=True
        )

        return JsonResponse(
            {
                'ok': True,
                'accion': 'todas_leidas'
            }
        )

    # --------------------------------------------------------
    # MARCAR UNA
    # --------------------------------------------------------

    try:

        notif = Notificacion.objects.get(
            idNotificacion=idNotificacion,
            idCliente=cliente
        )

        notif.leida = True

        notif.save(
            update_fields=['leida']
        )

        return JsonResponse(
            {
                'ok': True,
                'accion': 'leida',
                'id': idNotificacion
            }
        )

    except Notificacion.DoesNotExist:

        return JsonResponse(
            {
                'error':
                    'Notificación no encontrada'
            },
            status=404
        )