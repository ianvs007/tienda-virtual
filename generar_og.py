# Genera public/og.jpg (1200x630) — imagen de vista previa al compartir el enlace.
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
img = Image.new("RGB", (W, H), "#111827")
d = ImageDraw.Draw(img)

# Franja decorativa inferior
d.rectangle([0, H - 24, W, H], fill="#374151")

def font(size, bold=True):
    path = "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()

titulo = "Casa Rick"
sub1 = "Marca & Estilo · Ropa en Cochabamba"
sub2 = "Paga fácil escaneando un código QR"

ft = font(110)
fs1 = font(48, bold=False)
fs2 = font(40, bold=False)

def centrado(texto, f, y, color):
    ancho = d.textlength(texto, font=f)
    d.text(((W - ancho) / 2, y), texto, font=f, fill=color)

centrado(titulo, ft, 170, "#FFFFFF")
centrado(sub1, fs1, 330, "#D1D5DB")
centrado(sub2, fs2, 420, "#9CA3AF")

img.save("public/og.jpg", quality=88)
print("OK public/og.jpg", img.size)
