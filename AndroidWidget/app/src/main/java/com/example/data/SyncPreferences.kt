package com.example.data

import android.content.Context
import android.os.Handler
import android.os.Looper

class SyncPreferences(private val context: Context) {
    private val prefs = context.getSharedPreferences("obsidian_sync_prefs", Context.MODE_PRIVATE)

    var serverIp: String
        get() = prefs.getString("server_ip", "10.0.0.75") ?: "10.0.0.75"
        set(value) = prefs.edit().putString("server_ip", value).apply()

    var serverPort: String
        get() = prefs.getString("server_port", "8090") ?: "8090"
        set(value) = prefs.edit().putString("server_port", value).apply()

    var syncMode: String
        get() = prefs.getString("sync_mode", "MARKDOWN") ?: "MARKDOWN"
        set(value) = prefs.edit().putString("sync_mode", value).apply()

    var pathOrEndpoint: String
        get() = prefs.getString("path_or_endpoint", "/02_Journal/01_Daily/{YYYY-MM-DD}.md") ?: "/02_Journal/01_Daily/{YYYY-MM-DD}.md"
        set(value) = prefs.edit().putString("path_or_endpoint", value).apply()

    var apiToken: String
        get() = prefs.getString("api_token", "") ?: ""
        set(value) = prefs.edit().putString("api_token", value).apply()

    var lastSyncTime: Long
        get() = prefs.getLong("last_sync_time", 0)
        set(value) = prefs.edit().putLong("last_sync_time", value).apply()

    var lastSyncStatus: String
        get() = prefs.getString("last_sync_status", "Never Synced") ?: "Never Synced"
        set(value) = prefs.edit().putString("last_sync_status", value).apply()

    var lastSyncDateHeader: String
        get() = prefs.getString("last_sync_date_header", "Sat, Jun 13") ?: "Sat, Jun 13"
        set(value) = prefs.edit().putString("last_sync_date_header", value).apply()

    var activeTimerTaskName: String
        get() = prefs.getString("active_timer_task_name", "") ?: ""
        set(value) = prefs.edit().putString("active_timer_task_name", value).apply()

    var activeTimerRemainingSeconds: Int
        get() = prefs.getInt("active_timer_remaining_seconds", 0)
        set(value) = prefs.edit().putInt("active_timer_remaining_seconds", value).apply()

    var activeTimerTotalSeconds: Int
        get() = prefs.getInt("active_timer_total_seconds", 0)
        set(value) = prefs.edit().putInt("active_timer_total_seconds", value).apply()

    var activeTimerIsPaused: Boolean
        get() = prefs.getBoolean("active_timer_is_paused", false)
        set(value) = prefs.edit().putBoolean("active_timer_is_paused", value).apply()

    var activeTimerLineIndex: Int
        get() = prefs.getInt("active_timer_line_index", -1)
        set(value) = prefs.edit().putInt("active_timer_line_index", value).apply()

    var isAlarming: Boolean
        get() = prefs.getBoolean("is_alarming", false)
        set(value) = prefs.edit().putBoolean("is_alarming", value).apply()

    fun getLogs(): List<String> {
        val serialized = prefs.getString("sync_logs", "") ?: ""
        if (serialized.isEmpty()) return emptyList()
        return serialized.split("|||")
    }

    fun addLog(logMessage: String) {
        val currentLogs = getLogs().toMutableList()
        val timestamp = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())
        currentLogs.add(0, "[$timestamp] $logMessage") // Newest logs first
        val trimmedLogs = if (currentLogs.size > 50) currentLogs.take(50) else currentLogs
        prefs.edit().putString("sync_logs", trimmedLogs.joinToString("|||")).apply()
    }

    fun clearLogs() {
        prefs.edit().putString("sync_logs", "").apply()
    }
}
