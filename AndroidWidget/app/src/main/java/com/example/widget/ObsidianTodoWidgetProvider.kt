package com.example.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import com.example.MainActivity
import com.example.R
import com.example.data.AppDatabase
import com.example.data.ObsidianSyncRepository
import com.example.data.SyncPreferences
import com.example.data.Task
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

class ObsidianTodoWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.example.widget.ACTION_REFRESH"
        const val ACTION_PAUSE_TIMER = "com.example.widget.ACTION_PAUSE_TIMER"
        const val ACTION_RESUME_TIMER = "com.example.widget.ACTION_RESUME_TIMER"
        const val ACTION_CANCEL_TIMER = "com.example.widget.ACTION_CANCEL_TIMER"
        const val ACTION_TOGGLE_TASK = "com.example.widget.ACTION_TOGGLE_TASK"

        private const val MAX_WIDGET_ITEMS = 20
    }

    // ──────────────────────────────────────────────────────────────
    // onUpdate — entry point from the system
    // ──────────────────────────────────────────────────────────────
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val tasks = loadTasks(context)
                for (appWidgetId in appWidgetIds) {
                    val views = buildViews(context, tasks)
                    appWidgetManager.updateAppWidget(appWidgetId, views)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                pendingResult.finish()
            }
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────
    private fun loadTasks(context: Context): List<Task> {
        return try {
            val db = AppDatabase.getDatabase(context)
            val raw = db.taskDao().getAllTasksDirect()
            val timed = raw.filter { it.category == "FOCUS BLOCKS" }.sortedBy { it.lineNumber }
            val untimed = raw.filter { it.category != "FOCUS BLOCKS" && it.parentLineNumber == null }.sortedBy { it.lineNumber }
            val subtasksByParent = raw.filter { it.parentLineNumber != null }.groupBy { it.parentLineNumber!! }

            val result = mutableListOf<Task>()
            timed.forEach { parent ->
                result.add(parent)
                subtasksByParent[parent.lineNumber]?.let { result.addAll(it) }
            }
            result.addAll(untimed)
            result
        } catch (e: Exception) {
            e.printStackTrace()
            emptyList()
        }
    }

    private fun buildViews(context: Context, tasksList: List<Task>): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_layout)
        val prefs = SyncPreferences(context)

        // ── Header ──────────────────────────────────────────────
        views.setInt(R.id.widget_header_icon, "setColorFilter", android.graphics.Color.parseColor("#A882DD"))
        views.setInt(R.id.widget_refresh_button, "setColorFilter", android.graphics.Color.parseColor("#A882DD"))

        val launchPi = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_title, launchPi)

        val refreshPi = PendingIntent.getBroadcast(
            context, 1,
            Intent(context, ObsidianTodoWidgetProvider::class.java).apply { action = ACTION_REFRESH },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_refresh_button, refreshPi)

        // ── Active Timer Card ────────────────────────────────────
        val activeTaskName = prefs.activeTimerTaskName
        if (activeTaskName.isNotEmpty()) {
            views.setViewVisibility(R.id.widget_timer_container, View.VISIBLE)
            views.setTextViewText(R.id.widget_timer_task_name, activeTaskName)

            val remainingSecs = prefs.activeTimerRemainingSeconds
            val isPaused = prefs.activeTimerIsPaused
            val mins = remainingSecs / 60
            val secs = remainingSecs % 60
            val timeStr = if (isPaused) String.format("%02d:%02d (Paused)", mins, secs)
                          else String.format("%02d:%02d", mins, secs)
            views.setTextViewText(R.id.widget_timer_time, timeStr)

            val pauseIcon = if (isPaused) R.drawable.ic_play else R.drawable.ic_pause
            views.setImageViewResource(R.id.widget_timer_pause_btn, pauseIcon)
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

            val cancelPi = PendingIntent.getBroadcast(
                context, 4,
                Intent(context, ObsidianTodoWidgetProvider::class.java).apply { action = ACTION_CANCEL_TIMER },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_timer_cancel_btn, cancelPi)
            views.setInt(R.id.widget_timer_cancel_btn, "setColorFilter", android.graphics.Color.parseColor("#EF4444"))
        } else {
            views.setViewVisibility(R.id.widget_timer_container, View.GONE)
        }

        // ── Task List ────────────────────────────────────────────
        views.removeAllViews(R.id.widget_list_container)
        if (tasksList.isEmpty()) {
            views.setViewVisibility(R.id.widget_list_container, View.GONE)
            views.setViewVisibility(R.id.widget_empty_view, View.VISIBLE)
        } else {
            views.setViewVisibility(R.id.widget_list_container, View.VISIBLE)
            views.setViewVisibility(R.id.widget_empty_view, View.GONE)
            for (task in tasksList.take(MAX_WIDGET_ITEMS)) {
                views.addView(R.id.widget_list_container, buildTaskItem(context, task, launchPi))
            }
        }

        // ── Footer ───────────────────────────────────────────────
        val lastSync = prefs.lastSyncTime
        val formattedTime = if (lastSync > 0) {
            "Synced: ${SimpleDateFormat("MMM d, HH:mm", Locale.getDefault()).format(Date(lastSync))}"
        } else "Synced: Never"
        views.setTextViewText(R.id.widget_footer, formattedTime)

        return views
    }

    private fun buildTaskItem(context: Context, task: Task, launchPi: PendingIntent): RemoteViews {
        val iv = RemoteViews(context.packageName, R.layout.widget_todo_item)
        val isSubtask = (task.parentLineNumber != null)
        val timeText = task.timeRange ?: if (isSubtask) "Subtask" else "Untimed"
        val accentColor = if (task.timeRange != null) "#A882DD" else "#71717A"

        iv.setTextViewText(R.id.widget_item_time_badge, timeText)
        iv.setTextViewText(
            R.id.widget_item_text,
            if (isSubtask) "   ↳ ${task.displayTitle}" else task.displayTitle
        )
        val subtitle = when {
            task.timeRange != null -> "Focus Block • ${task.project ?: "General"}"
            isSubtask              -> "Subtask • ${task.project ?: "General"}"
            else                   -> "Untimed Backlog • ${task.project ?: "General"}"
        }
        iv.setTextViewText(R.id.widget_item_subtitle, subtitle)
        iv.setInt(R.id.widget_item_accent_bar, "setBackgroundColor", android.graphics.Color.parseColor(accentColor))
        iv.setInt(R.id.widget_item_time_badge, "setTextColor", android.graphics.Color.parseColor(accentColor))

        if (task.isCompleted) {
            iv.setImageViewResource(R.id.widget_item_status_icon, R.drawable.ic_checkbox_checked)
            iv.setInt(R.id.widget_item_status_icon, "setColorFilter", android.graphics.Color.parseColor("#10B981"))
        } else {
            iv.setImageViewResource(R.id.widget_item_status_icon, R.drawable.ic_checkbox_unchecked)
            iv.setInt(R.id.widget_item_status_icon, "setColorFilter", android.graphics.Color.parseColor("#71717A"))
        }

        // Toggle checkbox — unique request code per task
        val togglePi = PendingIntent.getBroadcast(
            context,
            abs(task.id.hashCode() % 50000),
            Intent(context, ObsidianTodoWidgetProvider::class.java).apply {
                action = ACTION_TOGGLE_TASK
                putExtra("task_id", task.id)
                putExtra("is_completed", !task.isCompleted)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        iv.setOnClickPendingIntent(R.id.widget_item_status_icon, togglePi)

        // Tap title → open app
        iv.setOnClickPendingIntent(R.id.widget_item_text, launchPi)

        return iv
    }

    private fun refreshWidget(context: Context) {
        val appWidgetManager = AppWidgetManager.getInstance(context)
        val ids = appWidgetManager.getAppWidgetIds(
            ComponentName(context, ObsidianTodoWidgetProvider::class.java)
        )
        if (ids.isNotEmpty()) {
            onUpdate(context, appWidgetManager, ids)
        }
    }

    // ──────────────────────────────────────────────────────────────
    // onReceive — handle button intents
    // ──────────────────────────────────────────────────────────────
    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val action = intent.action ?: return

        when (action) {
            ACTION_REFRESH -> {
                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        ObsidianSyncRepository(context).syncTasks()
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
                    try { ObsidianSyncRepository(context).pauseTimer(); refreshWidget(context) }
                    catch (e: Exception) { e.printStackTrace() }
                    finally { pendingResult.finish() }
                }
            }
            ACTION_RESUME_TIMER -> {
                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try { ObsidianSyncRepository(context).resumeTimer(); refreshWidget(context) }
                    catch (e: Exception) { e.printStackTrace() }
                    finally { pendingResult.finish() }
                }
            }
            ACTION_CANCEL_TIMER -> {
                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try { ObsidianSyncRepository(context).cancelTimer(); refreshWidget(context) }
                    catch (e: Exception) { e.printStackTrace() }
                    finally { pendingResult.finish() }
                }
            }
            ACTION_TOGGLE_TASK -> {
                val taskId = intent.getStringExtra("task_id") ?: return
                val isCompleted = intent.getBooleanExtra("is_completed", false)
                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        val task = AppDatabase.getDatabase(context).taskDao().getTaskById(taskId)
                        if (task != null) {
                            ObsidianSyncRepository(context).toggleTask(task, isCompleted)
                        }
                        refreshWidget(context)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    } finally {
                        pendingResult.finish()
                    }
                }
            }
            "android.appwidget.action.APPWIDGET_UPDATE" -> refreshWidget(context)
        }
    }
}
