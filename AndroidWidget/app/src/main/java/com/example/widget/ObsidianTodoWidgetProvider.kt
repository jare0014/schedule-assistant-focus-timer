package com.example.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import com.example.MainActivity
import com.example.R
import com.example.data.AppDatabase
import com.example.data.ObsidianSyncRepository
import com.example.data.SyncPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ObsidianTodoWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH      = "com.example.widget.ACTION_REFRESH"
        const val ACTION_PAUSE_TIMER  = "com.example.widget.ACTION_PAUSE_TIMER"
        const val ACTION_RESUME_TIMER = "com.example.widget.ACTION_RESUME_TIMER"
        const val ACTION_CANCEL_TIMER = "com.example.widget.ACTION_CANCEL_TIMER"
        const val ACTION_ITEM_CLICK   = "com.example.widget.ACTION_ITEM_CLICK"
    }

    private fun updateWidgetSync(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            val views = buildViews(context, appWidgetId)
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        val pendingResult = try { goAsync() } catch (e: Exception) { null }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                updateWidgetSync(context, appWidgetManager, appWidgetIds)
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                pendingResult?.finish()
            }
        }
    }

    private fun refreshWidget(context: Context) {
        val appWidgetManager = AppWidgetManager.getInstance(context)
        val ids = appWidgetManager.getAppWidgetIds(
            ComponentName(context, ObsidianTodoWidgetProvider::class.java)
        )
        if (ids.isNotEmpty()) {
            updateWidgetSync(context, appWidgetManager, ids)
        }
    }

    private fun buildViews(context: Context, appWidgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_layout)
        val prefs = SyncPreferences(context)

        // Header tint
        views.setInt(R.id.widget_header_icon, "setColorFilter",
            android.graphics.Color.parseColor("#A882DD"))
        views.setInt(R.id.widget_refresh_button, "setColorFilter",
            android.graphics.Color.parseColor("#A882DD"))

        // Open-app pending intent for title click
        val launchPi = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_title, launchPi)

        // Manual refresh button
        val refreshPi = PendingIntent.getBroadcast(
            context, 1,
            Intent(context, ObsidianTodoWidgetProvider::class.java).apply { action = ACTION_REFRESH },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_refresh_button, refreshPi)

        // Active Timer Card (compact, shown only during running timer)
        val activeTaskName = prefs.activeTimerTaskName
        if (activeTaskName.isNotEmpty()) {
            views.setViewVisibility(R.id.widget_timer_container, View.VISIBLE)
            views.setTextViewText(R.id.widget_timer_task_name, activeTaskName)

            val isPaused = prefs.activeTimerIsPaused
            val isAlarm = prefs.isAlarming
            val targetEnd = prefs.activeTimerTargetEndTime

            // Wall-clock calculation from device clock
            val remainingMs = if (!isPaused && targetEnd > 0L) {
                (targetEnd - System.currentTimeMillis()).coerceAtLeast(0L)
            } else {
                (prefs.activeTimerRemainingSeconds * 1000L).coerceAtLeast(0L)
            }
            val remainingSecs = kotlin.math.ceil(remainingMs / 1000.0).toInt()

            if (isAlarm) {
                views.setViewVisibility(R.id.widget_timer_chronometer, View.GONE)
                views.setViewVisibility(R.id.widget_timer_time, View.VISIBLE)
                views.setTextViewText(R.id.widget_timer_time, "Time's Up!")
                views.setTextColor(R.id.widget_timer_time, android.graphics.Color.parseColor("#EF4444"))
            } else if (isPaused) {
                views.setViewVisibility(R.id.widget_timer_chronometer, View.GONE)
                views.setViewVisibility(R.id.widget_timer_time, View.VISIBLE)
                val timeStr = String.format("%02d:%02d (Paused)", remainingSecs / 60, remainingSecs % 60)
                views.setTextViewText(R.id.widget_timer_time, timeStr)
                views.setTextColor(R.id.widget_timer_time, android.graphics.Color.parseColor("#A882DD"))
            } else {
                val base = android.os.SystemClock.elapsedRealtime() + remainingMs
                views.setViewVisibility(R.id.widget_timer_time, View.GONE)
                views.setViewVisibility(R.id.widget_timer_chronometer, View.VISIBLE)
                views.setTextColor(R.id.widget_timer_chronometer, android.graphics.Color.parseColor("#A882DD"))
                views.setChronometerCountDown(R.id.widget_timer_chronometer, true)
                views.setChronometer(R.id.widget_timer_chronometer, base, null, true)
            }

            views.setImageViewResource(R.id.widget_timer_pause_btn,
                if (isPaused) R.drawable.ic_play else R.drawable.ic_pause)
            views.setInt(R.id.widget_timer_pause_btn, "setColorFilter",
                android.graphics.Color.parseColor(if (isPaused) "#10B981" else "#E4E4E7"))
            views.setViewVisibility(R.id.widget_timer_controls, View.VISIBLE)

            val pausePi = PendingIntent.getBroadcast(
                context, 3,
                Intent(context, ObsidianTodoWidgetProvider::class.java).apply {
                    action = if (isPaused) ACTION_RESUME_TIMER else ACTION_PAUSE_TIMER
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_timer_pause_btn, pausePi)

            views.setInt(R.id.widget_timer_cancel_btn, "setColorFilter",
                android.graphics.Color.parseColor("#EF4444"))
            val cancelPi = PendingIntent.getBroadcast(
                context, 4,
                Intent(context, ObsidianTodoWidgetProvider::class.java).apply { action = ACTION_CANCEL_TIMER },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_timer_cancel_btn, cancelPi)
        } else {
            views.setViewVisibility(R.id.widget_timer_container, View.GONE)
            views.setChronometer(R.id.widget_timer_chronometer, 0L, null, false)
        }

        // Connect scrollable ListView via RemoteViewsService
        val serviceIntent = Intent(context, ObsidianWidgetService::class.java).apply {
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
        }
        views.setRemoteAdapter(R.id.widget_list_view, serviceIntent)
        views.setEmptyView(R.id.widget_list_view, R.id.widget_empty_view)

        // PendingIntent template for item clicks (checkbox toggle or text launch)
        val itemClickPi = PendingIntent.getBroadcast(
            context,
            appWidgetId,
            Intent(context, ObsidianTodoWidgetProvider::class.java).apply {
                action = ACTION_ITEM_CLICK
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        views.setPendingIntentTemplate(R.id.widget_list_view, itemClickPi)

        // Footer
        val lastSync = prefs.lastSyncTime
        views.setTextViewText(R.id.widget_footer,
            if (lastSync > 0)
                "Synced: ${SimpleDateFormat("MMM d, HH:mm", Locale.getDefault()).format(Date(lastSync))}"
            else "Synced: Ready"
        )

        return views
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val action = intent.action ?: return

        when (action) {
            ACTION_ITEM_CLICK -> {
                val actionType = intent.getStringExtra("action_type")
                if (actionType == "TOGGLE") {
                    val taskId = intent.getStringExtra("task_id") ?: return
                    val isCompleted = intent.getBooleanExtra("is_completed", false)
                    val pr = try { goAsync() } catch (e: Exception) { null }
                    CoroutineScope(Dispatchers.IO).launch {
                        try {
                            val db = AppDatabase.getDatabase(context)
                            val task = db.taskDao().getTaskById(taskId)
                            if (task != null) {
                                db.taskDao().updateTaskStatus(taskId, isCompleted)
                                val mgr = AppWidgetManager.getInstance(context)
                                val ids = mgr.getAppWidgetIds(ComponentName(context, ObsidianTodoWidgetProvider::class.java))
                                mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list_view)
                                val repo = ObsidianSyncRepository(context)
                                repo.toggleTask(task, isCompleted)
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        } finally {
                            pr?.finish()
                        }
                    }
                } else if (actionType == "LAUNCH") {
                    val launchIntent = Intent(context, MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(launchIntent)
                }
            }
            ACTION_REFRESH -> {
                val pr = try { goAsync() } catch (e: Exception) { null }
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        ObsidianSyncRepository(context).syncTasks()
                        val mgr = AppWidgetManager.getInstance(context)
                        val ids = mgr.getAppWidgetIds(ComponentName(context, ObsidianTodoWidgetProvider::class.java))
                        mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list_view)
                        refreshWidget(context)
                    } catch (e: Exception) { e.printStackTrace() }
                    finally { pr?.finish() }
                }
            }
            ACTION_PAUSE_TIMER -> {
                val pr = try { goAsync() } catch (e: Exception) { null }
                val prefs = SyncPreferences(context)
                val targetEnd = prefs.activeTimerTargetEndTime
                val remainingMs = if (targetEnd > 0L) (targetEnd - System.currentTimeMillis()).coerceAtLeast(0L) else (prefs.activeTimerRemainingSeconds * 1000L)
                prefs.activeTimerRemainingSeconds = kotlin.math.ceil(remainingMs / 1000.0).toInt()
                prefs.activeTimerIsPaused = true
                prefs.activeTimerTargetEndTime = 0L
                refreshWidget(context)
                CoroutineScope(Dispatchers.IO).launch {
                    try { ObsidianSyncRepository(context).pauseTimer(); refreshWidget(context) }
                    catch (e: Exception) { e.printStackTrace() }
                    finally { pr?.finish() }
                }
            }
            ACTION_RESUME_TIMER -> {
                val pr = try { goAsync() } catch (e: Exception) { null }
                val prefs = SyncPreferences(context)
                prefs.activeTimerIsPaused = false
                prefs.activeTimerTargetEndTime = System.currentTimeMillis() + (prefs.activeTimerRemainingSeconds * 1000L)
                refreshWidget(context)
                CoroutineScope(Dispatchers.IO).launch {
                    try { ObsidianSyncRepository(context).resumeTimer(); refreshWidget(context) }
                    catch (e: Exception) { e.printStackTrace() }
                    finally { pr?.finish() }
                }
            }
            ACTION_CANCEL_TIMER -> {
                val pr = try { goAsync() } catch (e: Exception) { null }
                val prefs = SyncPreferences(context)
                prefs.activeTimerTaskName = ""
                prefs.activeTimerRemainingSeconds = 0
                prefs.activeTimerTotalSeconds = 0
                prefs.activeTimerIsPaused = false
                prefs.activeTimerTargetEndTime = 0L
                prefs.isAlarming = false
                refreshWidget(context)
                CoroutineScope(Dispatchers.IO).launch {
                    try { ObsidianSyncRepository(context).cancelTimer(); refreshWidget(context) }
                    catch (e: Exception) { e.printStackTrace() }
                    finally { pr?.finish() }
                }
            }
        }
    }
}
