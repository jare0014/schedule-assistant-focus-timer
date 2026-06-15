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
        // Runs on a background binder thread. Read network or DB safely here.
        tasksList = taskDao.getAllTasksDirect()
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

        val itemDisplayText = if (task.timeRange != null) {
            "${task.timeRange} - ${task.displayTitle}"
        } else {
            task.text
        }
        views.setTextViewText(R.id.widget_item_text, itemDisplayText)

        if (task.isCompleted) {
            views.setImageViewResource(R.id.widget_item_status_icon, R.drawable.ic_checkbox_checked)
            views.setInt(R.id.widget_item_status_icon, "setColorFilter", android.graphics.Color.parseColor("#A882DD"))
        } else {
            views.setImageViewResource(R.id.widget_item_status_icon, R.drawable.ic_checkbox_unchecked)
            views.setInt(R.id.widget_item_status_icon, "setColorFilter", android.graphics.Color.parseColor("#71717A"))
        }

        // Set up click fill-in intent
        // Checkbox toggles task status
        val toggleIntent = Intent().apply {
            putExtra("action_type", "TOGGLE")
            putExtra("task_id", task.id)
            putExtra("is_completed", !task.isCompleted)
        }
        views.setOnClickFillInIntent(R.id.widget_item_status_icon, toggleIntent)

        // Text view launches the main application
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
