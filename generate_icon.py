"""
生成托盘图标

创建一个简单的 Hermes 图标（蓝色圆形背景 + "H" 字母）
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(size: int = 256) -> Image.Image:
    """
    创建图标

    Args:
        size: 图标尺寸

    Returns:
        Image.Image: 图标图像
    """
    # 创建透明背景
    image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # 绘制渐变背景圆
    # 外圈
    padding = size // 16
    draw.ellipse(
        [padding, padding, size - padding, size - padding],
        fill=(52, 152, 219, 255)  # 蓝色
    )

    # 内圈高光效果
    inner_padding = size // 8
    draw.ellipse(
        [inner_padding, inner_padding, size - inner_padding, size - inner_padding],
        fill=(41, 128, 185, 255)  # 深蓝色
    )

    # 绘制 "H" 字母
    try:
        # 尝试使用系统字体
        font_size = int(size * 0.6)
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        # 使用默认字体
        font = ImageFont.load_default()

    text = "H"
    # 计算文字位置（居中）
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = (size - text_width) // 2
    y = (size - text_height) // 2 - size // 20

    # 绘制白色文字
    draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)

    return image


def main():
    """生成图标文件"""
    assets_dir = os.path.join(os.path.dirname(__file__), "assets")
    os.makedirs(assets_dir, exist_ok=True)

    # 创建多种尺寸的图标
    sizes = [16, 32, 48, 64, 128, 256]
    icons = []

    for size in sizes:
        icon = create_icon(size)
        icons.append(icon)

    # 保存为 ICO 文件
    ico_path = os.path.join(assets_dir, "icon.ico")

    # 使用最大的图标作为基础，其他作为附加尺寸
    icons[0].save(
        ico_path,
        format='ICO',
        sizes=[(i.width, i.height) for i in icons],
        append_images=icons[1:]
    )

    print(f"图标已生成: {ico_path}")

    # 同时保存 PNG 版本（用于调试）
    png_path = os.path.join(assets_dir, "icon.png")
    icons[-1].save(png_path, format='PNG')
    print(f"PNG 版本: {png_path}")


if __name__ == "__main__":
    main()
