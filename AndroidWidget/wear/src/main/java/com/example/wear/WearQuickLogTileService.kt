package com.example.wear

import android.content.ComponentName
import androidx.wear.protolayout.ActionBuilders.launchAction
import androidx.wear.protolayout.ColorBuilders
import androidx.wear.protolayout.DimensionBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.Executor

class WearQuickLogTileService : TileService() {

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest
    ): ListenableFuture<TileBuilders.Tile> {
        val rootBox = LayoutElementBuilders.Box.Builder()
            .setWidth(DimensionBuilders.expand())
            .setHeight(DimensionBuilders.expand())
            .addContent(
                LayoutElementBuilders.Column.Builder()
                    .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                    .addContent(
                        LayoutElementBuilders.Text.Builder()
                            .setText("🥑 QUICK LOG")
                            .setFontStyle(
                                LayoutElementBuilders.FontStyle.Builder()
                                    .setSize(DimensionBuilders.sp(10f))
                                    .setWeight(LayoutElementBuilders.FONT_WEIGHT_BOLD)
                                    .setColor(ColorBuilders.argb(0xFFA882DD.toInt()))
                                    .build()
                            )
                            .build()
                    )
                    .addContent(
                        LayoutElementBuilders.Spacer.Builder()
                            .setHeight(DimensionBuilders.dp(6f))
                            .build()
                    )
                    // Row 1: Water & Espresso
                    .addContent(
                        LayoutElementBuilders.Row.Builder()
                            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
                            .addContent(buildChip("💧 Water", "QuickLogWaterActivity"))
                            .addContent(
                                LayoutElementBuilders.Spacer.Builder()
                                    .setWidth(DimensionBuilders.dp(4f))
                                    .build()
                            )
                            .addContent(buildChip("☕ Espresso", "QuickLogEspressoActivity"))
                            .build()
                    )
                    .addContent(
                        LayoutElementBuilders.Spacer.Builder()
                            .setHeight(DimensionBuilders.dp(4f))
                            .build()
                    )
                    // Row 2: Waffles & Shake & Nuts
                    .addContent(
                        LayoutElementBuilders.Row.Builder()
                            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
                            .addContent(buildChip("🧇 Waffles", "QuickLogWafflesActivity"))
                            .addContent(
                                LayoutElementBuilders.Spacer.Builder()
                                    .setWidth(DimensionBuilders.dp(4f))
                                    .build()
                            )
                            .addContent(buildChip("🥤 Shake", "QuickLogShakeActivity"))
                            .addContent(
                                LayoutElementBuilders.Spacer.Builder()
                                    .setWidth(DimensionBuilders.dp(4f))
                                    .build()
                            )
                            .addContent(buildChip("🥜 Nuts", "QuickLogNutsActivity"))
                            .build()
                    )
                    .build()
            )
            .build()

        val layout = LayoutElementBuilders.Layout.Builder()
            .setRoot(rootBox)
            .build()

        val timelineEntry = TimelineBuilders.TimelineEntry.Builder()
            .setLayout(layout)
            .build()

        val timeline = TimelineBuilders.Timeline.Builder()
            .addTimelineEntry(timelineEntry)
            .build()

        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion("1")
            .setTileTimeline(timeline)
            .build()

        return ImmediateFuture(tile)
    }

    private fun buildChip(label: String, activityClass: String): LayoutElementBuilders.LayoutElement {
        return LayoutElementBuilders.Box.Builder()
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setBackground(
                        ModifiersBuilders.Background.Builder()
                            .setColor(ColorBuilders.argb(0xFF27272A.toInt()))
                            .setCorner(
                                ModifiersBuilders.Corner.Builder()
                                    .setRadius(DimensionBuilders.dp(10f))
                                    .build()
                            )
                            .build()
                    )
                    .setPadding(
                        ModifiersBuilders.Padding.Builder()
                            .setStart(DimensionBuilders.dp(6f))
                            .setEnd(DimensionBuilders.dp(6f))
                            .setTop(DimensionBuilders.dp(5f))
                            .setBottom(DimensionBuilders.dp(5f))
                            .build()
                    )
                    .setClickable(
                        ModifiersBuilders.Clickable.Builder()
                            .setId("click_$activityClass")
                            .setOnClick(
                                launchAction(
                                    ComponentName(packageName, "com.example.wear.$activityClass")
                                )
                            )
                            .build()
                    )
                    .build()
            )
            .addContent(
                LayoutElementBuilders.Text.Builder()
                    .setText(label)
                    .setFontStyle(
                        LayoutElementBuilders.FontStyle.Builder()
                            .setSize(DimensionBuilders.sp(10f))
                            .setWeight(LayoutElementBuilders.FONT_WEIGHT_BOLD)
                            .setColor(ColorBuilders.argb(0xFFFFFFFF.toInt()))
                            .build()
                    )
                    .build()
            )
            .build()
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest
    ): ListenableFuture<ResourceBuilders.Resources> {
        val resources = ResourceBuilders.Resources.Builder()
            .setVersion("1")
            .build()
        return ImmediateFuture(resources)
    }

    private class ImmediateFuture<V>(private val value: V) : ListenableFuture<V> {
        override fun cancel(mayInterruptIfRunning: Boolean): Boolean = false
        override fun isCancelled(): Boolean = false
        override fun isDone(): Boolean = true
        override fun get(): V = value
        override fun get(timeout: Long, unit: java.util.concurrent.TimeUnit): V = value
        override fun addListener(listener: Runnable, executor: Executor) {
            executor.execute(listener)
        }
    }
}
