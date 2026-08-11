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
        const val ACTION_REFRESH = "com.example.widget.ACTION_REFRESH"
        const val ACTION_PAUSE_TIMER = "com.example.widget.ACTION_PAUSE_TIMER"
        const val ACTION_RESUME_TIMER = "com.example.widget.ACTION_RESUME_TIMER"
        const val ACTION_CANCEL_TIMER = "com.example.widget.ACTION_CANCEL_TIMER"
        const val ACTION_ITEM_CLICK = "com.example.widget.ACTION_ITEM_CLICK"
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.widget_layout)
            val prefs = SyncPreferences(context)

            // Header colors
            views.setInt(R.id.widget_header_icon, "setColorFilter", android.graphics.Color.parseColor("#A882DD"))
            views.setInt(R.id.widget_refresh_button, "setColorFilter", android.graphics.Color.parseColor("#A882DD"))

            // Render active timer card if present
            val activeTaskName = prefs.activeTimerTaskName
            if (activeTaskName.isNotEmpty()) {
                views.setViewVisibility(R.id.widget_timer_container, View.VISIBLE)
                views.setTextViewText(R.id.widget_timer_task_name, activeTaskName)

                val remainingSecs = prefs.activeTimerRemainingSeconds
                val isPaused = prefs.activeTimerIsPaused

                val mins = remainingSecs / 60
                val secs = remainingSecs % 60
                val timeStr = if (isPaused) {
                    String.format("%02d:%02d (Paused)", mins, secs)
                } else {
                    String.format("%02d:%02d", mins, secs)
                }
                views.setTextViewText(R.id.widget_timer_time, timeStr)

                val pauseIcon = if (isPaused) R.drawable.ic_play else R.drawable.ic_pause
                views.setImageViewResource(R.id.widget_timer_pause_btn, pauseIcon)
                views.setInt(R.id.widget_timer_pause_btn, "setColorFilter", android.graphics.Color.parseColor(if (isPaused) "#10B981" else "#E4E4E7"))

                views.setViewVisibility(R.id.widget_timer_controls, View.VISIBLE)

                val pauseIntent = Intent(context, ObsidianTodoWidgetProvider::class.java).apply {
                    action = if (isPaused) ACTION_RESUME_TIMER else ACTION_PAUSE_TIMER
                }
                val pausePendingIntent = PendingIntent.getBroadcast(
                    context,
                    3,
                    pauseIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(R.id.widget_timer_pause_btn, pausePendingIntent)

                val cancelIntent = Intent(context, ObsidianTodoWidgetProvider::class.java).apply {
                    action = ACTION_CANCEL_TIMER
                }
                val cancelPendingIntent = PendingIntent.getBroadcast(
                    context,
                    4,
                    cancelIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(R.id.widget_timer_cancel_btn, cancelPendingIntent)
                views.setInt(R.id.widget_timer_cancel_btn, "setColorFilter", android.graphics.Color.parseColor("#EF4444"))
            } else {
                views.setViewVisibility(R.id.widget_timer_container, View.GONE)
            }

            // Bind RemoteViewsAdapter for ListView
            val serviceIntent = Intent(context, ObsidianWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            views.setRemoteAdapter(R.id.widget_todo_list, serviceIntent)
            views.setEmptyView(R.id.widget_todo_list, R.id.widget_empty_view)

            // ListView Item PendingIntent Template
            val itemClickIntent = Intent(context, ObsidianTodoWidgetProvider::class.java).apply {
                action = ACTION_ITEM_CLICK
            }
            val itemClickPendingIntent = PendingIntent.getBroadcast(
                context,
                0,
                itemClickIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
            views.setPendingIntentTemplate(R.id.widget_todo_list, itemClickPendingIntent)

            // Click to open application
            val launchIntent = Intent(context, com.example.MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val launchPendingIntent = PendingIntent.getActivity(
                context,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_title, launchPendingIntent)

            // Footer Last Sync
            val lastSync = prefs.lastSyncTime
            val formattedTime = if (lastSync > 0) {
                val sdf = SimpleDateFormat("MMM d, HH:mm", Locale.getDefault())
                "Synced: ${sdf.format(Date(lastSync))}"
            } else {
                "Synced: Never"
            }
            views.setTextViewText(R.id.widget_footer, formattedTime)

            // Refresh Intent
            val refreshIntent = Intent(context, ObsidianTodoWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            val refreshPendingIntent = PendingIntent.getBroadcast(
                context,
                1,
                refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_refresh_button, refreshPendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }

    private fun refreshWidget(context: Context) {
        val appWidgetManager = AppWidgetManager.getInstance(context)
        val ids = appWidgetManager.getAppWidgetIds(ComponentName(context, ObsidianTodoWidgetProvider::class.java))
        appWidgetManager.notifyAppWidgetViewDataChanged(ids, R.id.widget_todo_list)
        onUpdate(context, appWidgetManager, ids)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val action = intent.action ?: return

        when (action) {
            ACTION_REFRESH -> {
                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        val repo = ObsidianSyncRepository(context)
                        repo.syncTasks()
                        refreshWidget(context)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    } finally {
                        pendingResult.finish()
                    }
                }
            }
            ACTION_PAUSE_TIMER -> {
                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        val repo = ObsidianSyncRepository(context)
                        repo.pauseTimer()
                        refreshWidget(context)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    } finally {
                        pendingResult.finish()
                    }
                }
            }
            ACTION_RESUME_TIMER -> {
                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        val repo = ObsidianSyncRepository(context)
                        repo.resumeTimer()
                        refreshWidget(context)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    } finally {
                        pendingResult.finish()
                    }
                }
            }
            ACTION_CANCEL_TIMER -> {
                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        val repo = ObsidianSyncRepository(context)
                        repo.cancelTimer()
                        refreshWidget(context)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    } finally {
                        pendingResult.finish()
                    }
                }
            }
            ACTION_ITEM_CLICK -> {
                val actionType = intent.getStringExtra("action_type")
                if (actionType == "TOGGLE") {
                    val taskId = intent.getStringExtra("task_id")
                    val isCompleted = intent.getBooleanExtra("is_completed", false)
                    if (!taskId.isNullOrEmpty()) {
                        val pendingResult = goAsync()
                        CoroutineScope(Dispatchers.IO).launch {
                            try {
                                val db = AppDatabase.getDatabase(context)
                                val task = db.taskDao().getTaskById(taskId)
                                if (task != null) {
                                    val repo = ObsidianSyncRepository(context)
                                    repo.toggleTask(task, isCompleted)
                                }
                                refreshWidget(context)
                            } catch (e: Exception) {
                                e.printStackTrace()
                            } finally {
                                pendingResult.finish()
                            }
                        }
                    }
                } else {
                    val launchIntent = Intent(context, com.example.MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(launchIntent)
                }
            }
            "android.appwidget.action.APPWIDGET_UPDATE" -> {
                refreshWidget(context)
            }
        }
    }
}
