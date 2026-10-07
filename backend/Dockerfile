# Uma imagem para os três processos do backend (consumidor, regras e API).
# O docker-compose.yml escolhe qual roda em cada serviço pelo command.
FROM python:3.12-slim

WORKDIR /srv
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY contrato ./contrato
COPY backend/app ./app

ENV PYTHONUNBUFFERED=1
CMD ["uvicorn", "app.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
