# Genera public/apple-touch-icon.png (180x180) para iPhone/iPad (pantalla de inicio).
from PIL import Image, ImageDraw, ImageFont

T = 180
img = Image.new("RGB", (T, T), "#111827")
d = ImageDraw.Draw(img)

def font(size):
    for nombre in ("georgiab.ttf", "timesbd.ttf", "arialbd.ttf"):
        try:
            return ImageFont.truetype(f"C:/Windows/Fonts/{nombre}", size)
        except OSError:
            continue
    return ImageFont.load_default()

f = font(72)
texto = "CR"
ancho = d.textlength(texto, font=f)
bbox = d.textbbox((0, 0), texto, font=f)
alto = bbox[3] - bbox[1]
d.text(((T - ancho) / 2, (T - alto) / 2 - bbox[1]), texto, font=f, fill="#FFFFFF")

img.save("public/apple-touch-icon.png")
print("OK public/apple-touch-icon.png", img.size)
