"""
Hermes 系统托盘应用

主入口文件，实现系统托盘图标、菜单和交互逻辑。
"""

import pystray
from PIL import Image
import webbrowser
import subprocess
import sys
import os
import logging
import threading
from pathlib import Path
from typing import Optional

from gateway_manager import GatewayManager
from config import HermesConfig

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)


class HermesTray:
    """Hermes 系统托盘应用"""

    def __init__(self):
        """初始化托盘应用"""
        self.config = HermesConfig()
        self.gw = GatewayManager()
        self.icon: Optional[pystray.Icon] = None
        self._running = False
        self._status_update_thread: Optional[threading.Thread] = None

        # 获取资源路径（兼容打包后的路径）
        self.assets_dir = self._get_assets_dir()

    def _get_assets_dir(self) -> Path:
        """
        获取资源目录路径

        Returns:
            Path: 资源目录路径
        """
        # 打包后的路径
        if getattr(sys, 'frozen', False):
            base_path = Path(sys._MEIPASS)
        else:
            # 开发环境
            base_path = Path(__file__).parent

        return base_path / "assets"

    def _load_icon(self) -> Image.Image:
        """
        加载托盘图标

        Returns:
            Image.Image: 图标图像
        """
        icon_path = self.assets_dir / "icon.ico"

        if icon_path.exists():
            return Image.open(icon_path)
        else:
            # 如果图标不存在，创建一个简单的默认图标
            logger.warning(f"图标文件不存在: {icon_path}，使用默认图标")
            return self._create_default_icon()

    def _create_default_icon(self) -> Image.Image:
        """
        创建默认图标（简单的 "H" 字母图标）

        Returns:
            Image.Image: 默认图标
        """
        # 创建 64x64 的图标
        size = 64
        image = Image.new('RGBA', (size, size), (0, 0, 0, 0))

        # 使用 PIL 绘制一个简单的圆形背景 + "H" 字母
        from PIL import ImageDraw, ImageFont

        draw = ImageDraw.Draw(image)

        # 绘制圆形背景（渐变蓝色）
        draw.ellipse([4, 4, size-4, size-4], fill=(52, 152, 219, 255))

        # 绘制 "H" 字母
        try:
            font = ImageFont.truetype("arial.ttf", 36)
        except:
            font = ImageFont.load_default()

        text = "H"
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        x = (size - text_width) // 2
        y = (size - text_height) // 2 - 2
        draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)

        return image

    def _create_menu(self) -> pystray.Menu:
        """
        创建托盘菜单

        Returns:
            pystray.Menu: 菜单对象
        """
        return pystray.Menu(
            # 打开 Hermes
            pystray.MenuItem(
                "打开 Hermes",
                self._open_webui,
                default=True
            ),

            # 分隔线
            pystray.Menu.SEPARATOR,

            # Gateway 状态（动态显示）
            pystray.MenuItem(
                lambda item: f"{'●' if self.gw.is_running() else '○'} Gateway {self.gw.get_status_text()}",
                lambda item: None,
                enabled=False
            ),

            # 重启 Gateway
            pystray.MenuItem(
                "重启 Gateway",
                self._restart_gateway,
                enabled=lambda item: self.gw.is_running()
            ),

            # 停止 Gateway
            pystray.MenuItem(
                "停止 Gateway",
                self._stop_gateway,
                enabled=lambda item: self.gw.is_running()
            ),

            # 启动 Gateway
            pystray.MenuItem(
                "启动 Gateway",
                self._start_gateway,
                enabled=lambda item: not self.gw.is_running()
            ),

            # 分隔线
            pystray.Menu.SEPARATOR,

            # 设置
            pystray.MenuItem(
                "设置",
                self._open_config
            ),

            # 查看日志
            pystray.MenuItem(
                "查看日志",
                self._open_logs
            ),

            # 分隔线
            pystray.Menu.SEPARATOR,

            # 退出
            pystray.MenuItem(
                "退出",
                self._quit
            ),
        )

    def _open_webui(self, icon=None) -> None:
        """打开 Web UI"""
        url = self.config.webui_url
        logger.info(f"打开 Web UI: {url}")
        webbrowser.open(url)

    def _start_gateway(self, icon=None) -> None:
        """启动 Gateway"""
        logger.info("启动 Gateway...")
        if self.gw.start():
            self._update_menu()
        else:
            self._show_notification("启动失败", "Gateway 启动失败，请查看日志")

    def _stop_gateway(self, icon=None) -> None:
        """停止 Gateway"""
        logger.info("停止 Gateway...")
        if self.gw.stop():
            self._update_menu()
        else:
            self._show_notification("停止失败", "Gateway 停止失败，请查看日志")

    def _restart_gateway(self, icon=None) -> None:
        """重启 Gateway"""
        logger.info("重启 Gateway...")
        if self.gw.restart():
            self._show_notification("重启成功", "Gateway 已重启")
            self._update_menu()
        else:
            self._show_notification("重启失败", "Gateway 重启失败，请查看日志")

    def _open_config(self, icon=None) -> None:
        """打开配置文件"""
        logger.info("打开配置文件")

        if not self.config.open_config_file():
            if self.gw._use_wsl:
                self._show_notification("配置文件不存在", "WSL 中未找到 ~/.hermes/config.yaml")
            else:
                self._show_notification("配置文件不存在", f"配置文件不存在: {self.config.config_path}")

    def _open_logs(self, icon=None) -> None:
        """打开日志目录"""
        logger.info("打开日志目录")

        if not self.config.open_log_dir():
            if self.gw._use_wsl:
                self._show_notification("日志目录不存在", "WSL 中未找到 ~/.hermes/logs")
            else:
                self._show_notification("日志目录不存在", f"日志目录不存在: {self.config.log_dir}")

    def _show_notification(self, title: str, message: str) -> None:
        """
        显示系统通知

        Args:
            title: 通知标题
            message: 通知内容
        """
        if self.icon:
            self.icon.notify(message, title)

    def _update_menu(self) -> None:
        """更新菜单状态"""
        if self.icon:
            self.icon.update_menu()

    def _status_update_loop(self) -> None:
        """状态更新循环（后台线程）"""
        import time
        while self._running:
            time.sleep(5)  # 每 5 秒检查一次
            self._update_menu()

    def _quit(self, icon=None) -> None:
        """退出应用"""
        logger.info("退出 Hermes Tray")
        self._running = False

        if self.icon:
            self.icon.stop()

    def run(self) -> None:
        """运行托盘应用"""
        logger.info("启动 Hermes Tray...")

        # 加载图标
        icon_image = self._load_icon()

        # 创建托盘图标
        self.icon = pystray.Icon(
            "hermes",
            icon_image,
            "Hermes",
            menu=self._create_menu()
        )

        # 启动时自动启动 Gateway
        logger.info("自动启动 Gateway...")
        self.gw.start()

        # 启动状态更新线程
        self._running = True
        self._status_update_thread = threading.Thread(
            target=self._status_update_loop,
            daemon=True
        )
        self._status_update_thread.start()

        # 运行托盘
        logger.info("托盘图标已启动")
        self.icon.run()


def main():
    """主入口"""
    try:
        app = HermesTray()
        app.run()
    except Exception as e:
        logger.error(f"应用启动失败: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
