FROM python:3.12-slim

WORKDIR /srv
COPY simulador/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY contrato ./contrato
COPY simulador/*.py ./

ENV PYTHONUNBUFFERED=1
VOLUME /dados
CMD ["python", "celula.py"]
