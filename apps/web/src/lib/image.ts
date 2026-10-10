// Copyright (c) 2026 Jugaad s.r.l.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Ridimensiona un'immagine lato client prima dell'upload, così avatar e logo non
 * vengono salvati a risoluzione piena. Riduce solo (mai ingrandisce), rispetta
 * l'orientamento EXIF, e produce un WEBP compresso (con trasparenza). Gli SVG
 * (vettoriali) e i formati non decodificabili passano invariati.
 *
 * @param maxDim lato massimo (px) dell'immagine risultante.
 */
export async function downscaleImage(file: File, maxDim: number): Promise<File> {
  if (file.type === "image/svg+xml") return file;

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(
    () => null,
  );
  if (!bitmap) return file; // formato non decodificabile: lo gestisce (o rifiuta) il server

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  if (scale >= 1) {
    bitmap.close();
    return file; // già entro il limite: nessun ridimensionamento
  }

  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.85),
  );
  if (!blob) return file;

  const name = `${file.name.replace(/\.[^.]+$/, "")}.webp`;
  return new File([blob], name, { type: "image/webp" });
}
