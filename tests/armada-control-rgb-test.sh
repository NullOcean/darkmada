#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

python3 -B - "$ROOT" <<'PYEOF'
import importlib.machinery
import importlib.util
from pathlib import Path
import sys

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "system_files/usr/lib/armada"))

control_path = root / "system_files/usr/libexec/armada/armada-control"
loader = importlib.machinery.SourceFileLoader("armada_control_service", str(control_path))
spec = importlib.util.spec_from_loader("armada_control_service", loader)
control = importlib.util.module_from_spec(spec)
loader.exec_module(control)

commands = []
rgb_environments = []
supported = False


def check_output(command, **kwargs):
    commands.append(command)
    if command and command[0] == control.RGB_TOOL:
        rgb_environments.append(kwargs.get("env", {}))
    if command[-1] == "get":
        return '{"version":1,"enabled":false,"linkBrightness":false,"brightness":25,"maxBrightness":25,"color":"FFFFFF","saturation":100}'
    return '{"version":1,"enabled":true,"linkBrightness":true,"brightness":40,"maxBrightness":60,"color":"A1B2C3","saturation":50}'


def run(command, **kwargs):
    assert command == [control.RGB_TOOL, "supported"]
    return control.subprocess.CompletedProcess(command, 0 if supported else 1)


control.subprocess.check_output = check_output
control.subprocess.run = run
assert control.action_get_rgb({}) is None
assert commands == []

supported = True
state = control.action_get_rgb({})
assert state["color"] == "FFFFFF"
assert commands.pop() == [control.RGB_TOOL, "get"]

control.device_env = lambda: {"ARMADA_PRIMARY_BACKLIGHT": "panel0"}
state = control.action_set_rgb({
    "enabled": True,
    "linkBrightness": True,
    "color": "a1b2c3",
    "saturation": 50,
    "maxBrightness": 60,
    "brightness": 40,
})
assert state["color"] == "A1B2C3"
assert rgb_environments[-1]["ARMADA_PRIMARY_BACKLIGHT"] == "panel0"
assert commands.pop() == [
    control.RGB_TOOL,
    "set",
    "--enabled",
    "true",
    "--link-brightness",
    "true",
    "--max-brightness",
    "60",
    "--color",
    "a1b2c3",
    "--saturation",
    "50",
    "--brightness",
    "40",
]

# Legacy callers that omit saturation preserve the saved value in armada-rgb.
state = control.action_set_rgb({"enabled": True, "color": "a1b2c3", "brightness": 40})
assert state["color"] == "A1B2C3"
assert commands.pop() == [
    control.RGB_TOOL,
    "set",
    "--enabled",
    "true",
    "--link-brightness",
    "false",
    "--max-brightness",
    "100",
    "--color",
    "a1b2c3",
    "--brightness",
    "40",
]

control.action_set_rgb({"enabled": False})
assert commands.pop() == [control.RGB_TOOL, "off"]

for request in (
    {"enabled": True, "color": "12345", "brightness": 40},
    {"enabled": True, "color": "FFFFFF", "brightness": 101},
    {"enabled": True, "color": "FFFFFF", "saturation": 101, "brightness": 40},
):
    try:
        control.action_set_rgb(request)
    except ValueError:
        pass
    else:
        raise AssertionError("invalid RGB state was accepted")

sys.path.insert(0, str(root / "decky/armada-control/py_modules"))
from armada_control import rgb

rgb.call = lambda action, **payload: None
assert not rgb.rgb_supported()

calls = []
rgb.call = lambda action, **payload: calls.append((action, payload)) or {}
assert rgb.rgb_supported()
assert calls.pop() == ("get_rgb", {})
assert rgb.get_rgb() == {}
assert calls.pop() == ("get_rgb", {})
rgb.set_rgb(True, False, "112233", 75, 100, 50)
assert calls.pop() == (
    "set_rgb",
    {
        "enabled": True,
        "linkBrightness": False,
        "color": "112233",
        "saturation": 75,
        "maxBrightness": 100,
        "brightness": 50,
    },
)

paths = list((root / "system_files/usr/lib/armada/devices").rglob("*"))
paths.append(root / "system_files/usr/libexec/armada/device-env")
for path in paths:
    if path.is_file():
        assert "ARMADA_RGB_" not in path.read_text(), path
PYEOF

grep -Fq 'ConditionPathExists=/etc/armada/rgb.json' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb.service"
grep -Fq 'ExecStart=/usr/libexec/armada/armada-rgb-env apply' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb.service"
grep -Fq 'systemctl enable armada-rgb.service' "$ROOT/build_files/40-vendor-system-files.sh"

grep -Fq 'ConditionPathExists=/etc/armada/rgb.json' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb-brightness-watch.service"
grep -Fq 'Wants=armada-rgb.service' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb-brightness-watch.service"
! grep -Fq 'Requires=armada-rgb.service' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb-brightness-watch.service"
grep -Fq 'ExecStart=/usr/libexec/armada/armada-rgb-env watch' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb-brightness-watch.service"
grep -Fq 'PathExists=/etc/armada/rgb.json' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb-brightness-watch.path"
grep -Fq 'Unit=armada-rgb-brightness-watch.service' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb-brightness-watch.path"
grep -Fq 'systemctl enable armada-rgb-brightness-watch.path' "$ROOT/build_files/40-vendor-system-files.sh"
printf 'Armada Control RGB tests passed\n'
