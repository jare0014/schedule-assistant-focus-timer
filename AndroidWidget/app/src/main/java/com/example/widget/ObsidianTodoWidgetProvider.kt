package com.example.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
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
        const val ACTION_TOGGLE_TASK = "com.example.widget.ACTION_TOGGLE_TASK"
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.widget_layout)
            val prefs = SyncPreferences(context)

            // Setup service adapter for list view
            val serviceIntent = Intent(context, ObsidianWidgetService::class.java)
            views.setRemoteAdapter(R.id.widget_list_view, serviceIntent)

            // Apply colors programmatically to bypass RemoteViews XML limitations
            views.setInt(R.id.widget_header_icon, "setColorFilter", android.graphics.Color.parseColor("#A882DD"))
            views.setInt(R.id.widget_refresh_button, "setColorFilter", android.graphics.Color.parseColor("#A882DD"))

            // Dynamic visibility of list vs empty state
            val listEmpty = false // We let onDataSetChanged manage, but we can set up an empty view
            views.setEmptyView(R.id.widget_list_view, R.id.widget_empty_text)

            // Date of last sync
            val lastSync = prefs.lastSyncTime
            val formattedTime = if (lastSync > 0) {
                val sdf = SimpleDateFormat("MMM d, HH:mm", Locale.getDefault())
                "Synced: ${sdf.format(Date(lastSync))}"
            } else {
                "Synced: Never"
            }
            views.setTextViewText(R.id.widget_footer, formattedTime)

            // Set up click intent for Refresh Button
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

            // Set up click intent to open the Web App URL when clicking the title text
            val serverIp = prefs.serverIp.trim()
            val serverPort = prefs.serverPort.trim()
            val baseWebUrl = if (serverIp.startsWith("http://") || serverIp.startsWith("https://")) {
                if (serverPort.isNotEmpty()) "$serverIp:$serverPort/" else "$serverIp/"
            } else {
                if (serverPort.isNotEmpty()) "http://$serverIp:$serverPort/" else "http://$serverIp/"
            }
            
            try {
                val webAppIntent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(baseWebUrl)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                val webAppPendingIntent = PendingIntent.getActivity(
                    context,
                    10,
                    webAppIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(R.id.widget_title, webAppPendingIntent)
            } catch (e: Exception) {
                e.printStackTrace()
            }

            // Set up Click template for entire list view click detection
            val listClickIntent = Intent(context, ObsidianTodoWidgetProvider::class.java).apply {
                action = ACTION_TOGGLE_TASK
            }
            val listClickPendingIntent = PendingIntent.getBroadcast(
                context,
                2,
                listClickIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
            views.setPendingIntentTemplate(R.id.widget_list_view, listClickPendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
            appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.widget_list_view)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val action = intent.action ?: return

        if (action == ACTION_REFRESH) {
            val pendingResult = goAsync()
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val repo = ObsidianSyncRepository(context)
                    repo.syncTasks()
                    
                    val appWidgetManager = AppWidgetManager.getInstance(context)
                    val ids = appWidgetManager.getAppWidgetIds(ComponentName(context, ObsidianTodoWidgetProvider::class.java))
                    appWidgetManager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list_view)
                    onUpdate(context, appWidgetManager, ids)
                } catch (e: Exception) {
                    e.printStackTrace()
                } finally {
                    pendingResult.finish()
                }
            }
        } else if (action == ACTION_TOGGLE_TASK) {
            val actionType = intent.getStringExtra("action_type") ?: "TOGGLE"
            if (actionType == "LAUNCH") {
                try {
                    val launchIntent = Intent(context, com.example.MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(launchIntent)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            } else {
                val taskId = intent.getStringExtra("task_id") ?: return
                val completed = intent.getBooleanExtra("is_completed", false)

                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        val repo = ObsidianSyncRepository(context)
                        val list = repo.getLocalTasks()
                        val task = list.find { it.id == taskId }
                        if (task != null) {
                            repo.toggleTask(task, completed)
                        }

                        val appWidgetManager = AppWidgetManager.getInstance(context)
                        val ids = appWidgetManager.getAppWidgetIds(ComponentName(context, ObsidianTodoWidgetProvider::class.java))
                        appWidgetManager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list_view)
                        onUpdate(context, appWidgetManager, ids)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    } finally {
                        pendingResult.finish()
                    }
                }
            }
        } else if (action == "android.appwidget.action.APPWIDGET_UPDATE") {
            // Trigger database update and refresh lists
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val ids = appWidgetManager.getAppWidgetIds(ComponentName(context, ObsidianTodoWidgetProvider::class.java))
            appWidgetManager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list_view)
            onUpdate(context, appWidgetManager, ids)
        }
    }
}
