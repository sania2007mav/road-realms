"""Draw the original mark: a keep and a road on sand. No external art."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
SAND = (212, 194, 148)
SAND_DARK = (186, 164, 116)
ROAD = (122, 86, 52)
ROAD_EDGE = (92, 64, 38)
STONE = (232, 214, 180)
STONE_DARK = (168, 140, 104)
ROOF = (120, 48, 36)
FLAG = (196, 64, 48)
INK = (36, 28, 22)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = 'LiberationSans-Bold.ttf' if bold else 'LiberationSans-Regular.ttf'
    return ImageFont.truetype(f'/usr/share/fonts/truetype/liberation/{name}', size)


def keep(draw: ImageDraw.ImageDraw, cx: float, cy: float, scale: float) -> None:
    w = 34 * scale
    h = 46 * scale
    left = cx - w / 2
    top = cy - h * 0.35
    draw.rounded_rectangle((left, top, left + w, top + h), radius=3 * scale, fill=STONE, outline=STONE_DARK, width=max(1, int(2 * scale)))
    roof = [
        (left - 4 * scale, top + 2 * scale),
        (cx, top - 16 * scale),
        (left + w + 4 * scale, top + 2 * scale),
    ]
    draw.polygon(roof, fill=ROOF)
    win = 6 * scale
    for row in range(3):
        for col in range(2):
            x = left + 7 * scale + col * 14 * scale
            y = top + 10 * scale + row * 12 * scale
            draw.rectangle((x, y, x + win, y + win * 1.15), fill=INK)
    pole_x = cx + 2 * scale
    pole_top = top - 28 * scale
    draw.line((pole_x, top - 8 * scale, pole_x, pole_top), fill=INK, width=max(1, int(2 * scale)))
    draw.polygon(
        [(pole_x, pole_top), (pole_x + 16 * scale, pole_top + 5 * scale), (pole_x, pole_top + 10 * scale)],
        fill=FLAG,
    )


def road(draw: ImageDraw.ImageDraw, width: int, y: float, thick: float) -> None:
    draw.rectangle((0, y - thick / 2, width, y + thick / 2), fill=ROAD)
    draw.rectangle((0, y - thick / 2, width, y - thick / 2 + thick * 0.18), fill=ROAD_EDGE)


def icon(size: int, maskable: bool) -> Image.Image:
    image = Image.new('RGB', (size, size), SAND)
    draw = ImageDraw.Draw(image)
    road(draw, size, size * 0.68, size * 0.075)
    keep(draw, size * 0.5, size * 0.40, size / (220 if maskable else 168))
    if not maskable:
        edge = max(2, size // 48)
        draw.rectangle((0, 0, size - 1, size - 1), outline=INK, width=edge)
    return image


def og() -> Image.Image:
    image = Image.new('RGB', (1200, 630), SAND)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1200, 630), fill=SAND)
    road(draw, 1200, 460, 48)
    keep(draw, 250, 250, 3.4)
    title = font(86, bold=True)
    sub = font(32)
    draw.text((460, 180), 'Дорожные края', font=title, fill=INK)
    draw.text((460, 290), 'Стратегия вдоль большого тракта', font=sub, fill=(72, 52, 36))
    return image


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    icon(192, False).save(PUBLIC / 'icon-192.png')
    icon(512, False).save(PUBLIC / 'icon-512.png')
    icon(512, True).save(PUBLIC / 'icon-maskable-512.png')
    icon(180, False).save(PUBLIC / 'apple-touch-icon.png')
    og().save(PUBLIC / 'og.png', optimize=True)
    print('wrote icons and og.png')


if __name__ == '__main__':
    main()
