"use client";

import type { ChangeEvent, DragEvent } from "react";
import { useId, useRef, useState } from "react";

const MAX_IMAGE_EDGE = 720;
const MAX_DATA_URL_LENGTH = 360_000;

type PhotoDropzoneProps = {
  name: string;
  defaultValue?: string | null;
  label?: string;
  helpText?: string;
};

export function PhotoDropzone({
  name,
  defaultValue,
  label = "Character / passport photo",
  helpText = "Tap to choose or drag a game-character image here. Do not upload a real person photo."
}: PhotoDropzoneProps) {
  const inputId = useId();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue || "");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acceptFile(file?: File) {
    if (!file) return;
    setError(null);

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file for the roleplay character photo.");
      return;
    }

    setBusy(true);
    try {
      const dataUrl = await compressImage(file);
      setValue(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that image.");
    } finally {
      setBusy(false);
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    void acceptFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void acceptFile(event.dataTransfer.files?.[0]);
  }

  return (
    <div
      className={dragging ? "photo-dropzone dragging" : "photo-dropzone"}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input type="hidden" name={name} value={value} />
      <input ref={pickerRef} id={inputId} className="sr-only" type="file" accept="image/*" onChange={onPick} />
      <button type="button" className="photo-dropzone__target" onClick={() => pickerRef.current?.click()}>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="Selected game character preview" />
        ) : (
          <span>
            <strong>{busy ? "Processing image..." : "Choose character photo"}</strong>
            <small>{label}</small>
          </span>
        )}
      </button>
      <div className="photo-dropzone__meta">
        <div>
          <strong>{label}</strong>
          <small>{helpText}</small>
        </div>
        <div className="photo-dropzone__actions">
          <button type="button" onClick={() => pickerRef.current?.click()} disabled={busy}>
            Choose
          </button>
          {value && (
            <button type="button" onClick={() => setValue("")} disabled={busy}>
              Remove
            </button>
          )}
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

async function compressImage(file: File) {
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(originalDataUrl);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not prepare the image.");
  context.drawImage(image, 0, 0, width, height);

  let quality = 0.82;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length > MAX_DATA_URL_LENGTH && quality > 0.5) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }

  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error("Image is still too large. Try a smaller screenshot or crop.");
  }

  return dataUrl;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image type could not be opened by this browser."));
    image.src = src;
  });
}
