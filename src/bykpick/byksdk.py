"""精简版 byksdk：仅包含 bykpick 需要的网络、CLI、Web、插件功能"""

from __future__ import annotations

import json
import logging
import socket
import tempfile
import time
import urllib.error
import urllib.request
import webbrowser as _webbrowser
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# paths
# ---------------------------------------------------------------------------

ROOT_DIR = Path.home() / ".byk"
STATE_DIR = ROOT_DIR / "state"
PLUGINS_DIR = ROOT_DIR / "plugins"
LOGS_DIR = ROOT_DIR / "logs"
PLUGINS_LOG_FILE = LOGS_DIR / "plugins.log"


def _ensure_dirs() -> None:
    for directory in (ROOT_DIR, STATE_DIR, PLUGINS_DIR, LOGS_DIR):
        directory.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# logging
# ---------------------------------------------------------------------------

def get_logger(name: str | None = None) -> logging.Logger:
    if name is None:
        logger_name = "byk"
        log_file = PLUGINS_LOG_FILE
    else:
        logger_name = f"byk.{name}"
        log_file = PLUGINS_DIR / name / f"{name}.log"

    logger = logging.getLogger(logger_name)
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    log_file.parent.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(log_file, encoding="utf-8")
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)s [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    logger.addHandler(handler)
    logger.propagate = False
    return logger


# ---------------------------------------------------------------------------
# state
# ---------------------------------------------------------------------------

def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", delete=False, dir=path.parent, encoding="utf-8",
    ) as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        tmp = Path(f.name)
    tmp.replace(path)


@dataclass(slots=True)
class StateStore:
    path: Path

    def load(self) -> dict[str, Any]:
        return _read_json(self.path)

    def save(self, data: dict[str, Any]) -> dict[str, Any]:
        _write_json(self.path, data)
        return data

    def get(self, key: str, default: Any = None) -> Any:
        return self.load().get(key, default)

    def set(self, key: str, value: Any) -> dict[str, Any]:
        data = self.load()
        data[key] = value
        return self.save(data)

    def update(self, values: dict[str, Any]) -> dict[str, Any]:
        data = self.load()
        data.update(values)
        return self.save(data)

    def delete(self, key: str) -> dict[str, Any]:
        data = self.load()
        data.pop(key, None)
        return self.save(data)

    def clear(self) -> dict[str, Any]:
        return self.save({})


# ---------------------------------------------------------------------------
# plugin
# ---------------------------------------------------------------------------

@dataclass
class _AppContext:
    logger: logging.Logger = field(default_factory=get_logger)

    def store(self, name: str = "plugins.state") -> StateStore:
        return StateStore(STATE_DIR / f"{name}.json")


@dataclass
class PluginContext:
    name: str
    home: Path
    logger: logging.Logger
    app: _AppContext = field(default_factory=_AppContext)

    def state(self, name: str = "state") -> StateStore:
        return StateStore(self.home / f"{name}.json")


def plugin(name: str) -> PluginContext:
    home = PLUGINS_DIR / name
    return PluginContext(
        name=name,
        home=home,
        logger=get_logger(name),
    )


# ---------------------------------------------------------------------------
# network
# ---------------------------------------------------------------------------

IFACE_RULES = [
    (['vmware', 'vmnet'],         'vmware',     True,  30),
    (['vbox', 'virtualbox'],      'virtualbox', True,  30),
    (['docker', 'wsl'],           'container',  True,  40),
    (['bluetooth'],               'bluetooth',  True,  60),
    (['ethernet', '以太网'],       'ethernet',   False, 10),
    (['wlan', 'wi-fi', '无线'],   'wifi',       False, 10),
    (['loopback'],                'loopback',   True,  100),
]


def _detect_iface_type(iface: str) -> tuple[str, bool, int]:
    lname = iface.lower()
    for keywords, t, virtual, prio in IFACE_RULES:
        if any(k in lname for k in keywords):
            return t, virtual, prio
    return 'unknown', False, 50


def get_private_networks() -> list[dict[str, Any]]:
    import psutil

    results = []
    interfaces = psutil.net_if_addrs()

    for iface, addrs in interfaces.items():
        ips = []
        iface_type, is_virtual, priority = _detect_iface_type(iface)

        for addr in addrs:
            if addr.family != socket.AF_INET:
                continue
            ip = addr.address
            if ip.startswith('127.'):
                continue
            if ip.startswith('169.254.'):
                continue
            if ip.startswith('10.') or ip.startswith('192.168.'):
                ips.append(ip)
            elif ip.startswith('172.'):
                second_octet = int(ip.split('.')[1])
                if 16 <= second_octet <= 31:
                    ips.append(ip)

        if ips:
            results.append({
                "iface": iface,
                "ips": ips,
                "type": iface_type,
                "virtual": is_virtual,
                "priority": priority,
            })

    results.sort(key=lambda x: x['priority'])

    if not results:
        results.append({
            "iface": "localhost",
            "ips": ["127.0.0.1"],
            "type": "loopback",
            "virtual": True,
            "priority": 100,
        })

    return results


def ensure_port_available(port: int, host: str = "0.0.0.0") -> None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind((host, int(port)))
    except OSError as e:
        raise PortBusyError(port, host) from e


class PortBusyError(OSError):
    def __init__(self, port: int, host: str = "0.0.0.0") -> None:
        self.port = port
        self.host = host
        super().__init__(f"Port {port} on {host} is already in use")


# ---------------------------------------------------------------------------
# cli
# ---------------------------------------------------------------------------

def check_port(
    port: int,
    host: str = "0.0.0.0",
    output_prefix: str = " ",
    silent: bool = False,
) -> bool:
    import click

    try:
        ensure_port_available(port=port, host=host)
    except OSError as e:
        if not silent:
            click.echo(
                f"{output_prefix}Error: Port {port} is already in use "
                f"(or you don't have permission). "
                f"{output_prefix}Please choose another port "
                f"(e.g. --port {int(port) + 1})."
            )
            click.echo(f"{output_prefix}Details: {e}\n")
        return False
    return True


def colored_key_value(
    key: str,
    value: Any,
    key_color: str | None = "cyan",
    value_color: str | None = "yellow",
) -> str:
    import click
    return (
        f"{click.style(str(key), fg=key_color)}: "
        f"{click.style(str(value), fg=value_color)}"
    )


def echo_network_urls(
    networks: list[dict[str, Any]],
    port: int,
    include_virtual: bool = False,
) -> None:
    import click

    for host in ("localhost", "127.0.0.1"):
        click.echo(
            colored_key_value(
                " Local", f"http://{host}:{port}",
                key_color=None, value_color="cyan",
            )
        )

    for net in networks:
        if net.get("virtual") and not include_virtual:
            continue
        for ip in net.get("ips", []):
            if ip == "127.0.0.1":
                continue
            iface = net.get("iface", "unknown")
            click.echo(
                colored_key_value(
                    f" [{iface}] Network URL:",
                    f"http://{ip}:{port}",
                    key_color=None,
                    value_color="cyan",
                )
            )


def copy_to_clipboard(
    text: str,
    label: str = "URL",
    output_prefix: str = " ",
    silent: bool = False,
) -> None:
    import click
    import pyperclip

    try:
        pyperclip.copy(text)
        if not silent:
            click.echo(f"{output_prefix}{label} has been copied to clipboard")
    except Exception:
        if not silent:
            click.echo(
                f"{output_prefix}Warning: Could not copy {label} to clipboard"
            )


def wait_for_server_ready(
    port: int,
    host: str = "127.0.0.1",
    timeout: float = 10.0,
) -> bool:
    url = f"http://{host}:{port}/"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=0.5) as resp:
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(0.05)
    return False


def open_browser(url: str) -> None:
    _webbrowser.open(url)


# ---------------------------------------------------------------------------
# web
# ---------------------------------------------------------------------------

# suppress werkzeug request logs
logging.getLogger("werkzeug").setLevel(logging.ERROR)


def create_spa(
    static_dir: str | Path,
    entry_html: str = "index.html",
    page: list[str] | None = None,
    cli_data: Any = None,
):
    from flask import Flask, make_response, send_from_directory

    static_dir = Path(static_dir).resolve()
    assets_dir = static_dir / "assets"

    app = Flask(
        __name__,
        static_folder=str(assets_dir),
        static_url_path="/assets",
    )

    @app.route("/")
    def index():
        response = make_response(
            send_from_directory(str(static_dir), entry_html)
        )
        response.headers["Cache-Control"] = (
            "no-cache, no-store, must-revalidate"
        )
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    if page:
        for url in page:

            def view(
                _entry_html: str = entry_html,
                _static_dir: str = str(static_dir),
            ):
                response = make_response(
                    send_from_directory(_static_dir, _entry_html)
                )
                response.headers["Cache-Control"] = (
                    "no-cache, no-store, must-revalidate"
                )
                response.headers["Pragma"] = "no-cache"
                response.headers["Expires"] = "0"
                return response

            endpoint = f"page_{url.strip('/').replace('/', '_') or 'root'}"
            app.add_url_rule(url, endpoint, view)

    if cli_data is not None:
        app.cli_data = cli_data

    return app