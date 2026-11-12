import re
from datetime import datetime

_PATRON = re.compile(r'\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4}')


def _a_fecha(texto):
    for formato in ('%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y'):
        try:
            return datetime.strptime(texto, formato).date()
        except ValueError:
            continue
    return None


def parsear_rango(valor):
    """Devuelve (inicio, fin) a partir del texto del calendario doble."""
    if not valor or valor == 'Sin definir':
        return None, None
    fechas = [_a_fecha(t) for t in _PATRON.findall(valor)]
    fechas = [f for f in fechas if f]
    if not fechas:
        return None, None
    return fechas[0], fechas[-1]