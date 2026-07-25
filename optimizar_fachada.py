# Optimiza la foto de la fachada para la web → public/fachada.jpg
from PIL import Image

im = Image.open("recursos/fachada-original.jpeg")
objetivo_ancho = 800
if im.width > objetivo_ancho:
    alto = round(im.height * objetivo_ancho / im.width)
    im = im.resize((objetivo_ancho, alto), Image.LANCZOS)
im.save("public/fachada.jpg", quality=82, optimize=True)
print("OK public/fachada.jpg", im.size)
