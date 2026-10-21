# apps/proveedores/views.py

from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from .models import Proveedor
from .forms import ProveedorForm
from django.contrib import messages
from django.db import connection, IntegrityError, transaction
import json
from apps.core.decorators import login_required_rol, login_required_api
from apps.administrador.models import Usuario

# ── Decoradores de protección (gestionado por el administrador) ────
admin_required = login_required_rol(rol_esperado='administrador', session_key='usuario_id')
admin_required_api = login_required_api(rol_esperado='administrador', session_key='usuario_id')


@admin_required
def listar_proveedores(request):
    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])
    proveedores = Proveedor.objects.all().order_by('-fechaRegistro')
    form = ProveedorForm()
    return render(request, 'proveedores/proveedores.html', {
        'usuario': usuario,
        'seccion_activa': 'proveedores',
        'proveedores': proveedores,
        'form': form
    })

@admin_required
def crear_proveedor(request):
    if request.method == 'POST':
        form = ProveedorForm(request.POST)

        try:
            if not form.is_valid():
                errores = '; '.join(
                    f'{error}' for errors in form.errors.values() for error in errors
                )
                messages.error(request, f'⚠️ Error al crear proveedor: {errores}')
                return redirect('admin_proveedores')

            proveedor = form.save(commit=False)

            # ── Validar duplicados por nombre o NIT ──────────────
            nombre_existente = Proveedor.objects.filter(
                nombreEmpresa__iexact=proveedor.nombreEmpresa
            ).exists()
            nit_existente = Proveedor.objects.filter(nit=proveedor.nit).exists()

            if nombre_existente and nit_existente:
                messages.error(
                    request,
                    f'⚠️ Ya existe un proveedor registrado con el nombre "{proveedor.nombreEmpresa}" y el NIT {proveedor.nit}.'
                )
                return redirect('admin_proveedores')
            elif nombre_existente:
                messages.error(
                    request,
                    f'⚠️ Ya existe un proveedor registrado con el nombre "{proveedor.nombreEmpresa}".'
                )
                return redirect('admin_proveedores')
            elif nit_existente:
                messages.error(
                    request,
                    f'⚠️ Ya existe un proveedor registrado con el NIT {proveedor.nit}.'
                )
                return redirect('admin_proveedores')

            # ID del usuario logueado (sesión manual, no auth de Django)
            usuario_id = request.session.get('usuario_id')
            

            proveedor.save()
            messages.success(request, f'✅ Proveedor "{proveedor.nombreEmpresa}" creado con éxito.')
            return redirect('admin_proveedores')

        except Exception as e:
            messages.error(request, f'Error al crear proveedor: {str(e)}')
            return redirect('admin_proveedores')

    return redirect('admin_proveedores')

@admin_required
def editar_proveedor(request, id):
    proveedor = get_object_or_404(Proveedor, idProveedor=id)

    if request.method == 'POST':
        form = ProveedorForm(request.POST, instance=proveedor)

        try:
            if not form.is_valid():
                errores = '; '.join(
                    f'{error}' for errors in form.errors.values() for error in errors
                )
                messages.error(request, f'⚠️ Error al actualizar proveedor: {errores}')
                return redirect('admin_proveedores')

            form.save()
            messages.success(request, f'✏️ {proveedor.nombreEmpresa} actualizado correctamente')
            return redirect('admin_proveedores')

        except Exception as e:
            messages.error(request, f'Error al actualizar proveedor: {str(e)}')
            return redirect('admin_proveedores')

    usuario = Usuario.objects.get(idUsuario=request.session['usuario_id'])
    proveedores = Proveedor.objects.all().order_by('-fechaRegistro')
    return render(request, 'proveedores/proveedores.html', {
        'usuario': usuario,
        'seccion_activa': 'proveedores',
        'form': ProveedorForm(instance=proveedor),
        'proveedores': proveedores
    })


@admin_required
@require_POST
def borrar_proveedor(request, id):
    """Elimina el proveedor de forma definitiva (solo si no tiene entradas de materiales)."""
    proveedor = get_object_or_404(Proveedor, idProveedor=id)
    nombre = proveedor.nombreEmpresa

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT COUNT(*) FROM entrada_materiales WHERE idProveedor = %s", [id]
        )
        entradas = cursor.fetchone()[0]

    if entradas:
        messages.error(
            request,
            f'No se puede eliminar "{nombre}": tiene {entradas} entrada(s) de materiales registradas. '
            'Desactívalo en su lugar.'
        )
        return redirect('admin_proveedores')

    try:
        # DELETE directo, igual que en materiales: la BD decide qué se protege o se anula.
        # materiales.idProveedor queda en NULL (ON DELETE SET NULL).
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("DELETE FROM proveedores WHERE idProveedor = %s", [id])
        messages.success(request, f'🗑️ Proveedor "{nombre}" eliminado definitivamente.')
    except IntegrityError:
        messages.error(
            request,
            f'No se pudo eliminar "{nombre}" porque tiene registros relacionados. Desactívalo en su lugar.'
        )

    return redirect('admin_proveedores')


@admin_required_api
@require_POST
def cambiar_estado_proveedor(request, id):
    try:
        proveedor = Proveedor.objects.get(idProveedor=id)
        data = json.loads(request.body)

        estado_input = data.get('estado', 'activo').lower()
        proveedor.estado = estado_input
        proveedor.save()

        return JsonResponse({'success': True, 'estado': proveedor.estado})
    except Proveedor.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Proveedor no encontrado'}, status=404)
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=400)