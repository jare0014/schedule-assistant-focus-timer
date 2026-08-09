package com.example.wear

import android.content.ComponentName
import android.util.Log
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

class WearTimerTileService : TileService() {

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest
    ): ListenableFuture<TileBuilders.Tile> {
        Log.d("WearTimerTileService", "onTileRequest triggered")

        val prefs = getSharedPreferences("wear_prefs", MODE_PRIVATE)
        val taskName = prefs.getString("taskName", "No Active Task") ?: "No Active Task"
        val remainingSeconds = prefs.getInt("remainingSeconds", 0)
        val isPaused = prefs.getBoolean("isPaused", false)
        val isAlarming = prefs.getBoolean("isAlarming", false)

        val mins = remainingSeconds / 60
        val secs = remainingSeconds % 60
        val timeText = if (taskName == "No Active Task" || taskName == "No task selected") {
            "--:--"
        } else if (isAlarming) {
            "Time's Up!"
        } else {
            String.format("%02d:%02d", mins, secs)
        }

        val displayTaskName = if (taskName == "No task selected") {
            "No Active Task"
        } else {
            taskName
        }

        // Build the layout
        val rootBox = LayoutElementBuilders.Box.Builder()
            .setWidth(DimensionBuilders.expand())
            .setHeight(DimensionBuilders.expand())
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setClickable(
                        ModifiersBuilders.Clickable.Builder()
                            .setId("launch_activity")
                            .setOnClick(
                                launchAction(
                                    ComponentName(
                                        packageName,
                                        "com.example.wear.WearMainActivity"
                                    )
                                )
                            )
                            .build()
                    )
                    .build()
            )
            .addContent(
                LayoutElementBuilders.Column.Builder()
                    .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
                    .addContent(
                        LayoutElementBuilders.Text.Builder()
                            .setText("📅 TIME BLOCK")
                            .setFontStyle(
                                LayoutElementBuilders.FontStyle.Builder()
                                    .setSize(DimensionBuilders.sp(10f))
                                    .setColor(ColorBuilders.argb(0xFFA882DD.toInt()))
                                    .setWeight(LayoutElementBuilders.FONT_WEIGHT_BOLD)
                                    .build()
                            )
                            .build()
                    )
                    .addContent(
                        LayoutElementBuilders.Spacer.Builder()
                            .setHeight(DimensionBuilders.dp(4f))
                            .build()
                    )
                    .addContent(
                        LayoutElementBuilders.Text.Builder()
                            .setText(displayTaskName)
                            .setFontStyle(
                                LayoutElementBuilders.FontStyle.Builder()
                                    .setSize(DimensionBuilders.sp(13f))
                                    .setColor(ColorBuilders.argb(0xFFCCCCCC.toInt()))
                                    .build()
                            )
                            .build()
                    )
                    .addContent(
                        LayoutElementBuilders.Spacer.Builder()
                            .setHeight(DimensionBuilders.dp(6f))
                            .build()
                    )
                    .addContent(
                        LayoutElementBuilders.Text.Builder()
                            .setText(timeText)
                            .setFontStyle(
                                LayoutElementBuilders.FontStyle.Builder()
                                    .setSize(DimensionBuilders.sp(30f))
                                    .setWeight(LayoutElementBuilders.FONT_WEIGHT_BOLD)
                                    .setColor(ColorBuilders.argb(if (isPaused) 0xFF888888.toInt() else 0xFFA882DD.toInt()))
                                    .build()
                            )
                            .build()
                    )
                    .apply {
                        if (isPaused && displayTaskName != "No Active Task") {
                            addContent(
                                LayoutElementBuilders.Spacer.Builder()
                                    .setHeight(DimensionBuilders.dp(4f))
                                    .build()
                            )
                            addContent(
                                LayoutElementBuilders.Text.Builder()
                                    .setText("Paused")
                                    .setFontStyle(
                                        LayoutElementBuilders.FontStyle.Builder()
                                            .setSize(DimensionBuilders.sp(11f))
                                            .setColor(ColorBuilders.argb(0xFF888888.toInt()))
                                            .build()
                                    )
                                    .build()
                            )
                        }
                    }
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

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest
    ): ListenableFuture<ResourceBuilders.Resources> {
        val resources = ResourceBuilders.Resources.Builder()
            .setVersion("1")
            .build()
        return ImmediateFuture(resources)
    }

    // A lightweight implementation of ListenableFuture to avoid external Guava boilerplate issues
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
