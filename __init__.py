from typing import Any

from plugin.sdk.plugin import (
    NekoPluginBase,
    Ok,
    lifecycle,
    neko_plugin,
)


@neko_plugin
class MiaoMiaoBumpPlugin(NekoPluginBase):
    """喵喵碰碰大作战"""

    def __init__(self, ctx: Any):
        super().__init__(ctx)
        self.logger = ctx.logger

    @lifecycle(id="startup")
    async def on_startup(self, **_):
        self.logger.info("MiaoMiaoBumpPlugin started")
        return Ok({"status": "planning", "playable": False})

    @lifecycle(id="shutdown")
    async def on_shutdown(self, **_):
        self.logger.info("MiaoMiaoBumpPlugin stopped")
        return Ok({"status": "stopped"})
