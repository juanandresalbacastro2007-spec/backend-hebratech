import datetime
import os
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from django.template.loader import render_to_string

STATIC_DIR = Path(settings.BASE_DIR) / "static"
FONTS_URI = (STATIC_DIR / "fonts").as_uri()
LOGO_URI = (STATIC_DIR / "img" / "logopdf.jpeg").as_uri()

TEMPLATE_FACTURA = "clientes/factura_pdf.html"
TEMPLATE_COTIZACION = "clientes/cotizacion_pdf.html"
TEMPLATE_INCIDENCIA = "operarios/incidencia_pdf.html"


def generar_pdf_bytes(template, context, request=None):
    try:
        from weasyprint import HTML
    except OSError as e:
        raise RuntimeError(
            "No se pudo cargar WeasyPrint: faltan las librerías GTK/Pango. "
            "Instálalas (ver README) y define WEASYPRINT_DLL_DIRECTORIES."
        ) from e

    context = {
        **context,
        "doc_fecha": datetime.date.today(),
        "fonts_uri": FONTS_URI,
        "logo_uri": LOGO_URI,
    }
    html = render_to_string(template, context, request=request)
    return HTML(string=html, base_url=str(settings.BASE_DIR)).write_pdf()


def render_pdf(request, template, context, filename, descargar=True):
    pdf = generar_pdf_bytes(template, context, request=request)
    resp = HttpResponse(pdf, content_type="application/pdf")
    disp = "attachment" if descargar else "inline"
    resp["Content-Disposition"] = f'{disp}; filename="{filename}"'
    return resp


def guardar_pdf(template, context, ruta):
    pdf = generar_pdf_bytes(template, context)
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, "wb") as f:
        f.write(pdf)


def guardar_factura_pdf(factura, ruta):
    contexto = {
        "orden": factura.idOrden,
        "subtotal": factura.total,
        "factura": factura,
    }
    guardar_pdf(TEMPLATE_FACTURA, contexto, ruta)