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

data class ActionableTask(
    val title: String,
    val subtitle: String,
    val header: String = "NEXT TASK",
    val durationMinutes: Int = 20
)

class StartNextTaskWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_START_NEXT     = "com.example.widget.ACTION_START_NEXT"
        const val ACTION_TOGGLE_ACTIVE  = "com.example.widget.ACTION_TOGGLE_ACTIVE"

        fun getNextActionableTask(context: Context): ActionableTask? {
            val prefs = SyncPreferences(context)
            val habitsJson = prefs.todayHabitsJson
            if (habitsJson.isNotEmpty() && habitsJson != "{}") {
                try {
                    val habitsObj = org.json.JSONObject(habitsJson)
                    val currentHour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
                    val sectionOrder = when {
                        currentHour < 12 -> listOf("morning", "work", "house", "midday", "evening")
                        currentHour < 17 -> listOf("work", "house", "midday", "morning", "evening")
                        else -> listOf("evening", "house", "work", "midday", "morning")
                    }

                    for (sec in sectionOrder) {
                        val arr = habitsObj.optJSONArray(sec) ?: continue
                        for (i in 0 until arr.length()) {
                            val item = arr.getJSONObject(i)
                            val name = item.optString("name", "")
                            if (name.isEmpty()) continue
                            val isCompleted = item.optBoolean("completed", false)
                            if (!isCompleted) {
                                val cleanName = name.lowercase()
                                val duration = when {
                                    cleanName.contains("wake") || cleanName.contains("waffle") || cleanName.contains("esther") -> 25
                                    cleanName.contains("hygiene") || cleanName.contains("shower") -> 15
                                    cleanName.contains("exercise") || cleanName.contains("phase") -> 10
                                    else -> 20
                                }
                                val secTitle = sec.replaceFirstChar { if (it.isLowerCase()) it.titlecase(java.util.Locale.getDefault()) else it.toString() }
                                return ActionableTask(
                                    title = name,
                                    subtitle = "$secTitle Routine • Tap to start",
                                    header = "$secTitle ROUTINE",
                                    durationMinutes = duration
                                )
                            }
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }

            try {
                val db = AppDatabase.getDatabase(context)
                val pending = db.taskDao().getPendingTasks()

                // Daily note backlog tasks (untimed, non-focus blocks)
                val backlogTask = pending.firstOrNull { it.category != "FOCUS BLOCKS" && it.parentLineNumber == null }
                if (backlogTask != null) {
                    val title = backlogTask.displayTitle.ifEmpty { backlogTask.text }
                    return ActionableTask(
                        title = title,
                        subtitle = "Daily Backlog • Tap to start",
                        header = "NEXT TASK",
                        durationMinutes = 20
                    )
                }

                // Fallback to focus block only if nothing else pending
                val block = pending.firstOrNull { it.parentLineNumber == null } ?: pending.firstOrNull()
                if (block != null) {
                    val title = block.displayTitle.ifEmpty { block.text }
                    return ActionableTask(
                        title = title,
                        subtitle = if (!block.timeRange.isNullOrEmpty()) "${block.timeRange} • Focus Block" else "Focus Block",
                        header = "FOCUS BLOCK",
                        durationMinutes = 25
                    )
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
            return null
        }
    }

    private fun updateWidgetSync(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        val prefs = SyncPreferences(context)
        val activeName = prefs.activeTimerTaskName
        val isActive = activeName.isNotEmpty()

        val nextTask = if (!isActive) getNextActionableTask(context) else null

        for (appWidgetId in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.start_next_task_widget)

            if (isActive) {
                val isPaused = prefs.activeTimerIsPaused
                val isAlarm = prefs.isAlarming
                val targetEnd = prefs.activeTimerTargetEndTime

                val remainingMs = if (!isPaused && targetEnd > 0L) {
                    (targetEnd - System.currentTimeMillis()).coerceAtLeast(0L)
                } else {
                    (prefs.activeTimerRemainingSeconds * 1000L).coerceAtLeast(0L)
                }
                val remainingSecs = kotlin.math.ceil(remainingMs / 1000.0).toInt()
                val timeStr = String.format("%02d:%02d", remainingSecs / 60, remainingSecs % 60)

                views.setTextViewText(R.id.start_next_header, if (isAlarm) "TIME'S UP!" else "ACTIVE FOCUS SESSION")
                views.setInt(R.id.start_next_header, "setTextColor", android.graphics.Color.parseColor(if (isAlarm) "#EF4444" else "#A882DD"))
                views.setTextViewText(R.id.start_next_title, activeName)

                if (isAlarm) {
                    views.setViewVisibility(R.id.start_next_chronometer, android.view.View.GONE)
                    views.setViewVisibility(R.id.start_next_subtitle, android.view.View.VISIBLE)
                    views.setTextViewText(R.id.start_next_subtitle, "Session complete! Tap to dismiss")
                } else if (isPaused) {
                    views.setViewVisibility(R.id.start_next_chronometer, android.view.View.GONE)
                    views.setViewVisibility(R.id.start_next_subtitle, android.view.View.VISIBLE)
                    views.setTextViewText(R.id.start_next_subtitle, "$timeStr (Paused)")
                } else {
                    val base = android.os.SystemClock.elapsedRealtime() + remainingMs
                    views.setViewVisibility(R.id.start_next_subtitle, android.view.View.GONE)
                    views.setViewVisibility(R.id.start_next_chronometer, android.view.View.VISIBLE)
                    views.setChronometerCountDown(R.id.start_next_chronometer, true)
                    views.setChronometer(R.id.start_next_chronometer, base, "%s remaining", true)
                }

                // Render checklist subtasks if available
                val itemsJson = prefs.activeTimerItems
                if (itemsJson.isNotEmpty()) {
                    try {
                        val arr = org.json.JSONArray(itemsJson)
                        val itemsList = mutableListOf<String>()
                        for (i in 0 until arr.length()) {
                            itemsList.add(arr.getString(i))
                        }
                        if (itemsList.isNotEmpty()) {
                            val formatted = itemsList.take(4).joinToString("  •  ", prefix = "• ")
                            views.setTextViewText(R.id.start_next_checklist, formatted)
                            views.setViewVisibility(R.id.start_next_checklist, android.view.View.VISIBLE)
                        } else {
                            views.setViewVisibility(R.id.start_next_checklist, android.view.View.GONE)
                        }
                    } catch (_: Exception) {
                        views.setViewVisibility(R.id.start_next_checklist, android.view.View.GONE)
                    }
                } else {
                    views.setViewVisibility(R.id.start_next_checklist, android.view.View.GONE)
                }

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
                views.setViewVisibility(R.id.start_next_chronometer, android.view.View.GONE)
                views.setViewVisibility(R.id.start_next_checklist, android.view.View.GONE)
                views.setViewVisibility(R.id.start_next_subtitle, android.view.View.VISIBLE)
                views.setChronometer(R.id.start_next_chronometer, 0L, null, false)

                val taskTitle = nextTask?.title ?: "All tasks completed!"
                val subText = nextTask?.subtitle ?: "Great job today!"
                val headerText = nextTask?.header ?: "NEXT TASK"

                views.setTextViewText(R.id.start_next_header, headerText)
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
                        val nextTask = getNextActionableTask(context)

                        if (nextTask != null) {
                            val taskTitle = nextTask.title
                            val serviceIntent = Intent(context, TimerService::class.java).apply {
                                this.action = "START_TASK"
                                putExtra("task_name", taskTitle)
                                putExtra("duration", nextTask.durationMinutes)
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
                val prefs = SyncPreferences(context)
                if (prefs.activeTimerIsPaused) {
                    prefs.activeTimerIsPaused = false
                    prefs.activeTimerTargetEndTime = System.currentTimeMillis() + (prefs.activeTimerRemainingSeconds * 1000L)
                } else {
                    val targetEnd = prefs.activeTimerTargetEndTime
                    val remainingMs = if (targetEnd > 0L) (targetEnd - System.currentTimeMillis()).coerceAtLeast(0L) else (prefs.activeTimerRemainingSeconds * 1000L)
                    prefs.activeTimerRemainingSeconds = kotlin.math.ceil(remainingMs / 1000.0).toInt()
                    prefs.activeTimerIsPaused = true
                    prefs.activeTimerTargetEndTime = 0L
                }
                val mgr = AppWidgetManager.getInstance(context)
                val ids = mgr.getAppWidgetIds(ComponentName(context, StartNextTaskWidgetProvider::class.java))
                updateWidgetSync(context, mgr, ids)

                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        val repo = ObsidianSyncRepository(context)
                        if (prefs.activeTimerIsPaused) {
                            repo.pauseTimer()
                        } else {
                            repo.resumeTimer()
                        }
                        repo.triggerWidgetUpdate(dataChanged = false)
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
