#!/usr/bin/env python3
"""
VAELITH — Motor de sobreposição multidisciplinar (História 2.2/3.1).

Recebe duas imagens rasterizadas de DUAS DISCIPLINAS DIFERENTES (não duas revisões da
mesma) e aponta onde as duas têm traço desenhado na mesma região — candidato a Hard
Clash (interseção física) ou, no mínimo, a um ponto que merece checagem cruzada entre
disciplinas. Assim como o diffEngine, isto é só um SINAL para o engenheiro revisar —
nada aqui vira Incompatibilidade sem confirmação humana.
"""
import sys
import json
import cv2
import numpy as np


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"erro": "uso: overlapEngine.py <imagemA> <imagemB>"}))
        sys.exit(1)

    path_a, path_b = sys.argv[1], sys.argv[2]
    a = cv2.imread(path_a, cv2.IMREAD_GRAYSCALE)
    b = cv2.imread(path_b, cv2.IMREAD_GRAYSCALE)
    if a is None or b is None:
        print(json.dumps({"erro": "Não foi possível ler uma das imagens"}))
        sys.exit(1)

    if a.shape != b.shape:
        b = cv2.resize(b, (a.shape[1], a.shape[0]))

    # Máscara de "tinta" (traço desenhado) — tudo que não é fundo quase-branco.
    _, ink_a = cv2.threshold(a, 235, 255, cv2.THRESH_BINARY_INV)
    _, ink_b = cv2.threshold(b, 235, 255, cv2.THRESH_BINARY_INV)

    # Ignora a moldura/quadro do desenho (borda da prancha) — como é idêntica em qualquer par
    # de disciplinas do mesmo template, sempre "sobrepõe" e não é um candidato real a
    # interferência. Sem isso, a régua da prancha vira um falso positivo gigante.
    h0, w0 = a.shape
    margin = max(15, int(0.015 * min(h0, w0)))
    for m in (ink_a, ink_b):
        m[:margin, :] = 0
        m[-margin:, :] = 0
        m[:, :margin] = 0
        m[:, -margin:] = 0

    # Engrossa levemente cada traço antes do AND — dois traços vizinhos (não exatamente
    # sobrepostos pixel a pixel) ainda contam como "na mesma região", que é o que importa
    # nesta fase (candidato para revisão humana, não geometria exata).
    kernel_ink = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    ink_a = cv2.dilate(ink_a, kernel_ink)
    ink_b = cv2.dilate(ink_b, kernel_ink)

    overlap = cv2.bitwise_and(ink_a, ink_b)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 21))
    overlap_closed = cv2.morphologyEx(overlap, cv2.MORPH_CLOSE, kernel)
    overlap_closed = cv2.dilate(overlap_closed, kernel, iterations=1)

    contours, _ = cv2.findContours(overlap_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = a.shape
    min_area = max(500, int(w * h * 0.00004))
    max_area = int(w * h * 0.5)  # uma "sobreposição" do tamanho da prancha inteira não é um candidato local — é ruído

    regioes = []
    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)
        area = bw * bh
        if area < min_area or area > max_area:
            continue
        box_overlap = overlap[y:y + bh, x:x + bw]
        densidade = float((box_overlap > 0).sum()) / max(1, bw * bh)
        confianca = round(min(99.0, densidade * 300), 1)
        regioes.append({
            "xPct": round(x / w * 100, 3),
            "yPct": round(y / h * 100, 3),
            "wPct": round(bw / w * 100, 3),
            "hPct": round(bh / h * 100, 3),
            "areaPx": int(area),
            "confianca": confianca
        })

    regioes.sort(key=lambda r: -r["areaPx"])
    print(json.dumps({"larguraPx": int(w), "alturaPx": int(h), "regioes": regioes}))


if __name__ == "__main__":
    main()
