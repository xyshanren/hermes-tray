"""
Gateway 进程管理器

负责检测、启动、停止、重启 Hermes Gateway 进程。
支持 Windows 原生和 WSL2 环境。
"""

import subprocess
import psutil
import logging
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


class GatewayManager:
    """Hermes Gateway 进程管理器"""

    def __init__(self, hermes_bin: Optional[str] = None, use_wsl: Optional[bool] = None):
        """
        初始化 Gateway 管理器

        Args:
            hermes_bin: Hermes CLI 路径，默认 ~/.local/bin/hermes
            use_wsl: 是否使用 WSL2 环境，None 表示自动检测
        """
        self._use_wsl = use_wsl if use_wsl is not None else self._detect_wsl()

        if hermes_bin:
            self.hermes_bin = hermes_bin
        else:
            self.hermes_bin = self._find_hermes_bin()

        self._process: Optional[psutil.Process] = None

    def _detect_wsl(self) -> bool:
        """
        检测是否使用 WSL2 环境

        检测逻辑：
        1. Windows 系统下
        2. 存在 wsl 命令
        3. 默认 Hermes 路径在 WSL 中

        Returns:
            bool: True 如果使用 WSL2
        """
        import platform

        if platform.system() != "Windows":
            return False

        # 检查 wsl 命令是否存在
        try:
            result = subprocess.run(
                ["wsl", "--version"],
                capture_output=True,
                timeout=5
            )
            if result.returncode != 0:
                return False
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False

        # 检查 Hermes 是否在 WSL 中
        try:
            result = subprocess.run(
                ["wsl", "test", "-f", "/root/.local/bin/hermes"],
                capture_output=True,
                timeout=5
            )
            return result.returncode == 0
        except subprocess.TimeoutExpired:
            return False

    def check_hermes_health(self) -> Tuple[bool, str]:
        """
        检查 Hermes CLI 是否健康可用

        Returns:
            Tuple[bool, str]: (是否健康, 状态信息)
        """
        try:
            if self._use_wsl:
                # 在 WSL 中检查
                result = subprocess.run(
                    ["wsl", str(self.hermes_bin), "--version"],
                    capture_output=True,
                    timeout=10
                )
                stdout = result.stdout.decode('utf-8', errors='replace') if result.stdout else ""
                stderr = result.stderr.decode('utf-8', errors='replace') if result.stderr else ""
            else:
                result = subprocess.run(
                    [str(self.hermes_bin), "--version"],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                stdout = result.stdout
                stderr = result.stderr

            if result.returncode == 0:
                return True, (stdout.strip() if stdout else "Hermes 可用")
            else:
                return False, f"Hermes 返回错误: {stderr}"

        except FileNotFoundError:
            return False, f"找不到 Hermes CLI: {self.hermes_bin}"
        except subprocess.TimeoutExpired:
            return False, "Hermes 响应超时"
        except Exception as e:
            return False, f"检查失败: {e}"

    def _find_hermes_bin(self) -> str:
        """
        查找 Hermes CLI 路径

        Returns:
            str: Hermes CLI 路径（Windows 路径或 WSL 路径字符串）
        """
        if self._use_wsl:
            # WSL 环境：返回 WSL 内部路径（Linux 格式）
            return "/root/.local/bin/hermes"

        # Windows 原生环境
        import shutil
        hermes = shutil.which("hermes")
        if hermes:
            return hermes

        # 检查常见路径
        home = Path.home()
        candidates = [
            home / ".local" / "bin" / "hermes",
            home / ".local" / "bin" / "hermes.exe",
            Path("C:/Users") / Path.home().name / ".local/bin/hermes.exe",
            Path("C:/Program Files/hermes/hermes.exe"),
        ]

        for path in candidates:
            if path.exists():
                return str(path)

        # 默认返回 Linux/macOS 路径
        return str(home / ".local" / "bin" / "hermes")

    def is_running(self) -> bool:
        """
        检查 Gateway 是否在运行

        Returns:
            bool: True 如果 Gateway 正在运行
        """
        if self._use_wsl:
            return self._is_running_wsl()
        else:
            return self._is_running_native()

    def _is_running_native(self) -> bool:
        """检查 Windows 原生 Gateway 进程"""
        try:
            for proc in psutil.process_iter(['name', 'cmdline']):
                name = proc.info.get('name', '')
                cmdline = proc.info.get('cmdline') or []

                # 检查进程名或命令行
                if 'hermes' in name.lower():
                    if any('gateway' in str(cmd).lower() for cmd in cmdline):
                        self._process = proc
                        return True

                # 检查命令行参数
                cmdline_str = ' '.join(str(c) for c in cmdline).lower()
                if 'hermes' in cmdline_str and 'gateway' in cmdline_str:
                    self._process = proc
                    return True

        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass

        return False

    def _is_running_wsl(self) -> bool:
        """检查 WSL2 中的 Gateway 进程"""
        try:
            # 使用 pgrep 查找 hermes gateway 进程
            result = subprocess.run(
                ["wsl", "pgrep", "-a", "-f", "hermes"],
                capture_output=True,
                timeout=5
            )
            stdout = result.stdout.decode('utf-8', errors='replace') if result.stdout else ""

            # 检查输出中是否包含 gateway 关键词
            if result.returncode == 0:
                for line in stdout.strip().split('\n'):
                    if 'gateway' in line.lower() and 'hermes' in line.lower():
                        return True
            return False
        except subprocess.TimeoutExpired:
            return False
        except FileNotFoundError:
            return False

    def start(self) -> bool:
        """
        启动 Gateway

        Returns:
            bool: True 如果启动成功或已在运行
        """
        if self.is_running():
            logger.info("Gateway 已在运行")
            return True

        if self._use_wsl:
            return self._start_wsl()
        else:
            return self._start_native()

    def _start_native(self) -> bool:
        """启动 Windows 原生 Gateway"""
        try:
            result = subprocess.run(
                [str(self.hermes_bin), "gateway", "start"],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode == 0:
                logger.info("Gateway 启动成功")
                return True
            else:
                logger.error(f"Gateway 启动失败: {result.stderr}")
                return False

        except subprocess.TimeoutExpired:
            logger.error("Gateway 启动超时")
            return False
        except FileNotFoundError:
            logger.error(f"找不到 Hermes CLI: {self.hermes_bin}")
            return False
        except Exception as e:
            logger.error(f"Gateway 启动异常: {e}")
            return False

    def _start_wsl(self) -> bool:
        """启动 WSL2 中的 Gateway"""
        try:
            # 在 WSL 中启动 Gateway（后台运行）
            result = subprocess.run(
                ["wsl", "bash", "-c", f"nohup {self.hermes_bin} gateway start > /dev/null 2>&1 &"],
                capture_output=True,
                timeout=10
            )

            stderr = result.stderr.decode('utf-8', errors='replace') if result.stderr else ""

            if result.returncode == 0:
                logger.info("Gateway 启动成功 (WSL)")
                # 等待几秒让 Gateway 启动
                import time
                time.sleep(2)
                return self.is_running()
            else:
                logger.error(f"Gateway 启动失败 (WSL): {stderr}")
                return False

        except subprocess.TimeoutExpired:
            logger.error("Gateway 启动超时 (WSL)")
            return False
        except FileNotFoundError:
            logger.error("找不到 WSL 命令")
            return False
        except Exception as e:
            logger.error(f"Gateway 启动异常 (WSL): {e}")
            return False

    def stop(self) -> bool:
        """
        停止 Gateway

        Returns:
            bool: True 如果停止成功
        """
        if self._use_wsl:
            return self._stop_wsl()
        else:
            return self._stop_native()

    def _stop_native(self) -> bool:
        """停止 Windows 原生 Gateway"""
        try:
            result = subprocess.run(
                [str(self.hermes_bin), "gateway", "stop"],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode == 0:
                logger.info("Gateway 已停止")
                self._process = None
                return True
            else:
                logger.error(f"Gateway 停止失败: {result.stderr}")
                return False

        except subprocess.TimeoutExpired:
            logger.error("Gateway 停止超时")
            return False
        except FileNotFoundError:
            logger.error(f"找不到 Hermes CLI: {self.hermes_bin}")
            return False
        except Exception as e:
            logger.error(f"Gateway 停止异常: {e}")
            return False

    def _stop_wsl(self) -> bool:
        """停止 WSL2 中的 Gateway"""
        try:
            # 先尝试优雅停止
            result = subprocess.run(
                ["wsl", str(self.hermes_bin), "gateway", "stop"],
                capture_output=True,
                timeout=30
            )

            stderr = result.stderr.decode('utf-8', errors='replace') if result.stderr else ""

            if result.returncode == 0:
                logger.info("Gateway 已停止 (WSL)")
                return True
            else:
                # 优雅停止失败，强制停止
                logger.warning(f"优雅停止失败，尝试强制停止 (WSL): {stderr}")
                return self._force_stop_wsl()

        except subprocess.TimeoutExpired:
            logger.error("Gateway 停止超时 (WSL)")
            return self._force_stop_wsl()
        except FileNotFoundError:
            logger.error("找不到 WSL 命令")
            return False
        except Exception as e:
            logger.error(f"Gateway 停止异常 (WSL): {e}")
            return False

    def _force_stop_wsl(self) -> bool:
        """强制停止 WSL2 中的 Gateway"""
        try:
            # 先找到 gateway 进程
            result = subprocess.run(
                ["wsl", "pgrep", "-a", "-f", "hermes.*gateway"],
                capture_output=True,
                timeout=5
            )
            stdout = result.stdout.decode('utf-8', errors='replace') if result.stdout else ""

            if result.returncode == 0 and stdout.strip():
                # 提取 PID 并杀死
                for line in stdout.strip().split('\n'):
                    pid = line.split()[0] if line else None
                    if pid and pid.isdigit():
                        subprocess.run(
                            ["wsl", "kill", "-9", pid],
                            capture_output=True,
                            timeout=5
                        )
                logger.info("Gateway 进程已强制终止 (WSL)")
                return True
            return False
        except Exception as e:
            logger.error(f"强制停止失败 (WSL): {e}")
            return False

    def restart(self) -> bool:
        """
        重启 Gateway

        Returns:
            bool: True 如果重启成功
        """
        if not self.stop():
            # 如果停止失败，尝试强制停止
            logger.warning("正常停止失败，尝试强制停止")
            self._force_stop()

        import time
        time.sleep(1)  # 等待进程完全退出

        return self.start()

    def _force_stop(self) -> bool:
        """
        强制停止 Gateway 进程

        Returns:
            bool: True 如果强制停止成功
        """
        if self._use_wsl:
            return self._force_stop_wsl()

        if self._process:
            try:
                self._process.kill()
                self._process = None
                logger.info("Gateway 进程已被强制终止")
                return True
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                return False

        # 如果没有缓存的进程，重新查找并终止
        try:
            for proc in psutil.process_iter(['name', 'cmdline']):
                cmdline = proc.info.get('cmdline') or []
                cmdline_str = ' '.join(str(c) for c in cmdline).lower()
                if 'hermes' in cmdline_str and 'gateway' in cmdline_str:
                    proc.kill()
                    logger.info(f"强制终止进程: PID {proc.pid}")
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass

        return True

    def get_status_text(self) -> str:
        """
        获取 Gateway 状态文本

        Returns:
            str: 状态文本（"运行中" 或 "已停止"）
        """
        return "运行中" if self.is_running() else "已停止"
