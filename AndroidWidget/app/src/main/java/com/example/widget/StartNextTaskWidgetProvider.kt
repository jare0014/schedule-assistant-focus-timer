package com.example.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.RemoteViews
import android.widget.Toast
import com.example.MainActivity
import com.example.R
import com.example.data.AppDatabase
import com.example.data.ObsidianSyncRepository
import com.example.data.SyncPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class StartNextTaskWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_START_NEXT     = "com.example.widget.ACTION_START_NEXT"
        const val ACTION_TOGGLE_ACTIVE  = "com.example.widget.ACTION_TOGGLE_ACTIVE"
    }

    private fun updateWidgetSync(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        val prefs = SyncPreferences(context)
        val activeName = prefs.activeTimerTaskName
        val isActive = activeName.isNotEmpty()

        val nextTask = if (!isActive) {
            try {
                val db = AppDatabase.getDatabase(context)
                val pending = db.taskDao().getPendingTasks()
                pending.firstOrNull { it.category == "FOCUS BLOCKS" && it.parentLineNumber == null }
                    ?: pending.firstOrNull { it.parentLineNumber == null }
                    ?: pending.firstOrNull()
            } catch (e: Exception) {
                null
            }
        } else null

        for (appWidgetId in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.start_next_task_widget)

            if (isActive) {
                val remainingSecs = prefs.activeTimerRemainingSeconds
                val isPaused = prefs.activeTimerIsPaused
                val timeStr = String.format("%02d:%02d", remainingSecs / 60, remainingSecs % 60)

                views.setTextViewText(R.id.start_next_header, "ACTIVE FOCUS SESSION")
                views.setInt(R.id.start_next_header, "setTextColor", android.graphics.Color.parseColor("#A882DD"))
                views.setTextViewText(R.id.start_next_title, activeName)
                views.setTextViewText(R.id.start_next_subtitle, if (isPaused) "$timeStr (Paused)" else "$timeStr remaining")

                views.setImageViewResource(R.id.start_next_icon, if (isPaused) R.drawable.ic_play else R.drawable.ic_pause)
                views.setInt(R.id.start_next_icon, "setColorFilter", android.graphics.Color.parseColor(if (isPaused) "#10B981" else "#E4E4E7"))

                views.setTextViewText(R.id.start_next_action_btn, if (isPaused) "Resume ▶" else "Pause ⏸")
                views.setInt(R.id.start_next_action_btn, "setTextColor", android.graphics.Color.parseColor(if (isPaused) "#10B981" else "#F59E0B"))

                val togglePi = PendingIntent.getBroadcast(
                    context, appWidgetId + 200,
                    Intent(context, StartNextTaskWidgetProvider::class.java).apply {
                        action = ACTION_TOGGLE_ACTIVE
                    },
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(R.id.start_next_action_btn, togglePi)
                views.setOnClickPendingIntent(R.id.start_next_icon, togglePi)
                views.setOnClickPendingIntent(R.id.start_next_root, togglePi)
            } else {
                val taskTitle = nextTask?.displayTitle?.ifEmpty { nextTask.text } ?: "All tasks completed!"
                val subText = if (nextTask != null) {
                    if (!nextTask.timeRange.isNullOrEmpty()) "${nextTask.timeRange} • Tap to start" else "Ready to launch"
                } else "Great job today!"

                views.setTextViewText(R.id.start_next_header, "NEXT FOCUS BLOCK")
                views.setInt(R.id.start_next_header, "setTextColor", android.graphics.Color.parseColor("#A882DD"))
                views.setTextViewText(R.id.start_next_title, taskTitle)
                views.setTextViewText(R.id.start_next_subtitle, subText)

                views.setImageViewResource(R.id.start_next_icon, R.drawable.ic_play)
                views.setInt(R.id.start_next_icon, "setColorFilter", android.graphics.Color.parseColor("#10B981"))

                views.setTextViewText(R.id.start_next_action_btn, "Start ▶")
                views.setInt(R.id.start_next_action_btn, "setTextColor", android.graphics.Color.parseColor("#10B981"))

                val startPi = PendingIntent.getBroadcast(
                    context, appWidgetId + 100,
                    Intent(context, StartNextTaskWidgetProvider::class.java).apply {
                        action = ACTION_START_NEXT
                    },
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(R.id.start_next_action_btn, startPi)
                views.setOnClickPendingIntent(R.id.start_next_icon, startPi)
                views.setOnClickPendingIntent(R.id.start_next_root, startPi)
            }

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

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val action = intent.action ?: return

        when (action) {
            ACTION_START_NEXT -> {
                val pr = try { goAsync() } catch (e: Exception) { null }
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        val db = AppDatabase.getDatabase(context)
                        val pending = db.taskDao().getPendingTasks()
                        val nextTask = pending.firstOrNull { it.category == "FOCUS BLOCKS" && it.parentLineNumber == null }
                            ?: pending.firstOrNull { it.parentLineNumber == null }
                            ?: pending.firstOrNull()

                        if (nextTask != null) {
                            val taskTitle = nextTask.displayTitle.ifEmpty { nextTask.text }
                            val serviceIntent = Intent(context, TimerService::class.java).apply {
                                this.action = "START_TASK"
                                putExtra("task_name", taskTitle)
                            }
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                context.startForegroundService(serviceIntent)
                            } else {
                                context.startService(serviceIntent)
                            }
                            Handler(Looper.getMainLooper()).post {
                                Toast.makeText(context, "Started Focus: $taskTitle ⏱️", Toast.LENGTH_SHORT).show()
                            }
                            ObsidianSyncRepository(context).triggerWidgetUpdate()
                        } else {
                            Handler(Looper.getMainLooper()).post {
                                Toast.makeText(context, "No pending tasks found for today!", Toast.LENGTH_SHORT).show()
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    } finally {
                        pr?.finish()
                    }
                }
            }
            ACTION_TOGGLE_ACTIVE -> {
                val pr = try { goAsync() } catch (e: Exception) { null }
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        val prefs = SyncPreferences(context)
                        val repo = ObsidianSyncRepository(context)
                        if (prefs.activeTimerIsPaused) {
                            repo.resumeTimer()
                        } else {
                            repo.pauseTimer()
                        }
                        repo.triggerWidgetUpdate()
                    } catch (e: Exception) {
                        e.printStackTrace()
                    } finally {
                        pr?.finish()
                    }
                }
            }
        }
    }
}
