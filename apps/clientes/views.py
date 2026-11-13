# Views para el portal del cliente...

import os
from datetime import datetime
import re  # Asegúrate de tener este import arriba del archiv

from django.conf import settings
from django.contrib import messages
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import render, redirect, get_object_or_404
from django.template.loader import render_to_string

from .models import (
    Orden, Cliente, Producto, Usuario, Factura, Cotizacion, Notificacion,
)

from apps.core.fechas import parsear_rango
from apps.core.decorators import login_required_rol
from apps.core.pdf import (
    TEMPLATE_FACTURA, TEMPLATE_COTIZACION, guardar_pdf, guardar_factura_pdf, render_pdf,
)

cliente_required = login_required_rol(rol_esperado='cliente', session_key='usuario_id')

ESTADOS_ACTIVOS = ['Pendiente', 'Procesando', 'Enviado']
ESTADOS_HISTORIAL = ['Entregado', 'Cancelado']

def _generar_factura_pdf(orden):
    subtotal = (orden.precioUnitario or 0) * (orden.cantidad or 0)
    numero_factura = f'F-{datetime.now().strftime("%Y%m%d")}-{orden.idOrden:04d}'
    contexto = {
        'orden': orden, 'subtotal': subtotal,
        'factura': {'numeroFactura': numero_factura, 'fechaEmision': datetime.now(), 'estado': 'Pendiente de pago'},
    }
    carpeta = os.path.join(settings.MEDIA_ROOT, 'facturas')
    os.makedirs(carpeta, exist_ok=True)
    nombre_archivo = f'{numero_factura}.pdf'
    ruta_absoluta = os.path.join(carpeta, nombre_archivo)
    guardar_pdf(TEMPLATE_FACTURA, contexto, ruta_absoluta)
    return Factura.objects.create(
        idOrden=orden, idCliente=orden.idCliente, numeroFactura=numero_factura,
        rutaPDF=f'facturas/{nombre_archivo}', total=subtotal, estado='Pendiente de pago'
    )

@cliente_required
def cliente_portal(request):
    usuario_id = request.session['usuario_id']
    try:
        cliente = Cliente.objects.get(idUsuario=usuario_id)
        usuario = Usuario.objects.get(idUsuario=usuario_id)
    except (Cliente.DoesNotExist, Usuario.DoesNotExist):
        messages.error(request, 'Tu usuario no tiene un perfil válido asociado.')
        return redirect('login')

    ordenes = Orden.objects.filter(idCliente=cliente).order_by('-fechaCreacion')
    productos_qs = Producto.objects.all()
    for p in productos_qs: p.precio_js = int(p.precio)
    
    ordenes_activas = ordenes.filter(estado__in=['Procesando', 'Enviado']).count()
    ordenes_completadas = ordenes.filter(estado='Entregado').count()
    ordenes_pendientes = ordenes.filter(estado='Pendiente').count()
    total_historial = ordenes.filter(estado__in=ESTADOS_HISTORIAL).count()
    orden_activa = ordenes.filter(estado__in=ESTADOS_ACTIVOS).first()

    proxima_entrega = (
        ordenes.exclude(estado__in=['Entregado', 'Cancelado'])
        .exclude(fechaEntregaEstimada__isnull=True)
        .order_by('fechaEntregaEstimada').first()
    )
    ordenes_recientes = ordenes[:3]

    facturas_qs = Factura.objects.filter(idCliente=cliente).order_by('-fechaEmision')
    facturas = []
    for factura in facturas_qs:
        if not factura.rutaPDF:
            factura.rutaPDF = f'facturas/{factura.numeroFactura}.pdf'
            factura.save(update_fields=['rutaPDF'])
        ruta_pdf = os.path.join(settings.MEDIA_ROOT, factura.rutaPDF)
        if not os.path.exists(ruta_pdf):
            try:
                guardar_factura_pdf(factura, ruta_pdf)
            except Exception:
                continue
        if os.path.exists(ruta_pdf): facturas.append(factura)

    cotizaciones = Cotizacion.objects.filter(idCliente=cliente).order_by('-fechaCreacion')
    mostrar_bienvenida = not request.session.get('bienvenida_mostrada', False)
    request.session['bienvenida_mostrada'] = True

    contexto = {
        'cliente': cliente, 'usuario': usuario, 'ordenes': ordenes, 'productos': productos_qs,
        'ordenes_activas': ordenes_activas, 'ordenes_completadas': ordenes_completadas,
        'ordenes_pendientes': ordenes_pendientes, 'proxima_entrega': proxima_entrega,
        'ordenes_recientes': ordenes_recientes, 'orden_activa': orden_activa,
        'facturas': facturas, 'cotizaciones': cotizaciones, 'total_historial': total_historial,
        'mostrar_bienvenida': mostrar_bienvenida,
    }
    return render(request, 'clientes/cliente_portal.html', contexto)

@cliente_required
def historial_ordenes(request):
    usuario_id = request.session['usuario_id']
    try:
        cliente = Cliente.objects.get(idUsuario=usuario_id)
        usuario = Usuario.objects.get(idUsuario=usuario_id)
    except (Cliente.DoesNotExist, Usuario.DoesNotExist):
        messages.error(request, 'Tu usuario no tiene un perfil válido asociado.')
        return redirect('login')

    ordenes_historial = Orden.objects.filter(idCliente=cliente, estado__in=ESTADOS_HISTORIAL).order_by('-fechaCreacion')

    contexto = {
        'cliente': cliente, 'usuario': usuario, 'ordenes': ordenes_historial,
        'total_historial': ordenes_historial.count(), 'seccion_activa': 'historial',
    }
    return render(request, 'clientes/historial_ordenes.html', contexto)

@cliente_required
def editar_perfil_cliente(request):
    usuario_id = request.session['usuario_id']
    try: cliente = Cliente.objects.get(idUsuario=usuario_id)
    except Cliente.DoesNotExist:
        messages.error(request, 'Tu usuario no tiene un perfil de cliente asociado.')
        return redirect('login')

    if request.method == 'POST':
        try:
            cliente.telefono = request.POST.get('telefono', '').strip() or None
            cliente.ciudad = request.POST.get('ciudad', '').strip() or None
            cliente.direccion = request.POST.get('direccion', '').strip() or None
            cliente.save()
            messages.success(request, 'Tu perfil ha sido actualizado correctamente.')
            return redirect('cliente_portal')
        except Exception as e:
            messages.error(request, f'Error al actualizar perfil: {str(e)}')
            return redirect('editar_perfil_cliente')

    return render(request, 'clientes/editar_perfil_cliente.html', {'cliente': cliente})

@cliente_required
def registrar_orden(request):
    if request.method != 'POST': return redirect('cliente_portal')
    usuario_id = request.session['usuario_id']
    try: cliente = Cliente.objects.get(idUsuario=usuario_id)
    except Cliente.DoesNotExist: return redirect('login')

    if Orden.objects.filter(idCliente=cliente, estado__in=ESTADOS_ACTIVOS).exists():
        messages.error(request, 'Ya tienes una orden activa.')
        return redirect('cliente_portal')

    producto_id, cantidad = request.POST.get('producto'), request.POST.get('cantidad')
    prioridad, instrucciones = request.POST.get('prioridad', 'Normal'), request.POST.get('instrucciones', '').strip()
    fecha_rango = request.POST.get('fecha_rango', '').strip()

    if not producto_id: return redirect('cliente_portal')

    try:
        producto = Producto.objects.get(idProducto=producto_id)
        cantidad = int(cantidad)
        if cantidad <= 0: raise ValueError
    except (Producto.DoesNotExist, ValueError, TypeError):
        messages.error(request, 'Datos inválidos.')
        return redirect('cliente_portal')

    fecha_inicio, fecha_entrega = parsear_rango(fecha_rango or "Sin definir")

    try:
        orden = Orden.objects.create(
            idCliente=cliente, idProducto=producto, cantidad=cantidad,
            precioUnitario=producto.precio, fechaEstimadaInicio=fecha_inicio,
            fechaEntregaEstimada=fecha_entrega, instrucciones=instrucciones or 'Sin instrucciones',
            prioridad=prioridad if prioridad in ['Normal', 'Urgente'] else 'Normal', estado='Pendiente'
        )
        _generar_factura_pdf(orden)
        messages.success(request, f'¡Orden #{orden.idOrden} registrada!')
    except Exception as e:
        messages.error(request, f'Error: {str(e)}')

    return redirect('cliente_portal')

@cliente_required
def generar_cotizacion(request):
    if request.method != 'POST': return JsonResponse({'error': 'Método no permitido'}, status=405)
    usuario_id = request.session['usuario_id']
    try: cliente = Cliente.objects.get(idUsuario=usuario_id)
    except Cliente.DoesNotExist: return JsonResponse({'error': 'Cliente no encontrado'}, status=404)

    producto_id, cantidad = request.POST.get('producto'), request.POST.get('cantidad')
    if not producto_id or not cantidad: return JsonResponse({'error': 'Faltan datos'}, status=400)

    try:
        producto = Producto.objects.get(idProducto=producto_id)
        cantidad_int = int(cantidad)
        if cantidad_int <= 0: raise ValueError
    except: return JsonResponse({'error': 'Datos inválidos'}, status=400)

    cotizacion = Cotizacion.objects.create(
        idCliente=cliente, idProducto=producto, cantidad=cantidad_int,
        precioUnitario=producto.precio, subtotalEstimado=producto.precio * cantidad_int
    )
    return JsonResponse({'ok': True, 'idCotizacion': cotizacion.idCotizacion, 'mensaje': 'Cotización registrada.'})

@cliente_required
def orden_exitosa(request, idOrden):
    orden = get_object_or_404(Orden, idOrden=idOrden, idCliente__idUsuario=request.session['usuario_id'])
    factura = Factura.objects.filter(idOrden=orden).first()
    return render(request, 'clientes/orden_exitosa.html', {'orden': orden, 'factura': factura})

@cliente_required
def editar_orden(request, idOrden):
    orden = get_object_or_404(Orden, idOrden=idOrden, idCliente__idUsuario=request.session['usuario_id'])
    if orden.estado != 'Pendiente': return redirect('cliente_portal')

    if request.method == 'POST':
        try:
            orden.idProducto = Producto.objects.get(idProducto=request.POST.get('producto'))
            orden.cantidad = int(request.POST.get('cantidad'))
            orden.precioUnitario = orden.idProducto.precio
            orden.prioridad = request.POST.get('prioridad', 'Normal')
            orden.instrucciones = request.POST.get('instrucciones', '').strip() or 'Sin instrucciones'
            fecha_rango = request.POST.get('fecha_rango', '').strip()
            if fecha_rango:
                inicio, fin = parsear_rango(fecha_rango)
                if fin: orden.fechaEstimadaInicio, orden.fechaEntregaEstimada = inicio, fin
            orden.save()
            messages.success(request, 'Orden actualizada.')
            return redirect('cliente_portal')
        except Exception as e:
            messages.error(request, f'Error: {str(e)}')

    return render(request, 'clientes/editar_orden.html', {'orden': orden, 'productos': Producto.objects.all()})

@cliente_required
def eliminar_orden(request, idOrden):
    orden = get_object_or_404(Orden, idOrden=idOrden, idCliente__idUsuario=request.session['usuario_id'])
    if orden.estado == 'Pendiente' and request.method == 'POST':
        orden.delete()
        messages.success(request, 'Orden eliminada.')
    return redirect('cliente_portal')

@cliente_required
def descargar_factura(request, idFactura):
    factura = get_object_or_404(Factura, idFactura=idFactura, idCliente__idUsuario=request.session['usuario_id'])
    if not factura.rutaPDF:
        factura.rutaPDF = f'facturas/{factura.numeroFactura}.pdf'
        factura.save(update_fields=['rutaPDF'])
        
    ruta = os.path.join(settings.MEDIA_ROOT, factura.rutaPDF)
    try:
        guardar_factura_pdf(factura, ruta)
    except Exception:
        if not os.path.exists(ruta):
            messages.error(request, 'El archivo PDF no se encontró y no se pudo regenerar.')
            return redirect('cliente_portal')
            
    return FileResponse(open(ruta, 'rb'), as_attachment=True, filename=os.path.basename(ruta))

@cliente_required
def actualizar_ordenes(request):
    try: cliente = Cliente.objects.get(idUsuario=request.session['usuario_id'])
    except Cliente.DoesNotExist: return JsonResponse({'error': 'No encontrado'}, status=404)
    ordenes = Orden.objects.filter(idCliente=cliente, estado__in=ESTADOS_ACTIVOS).order_by('-fechaCreacion')
    html = render_to_string('clientes/_tabla_ordenes.html', {'ordenes': ordenes}, request=request)
    return JsonResponse({'html': html})


@cliente_required
def notificaciones_json(request):
    try: 
        cliente = Cliente.objects.get(idUsuario=request.session['usuario_id'])
    except Cliente.DoesNotExist: 
        return JsonResponse({'error': 'No encontrado'}, status=404)

    todas = Notificacion.objects.filter(idCliente=cliente).order_by('-fechaCreacion')
    
    lista_notifs = []
    
    for n in todas[:20]:
        url_destino = '/clientes/'
        incluir = True
        
        # Si es una notificación de orden, verificamos que la orden exista
        if n.tipo == 'orden':
            # Buscamos el número de orden en el mensaje (ej: "Tu orden #24 fue...")
            match = re.search(r'#(\d+)', n.mensaje)
            if match:
                orden_id = match.group(1)
                try:
                    orden = Orden.objects.get(idOrden=orden_id, idCliente=cliente)
                    
                    # Si ya está entregada o cancelada, enviamos al historial
                    if orden.estado in ['Entregado', 'Cancelado']:
                        url_destino = '/clientes/historial-ordenes/'
                    else:
                        url_destino = '/clientes/#secMisOrdenes'
                        
                except Orden.DoesNotExist:
                    # Si la orden NO existe, la omitimos y la borramos de la BD
                    incluir = False
                    n.delete()
        
        if incluir:
            lista_notifs.append({
                'id': n.idNotificacion,
                'tipo': n.tipo,
                'titulo': n.titulo,
                'mensaje': n.mensaje,
                'leida': n.leida,
                'fecha': n.fechaCreacion.strftime('%d/%m/%Y %H:%M'),
                'url': url_destino,
            })

    # Contamos cuántas quedaron sin leer después de la limpieza
    no_leidas = sum(1 for n in lista_notifs if not n['leida'])

    return JsonResponse({
        'no_leidas': no_leidas,
        'notificaciones': lista_notifs,
    })

@cliente_required
def marcar_notificacion_leida(request, idNotificacion):
    if request.method != 'POST': return JsonResponse({'error': 'Método no permitido'}, status=405)
    try: cliente = Cliente.objects.get(idUsuario=request.session['usuario_id'])
    except Cliente.DoesNotExist: return JsonResponse({'error': 'No encontrado'}, status=404)

    if idNotificacion == 0:
        Notificacion.objects.filter(idCliente=cliente, leida=False).update(leida=True)
    else:
        Notificacion.objects.filter(idNotificacion=idNotificacion, idCliente=cliente).update(leida=True)
    
    return JsonResponse({'ok': True})

@cliente_required
def descargar_cotizacion(request, idCotizacion):
    cotizacion = get_object_or_404(Cotizacion, idCotizacion=idCotizacion, idCliente__idUsuario=request.session['usuario_id'])
    contexto = {'cotizacion': cotizacion, 'cliente': cotizacion.idCliente, 'producto': cotizacion.idProducto, 'subtotal': cotizacion.subtotalEstimado}
    try:
        return render_pdf(request, TEMPLATE_COTIZACION, contexto, f'cotizacion-{cotizacion.idCotizacion:04d}.pdf', descargar=True)
    except Exception as e:
        messages.error(request, f'Error: {str(e)}')
        return redirect('cliente_portal')

@cliente_required
def eliminar_cotizacion(request, idCotizacion):
    if request.method == 'POST':
        get_object_or_404(Cotizacion, idCotizacion=idCotizacion, idCliente__idUsuario=request.session['usuario_id']).delete()
        messages.success(request, 'Cotización eliminada.')
    return redirect('cliente_portal')