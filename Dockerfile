FROM node:22-slim

# Dependências de sistema: poppler-utils (conversão de PDF em imagem) e
# Python + OpenCV/NumPy (motor de detecção de mudanças e overlay).
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    python3 \
    python3-opencv \
    python3-numpy \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala dependências Node primeiro para aproveitar cache do Docker.
COPY package*.json ./
RUN npm install --omit=dev

# Copia o restante do código.
COPY . .

# Garante que as pastas de dados existam mesmo sem volume montado ainda
# (o volume persistente do Railway vai sobrepor este conteúdo no runtime).
RUN mkdir -p /app/data /app/uploads/render

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "server.js"]
