package com.example.widget

import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.example.R
import com.example.data.AppDatabase
import com.example.data.Task

class ObsidianWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        return ObsidianWidgetFactory(applicationContext)
    }
}

class ObsidianWidgetFactory(private val context: Context) : RemoteViewsService.RemoteViewsFactory {
    private val db = AppDatabase.getDatabase(context)
    private val taskDao = db.taskDao()
    private var tasksList = listOf<Task>()

    override fun onCreate() {
        // No-op
    }

    override fun onDataSetChanged() {
        val raw = taskDao.getAllTasksDirect()
        val timed = raw.filter { it.category == "FOCUS BLOCKS" }.sortedBy { it.lineNumber }
        val untimed = raw.filter { it.category != "FOCUS BLOCKS" && it.parentLineNumber == null }.sortedBy { it.lineNumber }
        
        val resultList = mutableListOf<Task>()
        val subtasksByParent = raw.filter { it.parentLineNumber != null }.groupBy { it.parentLineNumber!! }

        timed.forEach { parent ->
            resultList.add(parent)
            val subtasks = subtasksByParent[parent.lineNumber]
            if (subtasks != null) {
                resultList.addAll(subtasks)
            }
        }
        resultList.addAll(untimed)

        tasksList = resultList
    }

    override fun onDestroy() {
        tasksList = emptyList()
    }

    override fun getCount(): Int = tasksList.size

    override fun getViewAt(position: Int): RemoteViews {
        if (position >= tasksList.size) {
            return RemoteViews(context.packageName, R.layout.widget_todo_item)
        }
        val task = tasksList[position]
        val views = RemoteViews(context.packageName, R.layout.widget_todo_item)

        val isSubtask = (task.parentLineNumber != null)
        val timeText = task.timeRange ?: if (isSubtask) "Subtask" else "Untimed"
        
        views.setTextViewText(R.id.widget_item_time_badge, timeText)
        views.setTextViewText(
            R.id.widget_item_text,
            if (isSubtask) "   ↳ ${task.displayTitle}" else task.displayTitle
        )
        
        val subtitleText = if (task.timeRange != null) {
            "Focus Block • ${task.project ?: "General"}"
        } else if (isSubtask) {
            "Subtask • ${task.project ?: "General"}"
        } else {
            "Untimed Backlog • ${task.project ?: "General"}"
        }
        views.setTextViewText(R.id.widget_item_subtitle, subtitleText)

        val accentColor = if (task.timeRange != null) "#A882DD" else "#71717A"
        views.setInt(R.id.widget_item_accent_bar, "setBackgroundColor", android.graphics.Color.parseColor(accentColor))
        views.setInt(R.id.widget_item_time_badge, "setTextColor", android.graphics.Color.parseColor(accentColor))

        if (task.isCompleted) {
            views.setImageViewResource(R.id.widget_item_status_icon, R.drawable.ic_checkbox_checked)
            views.setInt(R.id.widget_item_status_icon, "setColorFilter", android.graphics.Color.parseColor("#10B981"))
        } else {
            views.setImageViewResource(R.id.widget_item_status_icon, R.drawable.ic_checkbox_unchecked)
            views.setInt(R.id.widget_item_status_icon, "setColorFilter", android.graphics.Color.parseColor("#71717A"))
        }

        val fillInIntent = Intent().apply {
            putExtra("action_type", "TOGGLE")
            putExtra("task_id", task.id)
            putExtra("is_completed", !task.isCompleted)
        }
        views.setOnClickFillInIntent(R.id.widget_item_status_icon, fillInIntent)

        val launchIntent = Intent().apply {
            putExtra("action_type", "LAUNCH")
        }
        views.setOnClickFillInIntent(R.id.widget_item_text, launchIntent)

        return views
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount(): Int = 1

    override fun getItemId(position: Int): Long {
        if (position < tasksList.size) {
            return tasksList[position].id.hashCode().toLong()
        }
        return position.toLong()
    }

    override fun hasStableIds(): Boolean = true
}
