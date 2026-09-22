#!/usr/bin/env python3
"""
VAELITH — Motor de detecção automática de mudanças entre duas revisões (História 2.1/2.3).

Recebe duas imagens (já rasterizadas — PDF é convertido para PNG antes de chamar este script)
e devolve, em JSON no stdout, as regiões onde há diferença visual relevante entre elas.

Isto NÃO interpreta o que mudou (isso é IA no V1: "confiança", nunca decisão automática) — só
aponta candidatos para o engenheiro confirmar ou rejeitar (regra de produto: IA nunca altera
informação técnica sem confirmação humana).
"""
import sys
import json
import cv2
import numpy as np


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"erro": "uso: diffEngine.py <imagemA> <imagemB>"}))
        sys.exit(1)

    path_a, path_b = sys.argv[1], sys.argv[2]
    a = cv2.imread(path_a, cv2.IMREAD_GRAYSCALE)
    b = cv2.imread(path_b, cv2.IMREAD_GRAYSCALE)
    if a is None or b is None:
        print(json.dumps({"erro": "Não foi possível ler uma das imagens"}))
        sys.exit(1)

    if a.shape != b.shape:
        b = cv2.resize(b, (a.shape[1], a.shape[0]))

    # Alinhamento fino (ECC) — cobre pequenas diferenças de translação/rotação entre plots.
    # Quando as revisões vêm do mesmo arquivo CAD (caso comum), o ajuste é quase nulo.
    warp_matrix = np.eye(2, 3, dtype=np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 1e-6)
    scale = 0.25
    cc = None
    b_aligned = b
    try:
        a_small = cv2.resize(a, None, fx=scale, fy=scale)
        b_small = cv2.resize(b, None, fx=scale, fy=scale)
        cc, warp_matrix = cv2.findTransformECC(a_small, b_small, warp_matrix, cv2.MOTION_EUCLIDEAN, criteria)
        warp_full = warp_matrix.copy()
        warp_full[0, 2] /= scale
        warp_full[1, 2] /= scale
        b_aligned = cv2.warpAffine(
            b, warp_full, (a.shape[1], a.shape[0]),
            flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP
        )
    except Exception:
        b_aligned = b

    diff = cv2.absdiff(a, b_aligned)
    _, mask = cv2.threshold(diff, 40, 255, cv2.THRESH_BINARY)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25))
    mask_closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask_closed = cv2.dilate(mask_closed, kernel, iterations=1)

    contours, _ = cv2.findContours(mask_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = a.shape
    min_area = max(300, int(w * h * 0.00002))

    regioes = []
    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)
        area = bw * bh
        if area < min_area:
            continue
        roi = diff[y:y + bh, x:x + bw]
        mean_diff = float(roi.mean())
        # Confiança heurística: quanto maior a diferença média dentro da caixa, mais provável
        # que seja mudança real (e não ruído de antialiasing) — só um sinal para priorizar
        # revisão humana, nunca decide sozinho.
        confianca = round(min(99.0, mean_diff * 2.2), 1)
        regioes.append({
            "xPct": round(x / w * 100, 3),
            "yPct": round(y / h * 100, 3),
            "wPct": round(bw / w * 100, 3),
            "hPct": round(bh / h * 100, 3),
            "areaPx": int(area),
            "confianca": confianca
        })

    regioes.sort(key=lambda r: -r["areaPx"])
    print(json.dumps({
        "larguraPx": int(w),
        "alturaPx": int(h),
        "eccCorrelacao": cc,
        "regioes": regioes
    }))


if __name__ == "__main__":
    main()
