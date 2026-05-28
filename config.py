"""
Hermes 配置读取

负责读取 Hermes 配置文件，获取 Web UI 端口等信息。
支持 Windows 原生和 WSL2 环境。
"""

import yaml
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


def _detect_wsl() -> bool:
    """检测是否在 WSL2 环境下运行"""
    try:
        result = subprocess.run(
            ["wsl", "--version"],
            capture_output=True,
            timeout=5
        )
        if result.returncode == 0:
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return False


class HermesConfig:
    """Hermes 配置管理（支持 WSL2）"""

    def __init__(self, config_path: Optional[str] = None, use_wsl: Optional[bool] = None):
        """
        初始化配置管理器

        Args:
            config_path: 配置文件路径，默认自动检测
            use_wsl: 是否使用 WSL2 环境，None 表示自动检测
        """
        self._use_wsl = use_wsl if use_wsl is not None else _detect_wsl()

        if config_path:
            self.config_path = Path(config_path)
        elif self._use_wsl:
            # WSL2 环境：配置文件在 Linux 侧
            self.config_path = self._resolve_wsl_path("/root/.hermes/config.yaml")
        else:
            self.config_path = Path.home() / ".hermes" / "config.yaml"

        self._config: dict = {}
        self._load()

    def _resolve_wsl_path(self, linux_path: str) -> Path:
        """
        将 WSL Linux 路径转换为 Windows UNC 路径

        Args:
            linux_path: Linux 路径，如 /root/.hermes/config.yaml

        Returns:
            Path: Windows UNC 路径
        """
        try:
            # 获取默认 WSL 发行版名称（如 Ubuntu-24.04.4）
            result = subprocess.run(
                ["wsl", "bash", "-c", "grep '^NAME=' /etc/os-release | cut -d= -f2 | tr -d '\"'"],
                capture_output=True,
                timeout=5
            )
            distro_name = result.stdout.decode('utf-8', errors='replace').strip() if result.stdout else ""

            # 尝试 wsl -l 获取精确名称
            result2 = subprocess.run(
                ["wsl", "-l", "-v"],
                capture_output=True,
                timeout=5
            )
            output = result2.stdout.decode('utf-16-le', errors='replace') if result2.stdout else ""

            # 解析默认发行版（带 * 标记）
            for line in output.split('\n'):
                line = line.strip()
                if line.startswith('*'):
                    # 提取发行版名称（* 后面的第一个单词到空格之前）
                    name = line.lstrip('*').strip()
                    # 去除 Unicode BOM
                    if name and name[0] == '\ufeff':
                        name = name[1:]
                    name = name.strip()
                    # 只取第一个空白之前的部分（去掉 Running、VERSION 等字段）
                    parts = name.split()
                    if parts:
                        distro_name = parts[0]
                    break

            if distro_name:
                unc_path = Path(rf"\\wsl.localhost\{distro_name}{linux_path}")
                if unc_path.exists():
                    return unc_path

            # 回退：遍历 wsl.localhost 下的发行版
            wsl_base = Path(r"\\wsl.localhost")
            if wsl_base.exists():
                for distro_dir in wsl_base.iterdir():
                    candidate = distro_dir / linux_path.lstrip("/")
                    if candidate.exists():
                        return candidate

        except Exception as e:
            logger.warning(f"WSL 路径解析失败: {e}")

        # 回退：返回 Linux 路径（供 wsl cat 使用）
        return Path(linux_path)

    @property
    def wsl_distro(self) -> str:
        """获取 WSL 默认发行版名称"""
        try:
            result = subprocess.run(
                ["wsl", "-l", "-v"],
                capture_output=True,
                timeout=5
            )
            output = result.stdout.decode('utf-16-le', errors='replace') if result.stdout else ""
            for line in output.split('\n'):
                line = line.strip()
                if line.startswith('*'):
                    name = line.lstrip('*').strip()
                    if name and name[0] == '\ufeff':
                        name = name[1:]
                    parts = name.strip().split()
                    return parts[0] if parts else ""
        except Exception:
            pass
        return ""

    def _load(self) -> None:
        """加载配置文件"""
        if self._use_wsl:
            self._load_wsl()
        else:
            self._load_native()

    def _load_native(self) -> None:
        """从 Windows 路径加载配置"""
        if not self.config_path.exists():
            logger.warning(f"配置文件不存在: {self.config_path}")
            return

        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                self._config = yaml.safe_load(f) or {}
            logger.debug(f"配置加载成功: {self.config_path}")
        except Exception as e:
            logger.error(f"配置加载失败: {e}")
            self._config = {}

    def _load_wsl(self) -> None:
        """从 WSL2 环境加载配置"""
        try:
            # 方案 1：通过 UNC 路径直接读取
            if self.config_path.exists():
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    self._config = yaml.safe_load(f) or {}
                logger.debug(f"配置加载成功 (WSL UNC): {self.config_path}")
                return

            # 方案 2：通过 wsl cat 读取
            linux_path = "/root/.hermes/config.yaml"
            result = subprocess.run(
                ["wsl", "cat", linux_path],
                capture_output=True,
                timeout=10
            )
            if result.returncode == 0:
                content = result.stdout.decode('utf-8', errors='replace')
                self._config = yaml.safe_load(content) or {}
                # 更新路径为实际可访问路径
                self.config_path = Path(f"//wsl.localhost/_wsl_cat")  # 标记来源
                logger.debug(f"配置加载成功 (WSL cat): {linux_path}")
                return

            logger.warning(f"WSL 配置文件不存在: {linux_path}")

        except Exception as e:
            logger.error(f"WSL 配置加载失败: {e}")
            self._config = {}

    def reload(self) -> None:
        """重新加载配置"""
        self._load()

    def get(self, key: str, default: Any = None) -> Any:
        """
        获取配置值（支持点分隔的嵌套键）

        Args:
            key: 配置键，如 "gateway.port"
            default: 默认值

        Returns:
            配置值
        """
        keys = key.split('.')
        value = self._config

        for k in keys:
            if isinstance(value, dict):
                value = value.get(k)
            else:
                return default

            if value is None:
                return default

        return value

    @property
    def webui_port(self) -> int:
        """
        获取 Web UI 端口

        Returns:
            int: 端口号，默认 8642（Hermes API Server 默认端口）
        """
        for key in ('gateway.port', 'webui.port', 'port', 'api_server.port'):
            port = self.get(key)
            if port:
                return int(port)

        # 检查环境变量
        import os
        env_port = os.getenv('API_SERVER_PORT')
        if env_port:
            return int(env_port)

        # Hermes API Server 默认端口
        return 8642

    @property
    def webui_url(self) -> str:
        """
        获取 Web UI 完整 URL

        Returns:
            str: Web UI URL
        """
        return f"http://localhost:{self.webui_port}"

    @property
    def log_dir(self) -> Path:
        """
        获取日志目录

        Returns:
            Path: 日志目录路径
        """
        log_dir = self.get('log_dir')
        if log_dir:
            return Path(log_dir)

        if self._use_wsl:
            linux_dir = "/root/.hermes/logs"
            distro = self.wsl_distro
            if distro:
                unc_path = Path(rf"\\wsl.localhost\{distro}{linux_dir}")
                if unc_path.exists():
                    return unc_path
            # 回退
            for distro_dir in Path(r"\\wsl.localhost").iterdir() if Path(r"\\wsl.localhost").exists() else []:
                candidate = distro_dir / linux_dir.lstrip("/")
                if candidate.exists():
                    return candidate
            return Path(linux_dir)

        return Path.home() / ".hermes" / "logs"

    @property
    def config_dir(self) -> Path:
        """
        获取配置目录

        Returns:
            Path: 配置目录路径
        """
        return self.config_path.parent

    def open_config_file(self) -> bool:
        """
        用系统默认程序打开配置文件

        Returns:
            bool: 是否成功打开
        """
        if self._use_wsl:
            return self._open_wsl_config()
        else:
            return self._open_native_config()

    def _open_native_config(self) -> bool:
        """打开 Windows 原生配置文件"""
        if self.config_path.exists():
            import os
            os.startfile(str(self.config_path))
            return True
        return False

    def _open_wsl_config(self) -> bool:
        """打开 WSL2 中的配置文件"""
        # 方案 1：通过 UNC 路径直接打开
        if self.config_path.exists():
            import os
            os.startfile(str(self.config_path))
            return True

        # 方案 2：复制到临时文件后打开
        try:
            result = subprocess.run(
                ["wsl", "cat", "/root/.hermes/config.yaml"],
                capture_output=True,
                timeout=10
            )
            if result.returncode == 0:
                content = result.stdout
                # 写入临时文件
                tmp_path = Path(tempfile.gettempdir()) / "hermes-config.yaml"
                tmp_path.write_bytes(content)
                import os
                os.startfile(str(tmp_path))
                logger.info(f"配置文件已复制到临时文件打开: {tmp_path}")
                logger.warning("注意：临时文件修改不会同步回 WSL，请手动更新配置")
                return True
        except Exception as e:
            logger.error(f"打开 WSL 配置文件失败: {e}")

        return False

    def open_log_dir(self) -> bool:
        """
        用系统资源管理器打开日志目录

        Returns:
            bool: 是否成功打开
        """
        log_dir = self.log_dir

        if self._use_wsl:
            # 尝试 UNC 路径
            if log_dir.exists():
                import os
                os.startfile(str(log_dir))
                return True

            # 回退：打开 WSL 根目录
            try:
                for distro_dir in Path("//wsl.localhost").iterdir() if Path("//wsl.localhost").exists() else []:
                    candidate = distro_dir / "root" / ".hermes"
                    if candidate.exists():
                        import os
                        os.startfile(str(candidate))
                        return True
            except Exception:
                pass

            return False
        else:
            if log_dir.exists():
                import os
                os.startfile(str(log_dir))
                return True
            return False
