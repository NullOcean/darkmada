from .privileged import call


def get_rgb():
    return call("get_rgb")


def set_rgb(enabled, link_brightness, color, max_brightness, brightness):
    return call(
        "set_rgb",
        enabled=enabled,
        linkBrightness=link_brightness,
        color=color,
        maxBrightness=max_brightness,
        brightness=brightness,
    )
