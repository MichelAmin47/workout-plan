// Shrinks a plate photo before it is sent to coach-chat (2026-11-17).
//
// ~1.15 megapixels (≈1240×930 at 4:3) is the target: below the Claude API's
// own 1568px long-edge downscale, so nothing is thrown away twice, and about
// 1,500 image tokens. JPEG at 0.8 lands around 150-350 KB. Drawing through a
// canvas also drops every EXIF field (GPS included). Decoding goes through an
// <img>, which applies the EXIF orientation, so a portrait photo stays
// upright. Nothing is stored: the result lives in Coach.jsx state until the
// message is sent.

export const FOTO_MAX_PIXELS = 1_150_000
const JPEG_KWALITEIT = 0.8

// Pure — tested in fotoMarker.test.js.
export function doelAfmetingen(width, height, maxPixels = FOTO_MAX_PIXELS) {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)))
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}

function laadAfbeelding(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('foto kon niet worden geopend'))
    img.src = url
  })
}

function blobNaarBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('foto kon niet worden gelezen'))
    reader.readAsDataURL(blob)
  })
}

// Throws on anything the WebView can't decode (e.g. HEIC) — the caller shows
// an inline message and sends nothing.
export async function verkleinFoto(file) {
  const bronUrl = URL.createObjectURL(file)
  try {
    const img = await laadAfbeelding(bronUrl)
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('lege foto')
    const { width, height } = doelAfmetingen(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    // A transparent PNG would otherwise turn black in JPEG.
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('foto kon niet worden omgezet'))), 'image/jpeg', JPEG_KWALITEIT),
    )
    const data = await blobNaarBase64(blob)
    if (!data) throw new Error('lege foto')
    return { mediaType: 'image/jpeg', data, previewUrl: URL.createObjectURL(blob), width, height, bytes: blob.size }
  } finally {
    URL.revokeObjectURL(bronUrl)
  }
}
